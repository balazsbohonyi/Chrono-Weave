
// Helper for waiting
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    // Attach both handlers even if already aborted, so a late rejection from a
    // transport that ignores cancellation never becomes unhandled.
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

// Global queue to ensure we don't fire parallel requests that trigger 429 errors
let requestQueue: Promise<any> = Promise.resolve();

/**
 * Adds a task to the global execution queue. 
 * Ensures that API calls are serialized and have a buffer delay between them.
 */
export function enqueueTask<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  // We chain the new task to the end of the current queue
  const result = requestQueue.then(async () => {
    // Add a 1-second buffer between requests to respect RPM limits
    signal?.throwIfAborted();
    await wait(1000, signal);
    signal?.throwIfAborted();
    return task();
  });

  // Update the queue pointer. We catch errors so a failed request doesn't block the queue forever.
  requestQueue = result.catch(() => {});

  return withAbort(result, signal);
}

export async function runWithRetry<T>(fn: () => Promise<T>, retries = 5, backoff = 3000, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await fn();
  } catch (err: any) {
    signal?.throwIfAborted();
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
      await wait(backoff, signal);
      return runWithRetry(fn, retries - 1, backoff * 2, signal);
    }
    throw err;
  }
}

/**
 * Wrapper that combines Queueing AND Retrying.
 * This is the main function to use for all API calls.
 */
export async function enqueueTaskWithRetry<T>(apiCall: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return enqueueTask(() => runWithRetry(apiCall, 5, 3000, signal), signal);
}

