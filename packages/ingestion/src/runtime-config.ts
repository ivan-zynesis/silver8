/**
 * Runtime configuration for the ingestion subsystem — small, framework-free,
 * threaded through the IngestionModule.forRoot DI.
 */
export interface IngestionRuntimeConfig {
  lifecycle: 'demand_driven' | 'eager';
  symbols: string[];
}

export const INGESTION_RUNTIME_CONFIG = Symbol.for('silver8.IngestionRuntimeConfig');
