/** Sliding-window in-memory limiter (single API process). Returns true when the key is over the limit. */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  function recent(key) {
    const now = Date.now();
    return (hits.get(key) || []).filter((t) => now - t < windowMs);
  }

  return {
    /** Count one hit and report whether the key exceeded the limit. */
    hit(key) {
      const list = recent(key);
      if (list.length >= max) {
        hits.set(key, list);
        return true;
      }
      list.push(Date.now());
      hits.set(key, list);
      return false;
    },
    /** Report whether the key is over the limit without counting a hit. */
    blocked(key) {
      return recent(key).length >= max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
