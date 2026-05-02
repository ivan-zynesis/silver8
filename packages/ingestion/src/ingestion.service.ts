import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  LOGGER,
  ORDER_BOOK_STORE,
  READINESS_REPORTER,
  buildResourceUri,
  type OrderBookStore,
  type ReadinessReporter,
  type ResourceURI,
} from '@silver8/core';
import type { Logger } from '@silver8/observability';
import { CoinbaseAdapter, type AdapterStatus } from './coinbase/coinbase.adapter.js';

const READINESS_KEY = 'ingestion';
const READINESS_POLL_MS = 200;

/**
 * Lifecycle owner for the ingestion subsystem. Starts the venue adapter on
 * application bootstrap, stops it on module destroy, and reports readiness once
 * at least one upstream snapshot has been received.
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readinessTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly coinbase: CoinbaseAdapter,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(READINESS_REPORTER) private readonly readiness: ReadinessReporter,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.info('ingestion bootstrapping');
    this.readiness.declare(READINESS_KEY);
    this.coinbase.start();

    // Lightweight poll until the first snapshot lands. We could thread an event
    // through the BookMaintainer, but a 200ms poll is unobtrusive and avoids
    // additional cross-package event plumbing for a one-shot transition.
    this.readinessTimer = setInterval(() => {
      if (this.hasInitialSnapshot()) {
        this.readiness.set(READINESS_KEY, true);
        if (this.readinessTimer) {
          clearInterval(this.readinessTimer);
          this.readinessTimer = null;
        }
      }
    }, READINESS_POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info('ingestion shutting down');
    if (this.readinessTimer) {
      clearInterval(this.readinessTimer);
      this.readinessTimer = null;
    }
    this.readiness.set(READINESS_KEY, false);
    await this.coinbase.stop();
  }

  /** True once at least one snapshot has been received from upstream. */
  hasInitialSnapshot(): boolean {
    return this.store.knownTopics().length > 0;
  }

  status(): { coinbase: AdapterStatus; topicsKnown: ResourceURI[] } {
    return {
      coinbase: this.coinbase.getStatus(),
      topicsKnown: [...this.store.knownTopics()],
    };
  }

  /** Returns the canonical ResourceURI list this ingestion is configured for. */
  configuredTopics(): ResourceURI[] {
    return this.coinbase
      .getStatus()
      .symbols.map((s) => buildResourceUri('coinbase', 'book', s));
  }
}
