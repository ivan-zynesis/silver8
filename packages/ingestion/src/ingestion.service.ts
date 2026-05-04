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
  REGISTRY,
  buildResourceUri,
  parseResourceUri,
  type OrderBookStore,
  type ReadinessReporter,
  type Registry,
  type ResourceURI,
  type Unsubscribe,
} from '@silver8/core';
import type { Logger } from '@silver8/observability';
import {
  CoinbaseAdapter,
  type AdapterStatus,
} from './coinbase/coinbase.adapter.js';
import {
  INGESTION_RUNTIME_CONFIG,
  type IngestionRuntimeConfig,
} from './runtime-config.js';

const READINESS_KEY = 'ingestion';
const CATALOG_READINESS_KEY = 'ingestion.catalog';
const READINESS_POLL_MS = 200;

/**
 * Lifecycle owner for the ingestion subsystem (DEC-027).
 *
 * In `demand_driven` mode (default), upstream channel subscriptions are gated
 * on Registry demand-change events: a topic gets a first subscriber → channel
 * subscribe; last subscriber leaves → channel unsubscribe. The adapter handles
 * the socket-idle close after configurable grace.
 *
 * In `eager` mode (legacy / demo), all configured symbols subscribe at boot
 * regardless of demand — useful for keeping books warm without any consumer.
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readinessTimer: NodeJS.Timeout | null = null;
  private demandUnsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly coinbase: CoinbaseAdapter,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(READINESS_REPORTER) private readonly readiness: ReadinessReporter,
    @Inject(INGESTION_RUNTIME_CONFIG) private readonly runtime: IngestionRuntimeConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.readiness.declare(READINESS_KEY);

    // Catalog readiness (DEC-033). For the v1 hardcoded source the adapter
    // populates its catalog synchronously at construction, so this flips ready
    // immediately. A future REST-discovery adapter would surface a true
    // not-yet-ready window; the gate stays the same.
    this.readiness.declare(CATALOG_READINESS_KEY);
    this.readiness.set(CATALOG_READINESS_KEY, this.coinbase.catalogReady);

    if (this.runtime.lifecycle === 'eager') {
      this.bootstrapEager();
    } else {
      this.bootstrapDemandDriven();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info('ingestion shutting down');
    this.stopReadinessPoll();
    this.demandUnsubscribe?.();
    this.demandUnsubscribe = null;
    this.readiness.set(READINESS_KEY, false);
    this.readiness.set(CATALOG_READINESS_KEY, false);
    await this.coinbase.stop();
  }

  /** True once at least one snapshot has been received from upstream. */
  hasInitialSnapshot(): boolean {
    return this.store.knownTopics().length > 0;
  }

  status(): { coinbase: AdapterStatus; topicsKnown: ResourceURI[]; lifecycle: 'eager' | 'demand_driven' } {
    return {
      coinbase: this.coinbase.getStatus(),
      topicsKnown: [...this.store.knownTopics()],
      lifecycle: this.runtime.lifecycle,
    };
  }

  /** Returns the canonical ResourceURI list this ingestion is configured for. */
  configuredTopics(): ResourceURI[] {
    return this.coinbase
      .getStatus()
      .symbols.map((s) => buildResourceUri('coinbase', 'book', s));
  }

  // === lifecycle implementations ===

  private bootstrapEager(): void {
    this.logger.info('ingestion bootstrapping (eager — pre-subscribing configured symbols)');
    this.coinbase.start({ preSubscribe: this.runtime.symbols });
    // Eager mode: ready when first snapshot lands (legacy behavior).
    this.readinessTimer = setInterval(() => {
      if (this.hasInitialSnapshot()) {
        this.readiness.set(READINESS_KEY, true);
        this.stopReadinessPoll();
      }
    }, READINESS_POLL_MS);
  }

  private bootstrapDemandDriven(): void {
    this.logger.info(
      { configuredSymbols: this.runtime.symbols },
      'ingestion bootstrapping (demand-driven — channels subscribe on consumer demand)',
    );
    this.coinbase.start();
    // System is *capable* of serving demand; mark ready immediately. Per-topic
    // freshness is reported in /status (stale flag, lastTimestamp).
    this.readiness.set(READINESS_KEY, true);

    this.demandUnsubscribe = this.registry.onDemandChange((change) => {
      let symbol: string;
      try {
        const parsed = parseResourceUri(change.topic);
        if (parsed.kind !== 'book' || parsed.venue !== 'coinbase') return;
        symbol = parsed.symbol;
      } catch {
        return;
      }
      if (!this.runtime.symbols.includes(symbol)) {
        this.logger.warn(
          { topic: change.topic, available: this.runtime.symbols },
          'demand for non-configured symbol; ignoring',
        );
        return;
      }

      if (change.delta === 1 && change.count === 1) {
        this.logger.info({ symbol }, 'first consumer subscribed; opening upstream channel');
        this.coinbase.subscribeChannels([symbol]);
      } else if (change.delta === -1 && change.count === 0) {
        this.logger.info({ symbol }, 'last consumer left; closing upstream channel');
        this.coinbase.unsubscribeChannels([symbol]);
      }
    });
  }

  private stopReadinessPoll(): void {
    if (this.readinessTimer) {
      clearInterval(this.readinessTimer);
      this.readinessTimer = null;
    }
  }
}
