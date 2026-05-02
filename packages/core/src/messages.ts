import type { BookView } from './types.js';
import type { ResourceURI } from './uri.js';

/**
 * Internal message format published on the Bus by the ingestion tier and consumed
 * by gateway / MCP layers. Lossy by design (DEC-005); subscribers that fall behind
 * get drops via their per-consumer queue policy (DEC-011).
 */
export type BusMessage =
  | BookSnapshotMessage
  | BookUpdateMessage
  | BookStaleMessage
  | BookFreshMessage;

export interface BookSnapshotMessage {
  kind: 'book.snapshot';
  uri: ResourceURI;
  /** Top-N view after the snapshot was applied. */
  view: BookView;
}

export interface BookUpdateMessage {
  kind: 'book.update';
  uri: ResourceURI;
  /** Top-N view after the update was applied. */
  view: BookView;
}

export interface BookStaleMessage {
  kind: 'book.stale';
  uri: ResourceURI;
  reason: string;
}

export interface BookFreshMessage {
  kind: 'book.fresh';
  uri: ResourceURI;
}

export function isBookContentMessage(
  msg: BusMessage,
): msg is BookSnapshotMessage | BookUpdateMessage {
  return msg.kind === 'book.snapshot' || msg.kind === 'book.update';
}
