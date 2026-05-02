import type { ChannelKind, Symbol, Venue } from './types.js';
import { InvalidUriError } from './errors.js';

/** Resource URI shape: market://<venue>/<channel>/<symbol>  e.g. market://coinbase/book/BTC-USD */
export type ResourceURI = `market://${Venue}/${ChannelKind}/${Symbol}`;

const URI_PATTERN = /^market:\/\/([a-z0-9-]+)\/([a-z]+)\/([A-Z0-9-]+)$/;

export interface ParsedURI {
  venue: Venue;
  kind: ChannelKind;
  symbol: Symbol;
}

export function buildResourceUri(venue: Venue, kind: ChannelKind, symbol: Symbol): ResourceURI {
  return `market://${venue}/${kind}/${symbol}` as ResourceURI;
}

export function parseResourceUri(uri: string): ParsedURI {
  const match = uri.match(URI_PATTERN);
  if (!match) {
    throw new InvalidUriError(`Invalid resource URI: ${uri}. Expected market://<venue>/<kind>/<symbol>.`);
  }
  const [, venue, kind, symbol] = match;
  return { venue: venue as Venue, kind: kind as ChannelKind, symbol };
}

export function isResourceUri(value: unknown): value is ResourceURI {
  return typeof value === 'string' && URI_PATTERN.test(value);
}
