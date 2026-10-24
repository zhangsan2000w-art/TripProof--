/** Coalesce transient updates; callers flush at durable action boundaries. */
export function bufferedPersistence(write: () => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined, dirty = false, failure: unknown;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (failure) throw failure;
    if (!dirty) return;
    write(); dirty = false;
  };
  return {
    request(immediate = false) {
      if (failure) throw failure;
      dirty = true;
      if (immediate) flush();
      else timer ??= setTimeout(() => { try { flush(); } catch (error) { failure = error; } }, delay);
    },
    flush,
    dispose() { clearTimeout(timer); timer = undefined; },
  };
}
