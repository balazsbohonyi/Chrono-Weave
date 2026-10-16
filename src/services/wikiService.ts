
import { HistoricalFigure } from "../types";
import { mapInputsToTitles } from "./wikiTitles";
import { portraitStore } from "./portraitStore";

// Cache to avoid re-fetching details for the same person within the session
const detailsCache = new Map<string, { description: string; imageUrl: string | null }>();

// Wikipedia designates no page image for some articles of well-known people. Their Wikidata portrait (P18) is the
// fallback. Special:FilePath redirects to a rendered thumbnail, so no further lookup is needed.
const WIKIDATA_CLAIMS_CONCURRENCY = 6;
// Thumbnail widths, in Wikimedia's standard steps. The canvas shows figures large; Six Degrees shows people in 32-64px circles, where a
// 400px picture costs a lot to draw: a network of hundreds of them overflows the browser's decoded-image cache, so every repaint
// decodes and scales them all again (measured: about 7x the image decoding of 120px thumbnails while panning 1000 people).
const FIGURE_THUMBNAIL_WIDTH = 400;
const CONTACT_THUMBNAIL_WIDTH = 120;

// The portrait URL, null when Wikidata has no usable one, undefined when it could not be asked (not an answer, so never remembered as one).
const fetchWikidataPortrait = async (entityId: string, width: number): Promise<string | null | undefined> => {
    try {
        const params = new URLSearchParams({
            action: 'wbgetclaims', entity: entityId, property: 'P18', format: 'json', origin: '*'
        });
        const response = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`);
        if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
        const claims: any[] = (await response.json()).claims?.P18 ?? [];
        const usable = claims.filter(claim => claim.rank !== 'deprecated' && claim.mainsnak?.datavalue?.value);
        const best = usable.find(claim => claim.rank === 'preferred') ?? usable[0];
        const file = best?.mainsnak.datavalue.value;
        return typeof file === 'string'
            ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`
            : null;
    } catch (error) {
        console.warn("Wikidata portrait fetch failed", error);
        return undefined;
    }
};

// Resolves entity id -> portrait URL with a small worker pool: a URL, null for an entity with no portrait; an entity that could not be asked is absent.
const fetchWikidataPortraits = async (entityIds: string[], width: number): Promise<Map<string, string | null>> => {
    const portraits = new Map<string, string | null>();
    const queue = [...new Set(entityIds)];
    const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
            const url = await fetchWikidataPortrait(id, width);
            if (url !== undefined) portraits.set(id, url);
        }
    };
    await Promise.all(Array.from({ length: Math.min(WIKIDATA_CLAIMS_CONCURRENCY, queue.length) }, worker));
    return portraits;
};

// A few chunks at a time: 600 people are twelve chunks, and asking for them one after another made the faces of a big network arrive
// one round trip at a time. Wikidata's own pool (above) works inside each chunk.
const WIKIPEDIA_CHUNK_CONCURRENCY = 3;

// What the network said about some names: the pictures found, and which names were really answered (found, or definitely without a picture).
// A name whose request failed is in neither, so the caller neither shows nor remembers it as having no picture.
interface WikipediaAnswers { found: Map<string, string>; answered: Set<string> }

// Asks Wikipedia (and, for pages without a page image, Wikidata) about these names, in chunks. Never throws.
const askWikipediaForImages = async (names: string[], width: number): Promise<WikipediaAnswers> => {
    const imageMap = new Map<string, string>();
    const answered = new Set<string>();
    if (names.length === 0) return { found: imageMap, answered };

    // Chunking to be safe (API limit is usually 50)
    const chunkSize = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < names.length; i += chunkSize) chunks.push(names.slice(i, i + chunkSize));
    const queue = [...chunks];
    const askChunk = async (chunk: string[]) => {
        // Wikipedia expects titles separated by pipe
        const titlesParam = chunk.join('|');

        const params = new URLSearchParams({
            action: 'query',
            titles: titlesParam,
            prop: 'pageimages|pageprops',
            ppprop: 'wikibase_item',
            format: 'json',
            pithumbsize: String(width),
            origin: '*',
            redirects: '1' // Automatically resolve redirects
        });

        try {
            const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
            // A refusal (rate limit, server error) or a reply without pages is a failure, not "nobody here has a picture".
            if (!response.ok) throw new Error(`Wikipedia answered ${response.status}`);
            const data = await response.json();
            const pages = data.query?.pages;

            if (!pages) throw new Error('Wikipedia gave no pages');

            // We need to map the API results back to the input names.
            // The API might normalize names (e.g. "leonardo da vinci" -> "Leonardo da Vinci")
            // or redirect them.
            
            // 1-2. Input -> normalised -> final title (shared with the Wikidata identity lookup)
            const nameToTitle = mapInputsToTitles(chunk, data.query ?? {});

            // 3. Extract Images using Final Title
            const withoutThumbnail = new Map<string, string[]>(); // Wikidata entity -> input names
            Object.values(pages).forEach((page: any) => {
                const inputs = [...nameToTitle.entries()].filter(([, title]) => title === page.title).map(([input]) => input);
                if (page.thumbnail?.source) {
                    inputs.forEach(input => imageMap.set(input, page.thumbnail.source));
                } else if (page.pageprops?.wikibase_item && inputs.length) {
                    withoutThumbnail.set(page.pageprops.wikibase_item, inputs);
                }
            });

            // 4. Fall back to the Wikidata portrait for articles Wikipedia gives no page image
            const unasked = new Set<string>();
            if (withoutThumbnail.size > 0) {
                const portraits = await fetchWikidataPortraits([...withoutThumbnail.keys()], width);
                for (const [entityId, inputs] of withoutThumbnail) {
                    const url = portraits.get(entityId);
                    if (url) inputs.forEach(input => imageMap.set(input, url));
                    // Wikidata could not be asked about this one: Wikipedia's answer was "no page image", but that is not the whole answer.
                    else if (url === undefined) inputs.forEach(input => unasked.add(input));
                }
            }
            for (const name of chunk) if (!unasked.has(name)) answered.add(name);

        } catch (error) {
            console.warn("Batch wiki image fetch failed", error);
        }
    };
    const worker = async () => { for (let chunk = queue.shift(); chunk; chunk = queue.shift()) await askChunk(chunk); };
    await Promise.all(Array.from({ length: Math.min(WIKIPEDIA_CHUNK_CONCURRENCY, queue.length) }, worker));
    return { found: imageMap, answered };
};

// Portraits by name: what is remembered (see portraitStore) comes at once, and only the people never asked about, or asked too long ago, go to
// Wikipedia. `onStored` is told about the remembered pictures as soon as they are known when others are still being asked for, so a few
// newcomers never hold back the faces of everybody else. Misses are simply absent; so is anyone whose request failed (and that is not remembered).
const fetchBatchWikipediaImages = async (names: string[], width = FIGURE_THUMBNAIL_WIDTH, onStored?: (found: Map<string, string>) => void): Promise<Map<string, string>> => {
    const imageMap = new Map<string, string>();
    const unique = [...new Set(names)];
    if (unique.length === 0) return imageMap;
    const store = portraitStore();
    const known = await store.known(unique, width);
    for (const [name, url] of known) if (url) imageMap.set(name, url);
    const unknown = unique.filter(name => !known.has(name));
    if (unknown.length === 0) return imageMap;
    if (imageMap.size) onStored?.(new Map(imageMap));
    const { found, answered } = await askWikipediaForImages(unknown, width);
    store.record(width, new Map([...answered].map(name => [name, found.get(name) ?? null])));
    for (const [name, url] of found) imageMap.set(name, url);
    return imageMap;
};

// Portraits by name, for callers that have no HistoricalFigure (Six Degrees contacts), as small thumbnails. Misses are simply absent.
export const fetchWikipediaImagesByName = (names: string[], onStored?: (found: Map<string, string>) => void): Promise<Map<string, string>> =>
  fetchBatchWikipediaImages(names, CONTACT_THUMBNAIL_WIDTH, onStored);

type FigureDetail = { description: string; imageUrl: string | null };

// Details (the description the figure already has, and its portrait) of each figure, by figure id. `onStored` receives the details of the figures
// whose portrait was already remembered, before the others have been asked for.
export const fetchBatchFigureDetails = async (
  figures: HistoricalFigure[],
  onStored?: (details: Map<string, FigureDetail>) => void
): Promise<Map<string, FigureDetail>> => {
  const resultMap = new Map<string, FigureDetail>();
  const figuresNeedingImages: HistoricalFigure[] = [];

  // 1. Check Cache & Initial Data
  for (const fig of figures) {
    const key = fig.id;

    // If we have a full cached entry (desc + image attempt), use it
    if (detailsCache.has(key)) {
      resultMap.set(key, detailsCache.get(key)!);
      continue;
    }

    // Initialize with existing data from the figure object
    // This efficiently uses the description fetched in the initial batch
    const initialDescription = fig.shortDescription || "Loading bio...";

    // Create entry
    const entry: FigureDetail = { description: initialDescription, imageUrl: fig.imageUrl ?? null };
    resultMap.set(key, entry);

    // A figure that already carries its portrait has nothing to look up
    if (!fig.imageUrl) figuresNeedingImages.push(fig);
  }

  if (figuresNeedingImages.length === 0) {
    return resultMap;
  }

  // 2. Fetch Images (Wikipedia only - NO Gemini call here)
  try {
      const names = figuresNeedingImages.map(f => f.name);
      const imageMap = await fetchBatchWikipediaImages(names, FIGURE_THUMBNAIL_WIDTH, !onStored ? undefined : stored => {
          const early = new Map<string, FigureDetail>();
          for (const fig of figuresNeedingImages) {
              const url = stored.get(fig.name);
              if (url) early.set(fig.id, { ...resultMap.get(fig.id)!, imageUrl: url });
          }
          onStored(early);
      });

      figuresNeedingImages.forEach(fig => {
          const url = imageMap.get(fig.name);
          const entry = resultMap.get(fig.id);
          
          if (entry) {
              if (url) {
                  entry.imageUrl = url;
              }
              // Update cache with the final result (desc + potential image)
              detailsCache.set(fig.id, entry);
          }
      });
  } catch (e) {
      console.error("Image fetch failed", e);
      // We still return the descriptions we have
  }

  return resultMap;
};
