export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|network/i.test(msg)) return 'Connection problem — check your internet and try again.';
  if (/jwt|session expired|not authenticated/i.test(msg)) return 'Your session expired — please refresh the page.';
  // Strip any URL or stack from the message
  return (msg.split('\n')[0] || '').slice(0, 200);
}
