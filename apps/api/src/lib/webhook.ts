import type { WebhookConfig, WebhookEvent } from '@crawlcheap/contracts';

/** HMAC-SHA256 hex of a body under a secret (for webhook signatures). */
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Check whether a lifecycle event ('started' | 'page' | 'completed' | 'failed') is enabled in `cfg.events`. */
export function shouldDeliverWebhookEvent(
  cfg: WebhookConfig,
  eventType: WebhookEvent['type'],
): boolean {
  if (!cfg.events || cfg.events.length === 0) return true;
  const suffix = eventType.split('.').pop() as 'started' | 'page' | 'completed' | 'failed';
  return cfg.events.includes(suffix);
}

/**
 * Deliver a signed webhook with retries.
 * Emits both `x-crawlcheap-signature` and `x-firecrawl-signature` (`sha256=<hmac>`)
 * plus `x-crawlcheap-event` and `x-firecrawl-event` for 100% Firecrawl webhook consumer parity.
 */
export async function deliverWebhook(
  cfg: WebhookConfig,
  event: WebhookEvent,
  secret = 'crawlcheap-default-webhook-secret',
): Promise<boolean> {
  if (!shouldDeliverWebhookEvent(cfg, event.type)) return false;
  const body = JSON.stringify(event);
  const signature = `sha256=${await hmacHex(secret, body)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-crawlcheap-signature': signature,
    'x-firecrawl-signature': signature,
    'x-crawlcheap-event': event.type,
    'x-firecrawl-event': event.type,
    ...(cfg.headers ?? {}),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return false;
}
