
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
