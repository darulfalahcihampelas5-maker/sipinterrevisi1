/**
 * Robust fetch wrapper with automatic retry capabilities.
 * Handles intermittent NetworkError, connection failures, and server restart hiccups.
 */

export interface RetryOptions {
  retries?: number;
  delay?: number;
  backoff?: number;
  retryOnStatusCodes?: number[];
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const {
    retries = 3,
    delay = 1000,
    backoff = 2,
    retryOnStatusCodes = [502, 503, 504],
  } = options;

  let lastError: any = null;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, init);

      // If response is successful, or not in the retry status code list, return it
      if (response.ok || !retryOnStatusCodes.includes(response.status)) {
        return response;
      }

      // If it is a retryable server error, throw to trigger retry
      throw new Error(`Server returned status ${response.status}`);
    } catch (error: any) {
      lastError = error;

      // Check if it's a network error or a retryable server error
      const isNetworkError =
        error instanceof TypeError || // Standard fetch connection failure
        (error.message && (
          error.message.toLowerCase().includes("failed to fetch") ||
          error.message.toLowerCase().includes("networkerror") ||
          error.message.toLowerCase().includes("network error") ||
          error.message.toLowerCase().includes("aborted")
        ));

      const isRetryableStatus = error.message && error.message.includes("Server returned status");

      if (!isNetworkError && !isRetryableStatus) {
        // If it's a client error (like 400, 401, 403, 404), throw immediately
        throw error;
      }

      console.warn(
        `[fetchWithRetry] Attempt ${attempt} failed: ${error.message || error}. Retrying in ${currentDelay}ms...`
      );

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay *= backoff;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch after ${retries} attempts`);
}
