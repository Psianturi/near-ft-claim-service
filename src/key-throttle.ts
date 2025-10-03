import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'throttle' });

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const globalPoints = parsePositiveInt(process.env.MAX_TX_PER_SECOND, 120);
const globalDuration = parsePositiveInt(process.env.GLOBAL_THROTTLE_WINDOW_SEC, 1);
const perKeyPoints = parsePositiveInt(process.env.MAX_TX_PER_KEY_PER_SECOND, 6);
const perKeyDuration = parsePositiveInt(process.env.PER_KEY_THROTTLE_WINDOW_SEC, 1);

const globalLimiter = new RateLimiterMemory({
  points: globalPoints,
  duration: globalDuration,
});

const perKeyLimiters = new Map<string, RateLimiterMemory>();

log.info({
  globalPoints,
  globalDuration,
  perKeyPoints,
  perKeyDuration,
}, 'Throttle configuration initialised');

export async function throttleGlobal(): Promise<void> {
  await globalLimiter.consume('global');
}

export async function throttleKey(keyId: string | null | undefined): Promise<void> {
  const limiterKey = keyId || 'default';
  let limiter = perKeyLimiters.get(limiterKey);
  if (!limiter) {
    limiter = new RateLimiterMemory({
      points: perKeyPoints,
      duration: perKeyDuration,
    });
    perKeyLimiters.set(limiterKey, limiter);
    log.debug({ limiterKey }, 'Created per-key rate limiter');
  }
  await limiter.consume('token');
}

export function getThrottleConfig() {
  return {
    globalPoints,
    globalDuration,
    perKeyPoints,
    perKeyDuration,
  };
}
