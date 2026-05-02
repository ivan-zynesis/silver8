/**
 * Re-export of the Drainable contract; the ShutdownService in apps/hub uses
 * this same shape. Keeping a copy in the gateway package avoids a backwards
 * dependency from a package onto the app.
 */
export interface Drainable {
  readonly drainName: string;
  drain(deadlineMs: number): Promise<void>;
}
