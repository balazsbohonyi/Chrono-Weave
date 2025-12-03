
// Helper for waiting
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Global queue to ensure we don't fire parallel requests that trigger 429s
let requestQueue: Promise<any> = Promise.resolve();

/**
 * Adds a task to the global execution queue. 
 * Ensures that API calls are serialized and have a buffer delay between them.
 */
export function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  // We chain the new task to the end of the current queue
  const result = requestQueue.then(async () => {
    // Add a 1-second buffer between requests to respect RPM limits
    await wait(1000);
    return task();
  });

  // Update the queue pointer. We catch errors so a failed request doesn't block the queue forever.
  requestQueue = result.catch(() => {});

  return result;
}

export async function runWithRetry<T>(fn: () => Promise<T>, retries = 5, backoff = 3000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    // Check for rate limit errors (429) or server errors (5xx)
    // The API might throw an error object that HAS a response, or IS the response data.
    let isRateLimit = false;

    // Standard HTTP status check
    if (err?.status === 429 || err?.status === 503) isRateLimit = true;
    
    // Error object code check
    if (err?.code === 429) isRateLimit = true;
    
    // Message content check
    const msg = err?.message || '';
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) isRateLimit = true;

    // Nested error object check (matches the error structure you provided)
    if (err?.error) {
        if (err.error.code === 429) isRateLimit = true;
        if (err.error.status === 'RESOURCE_EXHAUSTED') isRateLimit = true;
    }

    if (retries > 0 && isRateLimit) {
      console.warn(`API rate limit hit. Retrying in ${backoff}ms... (Attempts left: ${retries})`);
      await wait(backoff);
      return runWithRetry(fn, retries - 1, backoff * 2);
    }
    throw err;
  }
}

/**
 * Wrapper that combines Queueing AND Retrying.
 * This is the main function to use for all API calls.
 */
export async function safeAICall<T>(apiCall: () => Promise<T>): Promise<T> {
    return enqueueTask(() => runWithRetry(apiCall));
}

/**
 * Calculate the relative luminance of a color according to WCAG 2.0
 * @param hex - Hex color string (e.g., '#60A5FA')
 * @returns Relative luminance value between 0 and 1
 */
function getRelativeLuminance(hex: string): number {
  // Remove # if present
  const color = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(color.substring(0, 2), 16) / 255;
  const g = parseInt(color.substring(2, 4), 16) / 255;
  const b = parseInt(color.substring(4, 6), 16) / 255;

  // Apply sRGB to linear RGB conversion
  const toLinear = (c: number) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const rLinear = toLinear(r);
  const gLinear = toLinear(g);
  const bLinear = toLinear(b);

  // Calculate relative luminance
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculate contrast ratio between two colors according to WCAG 2.0
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @returns Contrast ratio between 1 and 21
 */
function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determines whether to use white or black text on a colored background
 * by calculating which provides the highest contrast ratio.
 * Target: at least 4.5:1 (WCAG AA standard for normal text)
 * @param backgroundColor - Hex color of the background
 * @returns 'white' or 'black' - whichever has the highest contrast ratio
 */
export function getTextColorForBackground(backgroundColor: string): 'white' | 'black' {
  const whiteContrast = getContrastRatio(backgroundColor, '#FFFFFF');
  const blackContrast = getContrastRatio(backgroundColor, '#000000');

  // Return the color with the highest contrast ratio
  // If equal, prefer white text
  return whiteContrast >= blackContrast ? 'white' : 'black';
}
