import { pino, type Logger as PinoLogger, type LoggerOptions, stdTimeFunctions } from 'pino';

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  /** Static fields injected on every log line (e.g. mode, version). */
  base?: Record<string, unknown>;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const baseOpts: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { ...opts.base },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (opts.pretty || process.env.LOG_PRETTY === '1') {
    return pino({
      ...baseOpts,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  }

  return pino(baseOpts);
}
