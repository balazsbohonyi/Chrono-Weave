
import { HistoricalFigure } from "../types";

// Cache to avoid re-fetching details for the same person within the session
const detailsCache = new Map<string, { description: string; imageUrl: string | null }>();

// Helper to fetch images from Wikipedia in batch
const fetchBatchWikipediaImages = async (names: string[]): Promise<Map<string, string>> => {
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
            prop: 'pageimages',
            format: 'json',
            pithumbsize: '400',
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
            Object.values(pages).forEach((page: any) => {
                if (page.thumbnail?.source) {
                    // Find which input names map to this page title
                    for (const [input, title] of nameToTitle.entries()) {
                        if (title === page.title) {
                            imageMap.set(input, page.thumbnail.source);
                        }
                    }
                }
            });

        } catch (error) {
            console.warn("Batch wiki image fetch failed", error);
        }
    }
    return imageMap;
};

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
