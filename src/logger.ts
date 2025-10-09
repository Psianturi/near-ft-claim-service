import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pino, {
  type Bindings,
  type DestinationStream,
  type LoggerOptions,
  destination as createDestination,
} from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const defaultLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const baseConfig: LoggerOptions = {
  level: defaultLevel,
  base: {
    service: 'ft-claiming-service',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const transport = !isProduction && process.env.PINO_PRETTY !== 'false'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

if (transport) {
  (baseConfig as LoggerOptions).transport = transport;
}

const resolveDestination = (): DestinationStream | undefined => {
  const destinationPath = process.env.PINO_DESTINATION ?? process.env.PINO_LOG_PATH;
  if (!destinationPath) {
    return undefined;
  }

  const resolvedPath = resolve(destinationPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const syncEnv = process.env.PINO_SYNC?.toLowerCase();
  const sync = syncEnv === undefined || syncEnv === 'true' || syncEnv === '1';

  const minLengthEnv = process.env.PINO_MIN_LENGTH;
  const minLength = minLengthEnv ? Number.parseInt(minLengthEnv, 10) : undefined;

  return createDestination({
    dest: resolvedPath,
    sync,
    ...(Number.isFinite(minLength) ? { minLength } : {}),
  });
};

const destination = resolveDestination();

export const logger = destination ? pino(baseConfig, destination) : pino(baseConfig);

export const createLogger = (bindings?: Bindings) =>
  bindings ? logger.child(bindings) : logger;

export type Logger = typeof logger;
