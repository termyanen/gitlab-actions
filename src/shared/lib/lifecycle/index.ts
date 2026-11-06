/** Owned resources for one document or route. Disposal is idempotent. */
export function createLifecycle() {
  const abort = new AbortController();
  const cleanups = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let disposed = false;
  function onCleanup(cleanup: () => void) {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanups.delete(release);
      cleanup();
    };
    if (disposed) release();
    else cleanups.add(release);
    return release;
  }
  function guard<A extends unknown[], R>(callback: (...args: A) => R) {
    return (...args: A): R | undefined =>
      disposed ? undefined : callback(...args);
  }
  /** One-shot async replies must release their view even if delivery stalls. */
  function once<A extends unknown[], R>(callback: (...args: A) => R) {
    let pending: ((...args: A) => R) | undefined = callback;
    const release = onCleanup(() => {
      pending = undefined;
    });
    return (...args: A): R | undefined => {
      const current = pending;
      release();
      return current?.(...args);
    };
  }
  function timeout(callback: () => void, delay?: number) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
    }, delay);
    if (disposed) clearTimeout(id);
    else timers.add(id);
    return id;
  }
  function cancelTimeout(id: ReturnType<typeof setTimeout> | undefined) {
    if (id === undefined) return;
    clearTimeout(id);
    timers.delete(id);
  }
  function interval(callback: () => void, delay?: number) {
    const id = setInterval(() => {
      if (!disposed) callback();
    }, delay);
    if (disposed) clearInterval(id);
    else intervals.add(id);
    return id;
  }
  function cancelInterval(id: ReturnType<typeof setInterval> | undefined) {
    if (id === undefined) return;
    clearInterval(id);
    intervals.delete(id);
  }
  function observer(callback: MutationCallback): MutationObserver {
    const instance = new MutationObserver((records, observer) => {
      if (!disposed) callback(records, observer);
    });
    onCleanup(() => instance.disconnect());
    return {
      observe: (target, options) => {
        if (!disposed) instance.observe(target, options);
      },
      disconnect: () => instance.disconnect(),
      takeRecords: () => instance.takeRecords(),
    };
  }
  // Infer the event from its name; the target only proves it supports that listener.
  function listen<K extends keyof (DocumentEventMap & WindowEventMap)>(
    target: {
      addEventListener(
        type: NoInfer<K>,
        listener: (
          event: (DocumentEventMap & WindowEventMap)[NoInfer<K>],
        ) => void,
        options?: boolean | AddEventListenerOptions,
      ): void;
      removeEventListener(
        type: NoInfer<K>,
        listener: (
          event: (DocumentEventMap & WindowEventMap)[NoInfer<K>],
        ) => void,
        options?: boolean | EventListenerOptions,
      ): void;
    },
    event: K,
    callback: (event: (DocumentEventMap & WindowEventMap)[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ) {
    const handler = guard(callback);
    if (!disposed) target.addEventListener(event, handler, options);
    let active = true;
    return onCleanup(() => {
      if (active) target.removeEventListener(event, handler, options);
      active = false;
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    timers.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    cleanups.forEach((cleanup) => cleanup());
    timers.clear();
    intervals.clear();
    cleanups.clear();
  }
  return {
    get disposed() {
      return disposed;
    },
    signal: abort.signal,
    onCleanup,
    guard,
    once,
    timeout,
    cancelTimeout,
    interval,
    cancelInterval,
    observer,
    listen,
    dispose,
  };
}
export type Lifecycle = ReturnType<typeof createLifecycle>;

/** A dialog can end before its route. Release the parent's registration too. */
export function createChildLifecycle(parent: Lifecycle): Lifecycle {
  const child = createLifecycle();
  const release = parent.onCleanup(child.dispose);
  child.onCleanup(release);
  return child;
}
