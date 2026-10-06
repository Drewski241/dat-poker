const hits = new Map<string, number[]>();

export function allowIpBucket(
  ip: string,
  bucket: string,
  now = Date.now(),
  max = 30,
  windowMs = 60 * 60 * 1000,
): boolean {
  const key = `${bucket}:${ip || "unknown"}`;
  const prev = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    hits.set(key, prev);
    return false;
  }
  prev.push(now);
  hits.set(key, prev);
  return true;
}

export function resetIpRateLimitsForTests(): void {
  hits.clear();
}
