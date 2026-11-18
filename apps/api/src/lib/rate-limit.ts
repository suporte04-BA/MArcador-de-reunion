/**
 * Limite de tentativas em memória (janela deslizante simples).
 * Protege login, recuperação de senha e envio de e-mail de teste.
 * O armazenamento é por processo: suficiente para uma aplicação única na LAN.
 */

type Bucket = { hits: number[]; lockedUntil: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number; lockMs?: number },
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    if (buckets.size > MAX_BUCKETS) {
      // Descarta os itens expirados antes de recusar novos.
      for (const [k, b] of buckets) {
        if (b.lockedUntil < now && b.hits.every((t) => now - t > options.windowMs)) {
          buckets.delete(k);
        }
      }
    }
    bucket = { hits: [], lockedUntil: 0 };
    buckets.set(key, bucket);
  }

  if (bucket.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000),
    };
  }

  bucket.hits = bucket.hits.filter((t) => now - t <= options.windowMs);

  if (bucket.hits.length >= options.limit) {
    const lockMs = options.lockMs ?? options.windowMs;
    bucket.lockedUntil = now + lockMs;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(lockMs / 1000),
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: options.limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}

/** Libera o bucket após autenticação bem-sucedida. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Uso em testes: limpa todo o estado. */
export function clearRateLimits(): void {
  buckets.clear();
}
