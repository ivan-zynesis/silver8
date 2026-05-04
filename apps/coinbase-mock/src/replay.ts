import { l2EventProductId, type Envelope } from './fixture.js';

export type Channel = 'level2' | 'heartbeats';

/**
 * Per-connection replay state. Owns:
 *  - current subscription set (which (channel, symbol) pairs the client wants)
 *  - replay cursor (position into the fixture envelope list)
 *  - per-connection monotonic sequence counter (rewrites fixture's seq_nums
 *    so each connection sees a clean monotonic stream regardless of fixture)
 *  - pending fault-injection flags
 */
export class ConnectionReplay {
  private cursor = 0;
  private nextSeq = 1;
  private subs: Set<string> = new Set(); // "<channel>:<product_id>"
  private heartbeatsSubscribed = false;
  /** When set: skip the next sequence number once (gap injection). */
  private pendingGap = false;
  /** When > 0: silence emissions for this many ms (set wall-time deadline). */
  private silenceUntilMs = 0;

  constructor(private readonly fixture: Envelope[], private readonly loop: boolean) {}

  subscribe(channel: Channel, productIds: string[]): void {
    if (channel === 'heartbeats') {
      this.heartbeatsSubscribed = true;
      return;
    }
    for (const p of productIds) this.subs.add(`${channel}:${p}`);
  }

  unsubscribe(channel: Channel, productIds: string[]): void {
    if (channel === 'heartbeats') {
      this.heartbeatsSubscribed = false;
      return;
    }
    for (const p of productIds) this.subs.delete(`${channel}:${p}`);
  }

  injectGap(): void {
    this.pendingGap = true;
  }

  silenceFor(ms: number): void {
    this.silenceUntilMs = Date.now() + ms;
  }

  isSilenced(): boolean {
    return Date.now() < this.silenceUntilMs;
  }

  /** Returns the current subscription set as a flat list (for diagnostics). */
  subscriptionSnapshot(): string[] {
    const out = [...this.subs];
    if (this.heartbeatsSubscribed) out.push('heartbeats:*');
    return out.sort();
  }

  /**
   * Pull the next envelope to emit, filtered by the connection's current
   * subscriptions and rewritten with a fresh sequence_num. Returns `null` if:
   *  - the cursor reached the end (only in !loop mode), or
   *  - no envelope in the fixture matches any subscription.
   *
   * In loop mode, cursor wraps back to 0 after the last envelope.
   * In !loop mode, after the last envelope is consumed, all subsequent
   * next() calls return null even if subscriptions change.
   *
   * The cursor is held as a non-modulo index in [0, fixture.length] so that
   * "reached the end" is unambiguous; loop-mode resets it explicitly.
   */
  next(): Envelope | null {
    if (this.fixture.length === 0) return null;

    // Try each envelope at most once per call. If we scan the full fixture
    // without finding a match, return null — no point looping forever when
    // subscriptions don't intersect any envelope.
    for (let scanned = 0; scanned < this.fixture.length; scanned += 1) {
      if (this.cursor === this.fixture.length) {
        if (!this.loop) return null;
        this.cursor = 0;
      }
      const env = this.fixture[this.cursor];
      this.cursor += 1;

      const filtered = this.filter(env);
      if (filtered) return this.assignSequence(filtered);
    }
    return null;
  }

  private filter(env: Envelope): Envelope | null {
    if (env.channel === 'heartbeats') {
      return this.heartbeatsSubscribed ? env : null;
    }
    if (env.channel === 'l2_data') {
      const matchingEvents = env.events.filter((e) => {
        const pid = l2EventProductId(e);
        return pid !== null && this.subs.has(`level2:${pid}`);
      });
      if (matchingEvents.length === 0) return null;
      return { ...env, events: matchingEvents };
    }
    // Other channels (subscriptions, status, etc.) we just pass through unchanged
    // if any subscription exists at all; otherwise skip.
    if (this.subs.size === 0 && !this.heartbeatsSubscribed) return null;
    return env;
  }

  private assignSequence(env: Envelope): Envelope {
    let seq = this.nextSeq++;
    if (this.pendingGap) {
      this.pendingGap = false;
      seq = this.nextSeq++; // skip one
    }
    return { ...env, sequence_num: seq };
  }
}
