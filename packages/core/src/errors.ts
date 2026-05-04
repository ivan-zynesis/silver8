/**
 * All hub-level errors extend HubError so adapters can branch cleanly.
 * Error messages are written to be actionable for an LLM agent (DS-LLM-USABILITY).
 */
export class HubError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidUriError extends HubError {
  constructor(message: string) {
    super(message, 'invalid_uri');
  }
}

export class UnknownTopicError extends HubError {
  constructor(uri: string, available: string[]) {
    const list = available.length > 0 ? available.slice(0, 10).join(', ') : '(none available)';
    super(
      `unknown topic ${uri}; available topics: ${list}${available.length > 10 ? ' …' : ''}`,
      'unknown_topic',
    );
  }
}

export class UnknownSymbolError extends HubError {
  constructor(symbol: string, available: string[]) {
    const list = available.length > 0 ? available.join(', ') : '(none configured)';
    super(`unknown symbol ${symbol}; available symbols: ${list}`, 'unknown_symbol');
  }
}

export class UnknownVenueError extends HubError {
  constructor(venue: string, available: string[]) {
    super(`unknown venue ${venue}; supported venues: ${available.join(', ')}`, 'unknown_venue');
  }
}

export class ConsumerLaggedError extends HubError {
  constructor(consumerId: string, dropped: number) {
    super(
      `consumer ${consumerId} disconnected: queue overflow sustained, ${dropped} messages dropped`,
      'consumer_lagged',
    );
  }
}

export class StaleTopicError extends HubError {
  constructor(uri: string, reason: string) {
    super(`topic ${uri} is stale: ${reason}; resync in progress`, 'stale_topic');
  }
}

export class CompositionError extends HubError {
  constructor(message: string) {
    super(message, 'composition_error');
  }
}
