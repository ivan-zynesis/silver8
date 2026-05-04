/**
 * Capture a real Coinbase Advanced Trade WS session to a JSONL fixture.
 * Developer tool — run manually when you want a fresh fixture grounded in
 * actual venue behavior. NOT part of CI; not run by the integration suite.
 *
 * Usage:
 *   pnpm --filter @silver8/coinbase-mock record
 *   # honors RECORD_PRODUCTS=BTC-USD,ETH-USD  RECORD_DURATION_S=120  RECORD_OUT=path
 */

import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';

const URL_DEFAULT = 'wss://advanced-trade-ws.coinbase.com';
const PRODUCTS = (process.env.RECORD_PRODUCTS ?? 'BTC-USD,ETH-USD').split(',').map((s) => s.trim());
const DURATION_S = Number(process.env.RECORD_DURATION_S ?? '60');
const OUT_PATH = resolve(process.env.RECORD_OUT ?? `fixtures/recorded-${Date.now()}.jsonl`);
const URL = process.env.RECORD_URL ?? URL_DEFAULT;

async function main(): Promise<void> {
  const ws = new WebSocket(URL);
  const out = createWriteStream(OUT_PATH);
  let count = 0;

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: PRODUCTS, channel: 'level2' }));
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: PRODUCTS, channel: 'heartbeats' }));
    // eslint-disable-next-line no-console
    console.log(`[record] connected; recording ${PRODUCTS.join(',')} for ${DURATION_S}s → ${OUT_PATH}`);
  });

  ws.on('message', (data) => {
    out.write(data.toString('utf8') + '\n');
    count += 1;
  });

  ws.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[record] error:', err);
  });

  setTimeout(() => {
    ws.close();
    out.end(() => {
      // eslint-disable-next-line no-console
      console.log(`[record] done; ${count} envelopes written to ${OUT_PATH}`);
      process.exit(0);
    });
  }, DURATION_S * 1000);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
