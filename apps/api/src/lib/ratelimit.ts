import { createTokenBucketRateLimiter } from '@theme-tools/shared-utils/token-bucket-rate-limit';

const demoLimiter = createTokenBucketRateLimiter({
  capacity: 20,
  refillTokensPerSecond: 20 / 60,
  maxKeys: 10_000,
  staleAfterMs: 300_000,
});

export function allowDemo(ip: string, now: number): boolean {
  return demoLimiter.allow(ip, now);
}
