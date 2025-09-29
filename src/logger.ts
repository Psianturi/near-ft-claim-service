import pino, { type Bindings, type LoggerOptions } from 'pino';

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

export const logger = pino(baseConfig);

export const createLogger = (bindings?: Bindings) =>
  bindings ? logger.child(bindings) : logger;

export type Logger = typeof logger;
