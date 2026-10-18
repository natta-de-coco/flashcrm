type Attempt = { key: string; conversationId: string; ref: string; pending: boolean };

/** Session-memory ownership follows the drafts, including uncertain send retries. */
export class InboxSendSession {
  private attempts = new Map<string, Attempt>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private notify() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }
  isPending(conversationId: string | null) {
    return [...this.attempts.values()].some(
      (a) => a.conversationId === conversationId && a.pending,
    );
  }
  begin(key: string, conversationId: string, nextRef: () => string): Attempt | null {
    // Synchronous ownership also covers two clicks before React renders again.
    if (this.isPending(conversationId)) return null;
    const previous = this.attempts.get(key);
    const attempt = { key, conversationId, ref: previous?.ref ?? nextRef(), pending: true };
    this.attempts.set(key, attempt);
    this.notify();
    return attempt;
  }
  finish(key: string, ref: string, answered: boolean) {
    const current = this.attempts.get(key);
    if (!current || current.ref !== ref) return;
    if (answered) this.attempts.delete(key);
    else this.attempts.set(key, { ...current, pending: false });
    this.notify();
  }
}
