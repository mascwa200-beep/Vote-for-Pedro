// Touch, haptics, wake lock, and the other things a phone needs that a
// desktop build never thinks about.

let settings = { haptics: true, wakeLock: true };

export function configureTouch(next) {
  settings = { ...settings, ...next };
  if (!settings.wakeLock) releaseWakeLock();
}

// ---------------- Haptics ----------------

const PATTERNS = {
  tap: 8,
  select: [0, 10],
  confirm: [0, 12, 40, 12],
  deny: [0, 30, 50, 30],
  hit_light: 14,
  hit_heavy: [0, 40, 30, 60],
  alert: [0, 60, 80, 60, 80, 60],
  explosion: [0, 90, 40, 140],
  warp: [0, 20, 30, 20, 30, 40],
};

export function haptic(kind = 'tap') {
  if (!settings.haptics) return;
  const pattern = PATTERNS[kind] ?? PATTERNS.tap;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// ---------------- Wake lock ----------------

let wakeLockSentinel = null;

export async function requestWakeLock() {
  if (!settings.wakeLock) return;
  try {
    if (wakeLockSentinel) return;
    wakeLockSentinel = await navigator.wakeLock?.request('screen');
    wakeLockSentinel?.addEventListener('release', () => { wakeLockSentinel = null; });
  } catch { /* denied or unsupported; the game plays fine either way */ }
}

export function releaseWakeLock() {
  try { wakeLockSentinel?.release(); } catch { /* already gone */ }
  wakeLockSentinel = null;
}

// Re-acquire after the user switches back to the app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLockSentinel === null && settings.wakeLock) {
    requestWakeLock();
  }
});

// ---------------- Gestures ----------------

/**
 * Attach pan/pinch handling to a canvas. Returns a live view object
 * { x, y, scale } that the renderer reads each frame.
 */
export function attachPanZoom(canvas, view, opts = {}) {
  const { minScale = 0.4, maxScale = 6, onTap = null, onUserView = null } = opts;
  const pointers = new Map();
  let lastDistance = 0;
  let moved = false;
  let downAt = 0;

  const center = () => {
    const pts = [...pointers.values()];
    return {
      x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
      y: pts.reduce((n, p) => n + p.y, 0) / pts.length,
    };
  };

  // Every listener this attaches, so it can be taken off again. The canvas is
  // a singleton that is MOVED between screens rather than rebuilt — a WebGL
  // context is expensive and browsers cap how many can exist — so a view that
  // attaches and is thrown away without detaching leaves its handlers on a
  // node that outlives it. Five per fight, and every stale generation still
  // fired its onTap into an engagement that no longer existed.
  const attached = [];
  const listen = (type, fn, opts) => {
    canvas.addEventListener(type, fn, opts);
    attached.push([type, fn, opts]);
  };

  listen('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { moved = false; downAt = performance.now(); }
    lastDistance = 0;
  });

  listen('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { moved = true; onUserView?.(); }
      view.x += dx / view.scale;
      view.y += dy / view.scale;
    }
    pointers.set(e.pointerId, next);

    if (pointers.size === 2) {
      moved = true;
      onUserView?.();
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDistance > 0) {
        const factor = d / lastDistance;
        view.scale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
      }
      lastDistance = d;
      void center();
    }
  });

  const release = (e) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    lastDistance = 0;
    if (wasSingle && !moved && onTap && performance.now() - downAt < 500) {
      const rect = canvas.getBoundingClientRect();
      onTap(e.clientX - rect.left, e.clientY - rect.top);
    }
  };
  listen('pointerup', release);
  listen('pointercancel', release);

  // Desktop convenience; harmless on touch.
  listen('wheel', (e) => {
    e.preventDefault();
    onUserView?.();
    view.scale = Math.max(minScale, Math.min(maxScale, view.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });

  // The view is what callers have always used; `detach` is hung off it so
  // nothing that already destructures the return value has to change.
  view.detach = () => {
    for (const [type, fn, opts] of attached) canvas.removeEventListener(type, fn, opts);
    attached.length = 0;
    pointers.clear();
  };
  return view;
}

/** Size a canvas to its CSS box at device pixel ratio. Returns the 2D context. */
export function fitCanvas(canvas) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

/** Keep the on-screen keyboard from covering the order bar. */
export function trackViewportInsets() {
  const vv = globalThis.visualViewport;
  if (!vv) return;
  const apply = () => {
    const inset = Math.max(0, globalThis.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    document.body.style.paddingBottom = inset > 60 ? `${inset}px` : '';
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}
