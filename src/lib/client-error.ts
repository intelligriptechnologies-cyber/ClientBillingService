/** Report client exceptions to the tenant's downloadable operational log. */
export function reportClientException(operation: string, cause: unknown): void {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  void fetch('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `${operation}: ${error.message}`, stack: error.stack }),
    keepalive: true,
  }).catch((loggingError) => console.error('Unable to report client exception', loggingError));
}
