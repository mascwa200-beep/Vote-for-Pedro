// Minimal synchronous pub/sub. The sim emits, the UI listens.
// Synchronous on purpose: an order and its consequence land in the same frame,
// so nothing ever shows a spinner waiting for a result.

const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => off(event, fn);
}

export function once(event, fn) {
  const wrapped = (payload) => { off(event, wrapped); fn(payload); };
  return on(event, wrapped);
}

export function off(event, fn) {
  handlers.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = handlers.get(event);
  if (set) {
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[events] ${event}`, err); }
    }
  }
  const wildcard = handlers.get('*');
  if (wildcard) {
    for (const fn of [...wildcard]) {
      try { fn({ event, payload }); } catch (err) { console.error('[events] *', err); }
    }
  }
}

export function clearAll() {
  handlers.clear();
}
