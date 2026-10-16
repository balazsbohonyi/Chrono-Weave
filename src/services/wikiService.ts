
import { HistoricalFigure } from "../types";

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

const fetchWikidataPortrait = async (entityId: string, width: number): Promise<string | null> => {
    try {
        const params = new URLSearchParams({
            action: 'wbgetclaims', entity: entityId, property: 'P18', format: 'json', origin: '*'
        });
        const response = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`);
        const claims: any[] = (await response.json()).claims?.P18 ?? [];
        const usable = claims.filter(claim => claim.rank !== 'deprecated' && claim.mainsnak?.datavalue?.value);
        const best = usable.find(claim => claim.rank === 'preferred') ?? usable[0];
        const file = best?.mainsnak.datavalue.value;
        return typeof file === 'string'
            ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`
            : null;
    } catch (error) {
        console.warn("Wikidata portrait fetch failed", error);
        return null;
    }
};

// Resolves entity id -> portrait URL with a small worker pool; misses are absent.
const fetchWikidataPortraits = async (entityIds: string[], width: number): Promise<Map<string, string>> => {
    const portraits = new Map<string, string>();
    const queue = [...new Set(entityIds)];
    const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
            const url = await fetchWikidataPortrait(id, width);
            if (url) portraits.set(id, url);
        }
    };
    await Promise.all(Array.from({ length: Math.min(WIKIDATA_CLAIMS_CONCURRENCY, queue.length) }, worker));
    return portraits;
};

// Helper to fetch images from Wikipedia in batch
const fetchBatchWikipediaImages = async (names: string[], width = FIGURE_THUMBNAIL_WIDTH): Promise<Map<string, string>> => {
    const imageMap = new Map<string, string>();
    if (names.length === 0) return imageMap;

    // Chunking to be safe (API limit is usually 50)
    const chunkSize = 50;
    for (let i = 0; i < names.length; i += chunkSize) {
        const chunk = names.slice(i, i + chunkSize);
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
            const data = await response.json();
            const pages = data.query?.pages;
            
            if (!pages) continue;

            // We need to map the API results back to the input names.
            // The API might normalize names (e.g. "leonardo da vinci" -> "Leonardo da Vinci")
            // or redirect them.
            
            const nameToTitle = new Map<string, string>();
            chunk.forEach(name => nameToTitle.set(name, name));

            // 1. Handle Normalization: Input -> Normalized
            const normalized = data.query?.normalized || [];
            normalized.forEach((n: any) => {
                if (nameToTitle.get(n.from) === n.from) {
                    nameToTitle.set(n.from, n.to);
                }
            });

            // 2. Handle Redirects: Normalized -> Final Title
            const redirects = data.query?.redirects || [];
            redirects.forEach((r: any) => {
                // Find inputs pointing to this redirect source
                for (const [input, currentTarget] of nameToTitle.entries()) {
                    if (currentTarget === r.from) {
                        nameToTitle.set(input, r.to);
                    }
                }
            });

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
            if (withoutThumbnail.size > 0) {
                const portraits = await fetchWikidataPortraits([...withoutThumbnail.keys()], width);
                for (const [entityId, inputs] of withoutThumbnail) {
                    const url = portraits.get(entityId);
                    if (url) inputs.forEach(input => imageMap.set(input, url));
                }
            }

        } catch (error) {
            console.warn("Batch wiki image fetch failed", error);
        }
    }
    return imageMap;
};

// Portraits by name, for callers that have no HistoricalFigure (Six Degrees contacts), as small thumbnails. Misses are simply absent.
export const fetchWikipediaImagesByName = (names: string[]): Promise<Map<string, string>> =>
  fetchBatchWikipediaImages([...new Set(names)], CONTACT_THUMBNAIL_WIDTH);

export const fetchBatchFigureDetails = async (
  figures: HistoricalFigure[]
): Promise<Map<string, { description: string; imageUrl: string | null }>> => {
  const resultMap = new Map<string, { description: string; imageUrl: string | null }>();
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
    const entry = { description: initialDescription, imageUrl: null };
    resultMap.set(key, entry);
    
    // Mark for image fetching
    figuresNeedingImages.push(fig);
  }

  if (figuresNeedingImages.length === 0) {
    return resultMap;
  }

  // 2. Fetch Images (Wikipedia only - NO Gemini call here)
  try {
      const names = figuresNeedingImages.map(f => f.name);
      const imageMap = await fetchBatchWikipediaImages(names);
      
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
