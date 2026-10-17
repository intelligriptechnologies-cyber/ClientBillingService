// Deliberately a raw fetch, not apiFetch: a failed report must never reload the page, or an error
// screen that cannot authenticate would reload forever.
export function reportClientError(message: string, stack?: string): void {
  void fetch('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, stack }),
    keepalive: true,
  }).catch((loggingError) => console.error('Unable to report client error', loggingError));
}

/** Report client exceptions to the tenant's downloadable operational log. */
export function reportClientException(operation: string, cause: unknown): void {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  reportClientError(`${operation}: ${error.message}`, error.stack);
}
