import 'reflect-metadata';
import { SharedGlobalObserver, mutationsMatchSelector } from '@core/observers/SharedGlobalObserver';

export type ObserverBenchmarkMode = 'shared-full' | 'independent-full' | 'shared-filtered' | 'independent-targeted';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const subscribers = 8;
const throttleMs = 10;

/** Production sharing/filtering vs equivalent native independent observers. */
export async function measureObserver(size: number, mode: ObserverBenchmarkMode) {
  const NativeObserver = window.MutationObserver;
  const nativeMatches = Element.prototype.matches;
  const nativeClosest = Element.prototype.closest;
  const nativeQuery = Element.prototype.querySelector;
  const host = document.createElement('section');
  const scopes = Array.from({ length: subscribers }, (_, index) => {
    const scope = document.createElement('div'); scope.dataset.observerScope = String(index); host.append(scope); return scope;
  });
  for (let index = 0; index < size - subscribers - 1; index++) {
    const node = document.createElement('span'); node.textContent = `Synthetic ${index}`;
    scopes[index % subscribers].append(node);
  }
  document.body.append(host);
  const initialDomElements = host.querySelectorAll('*').length + 1;
  let phase: 'main' | 'pending-cleanup' | 'after-cleanup' = 'main';
  let nativeObserversCreated = 0; let nativeObserversActive = 0; let nativeDisconnects = 0;
  let nativeDeliveries = 0; let nativeRecordsDelivered = 0; let nativeDispatchMs = 0;
  let filterCalls = 0; let filterAccepted = 0; let filterRecordInputs = 0; let filterMs = 0;
  let inFilter = false;
  const filterSelectors = { matches: 0, closest: 0, querySelector: 0 };
  let subscriberCalls = 0; let scans = 0; let nodesVisited = 0; let scanMs = 0; let checksum = 0;
  let firstNativeDeliveryAt: number | null = null; let lastSubscriberAt = 0;
  const perSubscriberCalls = Array<number>(subscribers).fill(0);
  const perSubscriberVisited = Array<number>(subscribers).fill(0);
  const expectedCalls = mode.endsWith('full') ? subscribers : 1;
  let completeMain: () => void = () => {};
  const mainDone = new Promise<void>(resolve => { completeMain = resolve; });
  let pendingDelivered: () => void = () => {};
  let shared: SharedGlobalObserver | null = null;
  const independents: MutationObserver[] = [];
  const timers = new Map<number, number>();
  const restoration = { nativeConstructorRestored: false, selectorMethodsRestored: false, syntheticHostRemoved: false };
  class AuditedObserver extends NativeObserver {
    private active = false;
    constructor(callback: MutationCallback) {
      super((records, observer) => {
        const started = performance.now(); nativeDeliveries++; nativeRecordsDelivered += records.length;
        firstNativeDeliveryAt ??= started;
        try { callback(records, observer); }
        finally { nativeDispatchMs += performance.now() - started; if (phase === 'pending-cleanup') pendingDelivered(); }
      });
      nativeObserversCreated++;
    }
    override observe(target: Node, options?: MutationObserverInit): void {
      if (!this.active) { nativeObserversActive++; this.active = true; }
      super.observe(target, options);
    }
    override disconnect(): void {
      if (this.active) { nativeObserversActive--; this.active = false; }
      nativeDisconnects++; super.disconnect();
    }
  }
  const scan = (index: number, root: Element) => {
    const started = performance.now(); const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let visited = 1; let localChecksum = root.tagName.length; let node = walker.nextNode();
    while (node) { visited++; localChecksum += (node as Element).tagName.length; node = walker.nextNode(); }
    scanMs += performance.now() - started; checksum += localChecksum;
    nodesVisited += visited; perSubscriberVisited[index] += visited;
    scans++; subscriberCalls++; perSubscriberCalls[index]++;
    lastSubscriberAt = performance.now();
    if (phase === 'main' && subscriberCalls === expectedCalls) completeMain();
  };
  const cleanup = () => {
    if (shared) shared.destroy();
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear(); independents.forEach(observer => observer.disconnect());
  };
  try {
    window.MutationObserver = AuditedObserver;
    // These count explicit filter method calls, including short circuiting.
    // Their audit overhead is included in filter/dispatch timing.
    Element.prototype.matches = function (this: Element, selector: string) { if (inFilter) filterSelectors.matches++; return nativeMatches.call(this, selector); };
    Element.prototype.closest = function (this: Element, selector: string) { if (inFilter) filterSelectors.closest++; return nativeClosest.call(this, selector); } as typeof Element.prototype.closest;
    Element.prototype.querySelector = function (this: Element, selector: string) { if (inFilter) filterSelectors.querySelector++; return nativeQuery.call(this, selector); } as typeof Element.prototype.querySelector;
    const registrationStarted = performance.now();
    if (mode.startsWith('shared')) {
      shared = new SharedGlobalObserver();
      for (let index = 0; index < subscribers; index++) {
        const matcher = mutationsMatchSelector(`[data-observer-scope="${index}"]`);
        shared.register(`subscriber_${index}`, () => scan(index, mode === 'shared-full' ? document.body : scopes[index]), throttleMs,
          mode === 'shared-filtered' ? records => {
            const started = performance.now(); filterCalls++; filterRecordInputs += records.length; inFilter = true;
            try { const accepted = matcher(records); if (accepted) filterAccepted++; return accepted; }
            finally { inFilter = false; filterMs += performance.now() - started; }
          } : undefined);
      }
    } else for (let index = 0; index < subscribers; index++) {
      const observer = new MutationObserver(() => {
        if (timers.has(index)) return;
        const timer = window.setTimeout(() => {
          if (timers.get(index) !== timer) return;
          timers.delete(index); scan(index, mode === 'independent-full' ? document.body : scopes[index]);
        }, throttleMs);
        timers.set(index, timer);
      });
      observer.observe(mode === 'independent-full' ? document.body : scopes[index], { childList: true, subtree: true });
      independents.push(observer);
    }
    const registrationMs = performance.now() - registrationStarted;
    const mutationStarted = performance.now();
    for (let index = 0; index < 100; index++) {
      const node = document.createElement('span'); node.textContent = `Inserted ${index}`; scopes[0].append(node);
    }
    const insertionMs = performance.now() - mutationStarted;
    let deadline: number | undefined;
    try {
      await Promise.race([mainDone, new Promise<never>((_, reject) => { deadline = window.setTimeout(() => reject(new Error(`Observer callbacks did not finish: ${mode} ${subscriberCalls}/${expectedCalls}`)), 3000); })]);
    } finally { if (deadline !== undefined) window.clearTimeout(deadline); }
    await pause(0);
    if (subscriberCalls !== expectedCalls || initialDomElements !== size) throw new Error('Observer workload cardinality mismatch');
    const measured = { size, mode, subscribers, insertions: 100, throttleMs, initialDomElements,
      domElementsAfterBurst: host.querySelectorAll('*').length + 1,
      nativeObserversCreated, nativeObserversActive, nativeDeliveries, nativeRecordsDelivered, nativeDispatchMs,
      subscriberCalls, perSubscriberCalls: [...perSubscriberCalls], scans, nodesVisited, perSubscriberVisited: [...perSubscriberVisited], scanMs, checksum,
      filterCalls, filterAccepted, filterRecordInputs, filterSelectors: { ...filterSelectors }, filterMs,
      registrationMs, insertionMs, firstNativeDeliveryMs: (firstNativeDeliveryAt ?? mutationStarted) - mutationStarted,
      burstToLastSubscriberMs: lastSubscriberAt - mutationStarted };
    // Queue a genuine native delivery and destroy while its throttle is pending.
    phase = 'pending-cleanup';
    const delivered = new Promise<void>(resolve => { pendingDelivered = resolve; });
    scopes[0].append(document.createElement('span')); await delivered;
    const pendingThrottleCount = shared
      ? (shared as unknown as { throttleTimeouts: Map<string, number> }).throttleTimeouts.size : timers.size;
    if (pendingThrottleCount !== expectedCalls) throw new Error(`Cleanup probe had ${pendingThrottleCount} pending callbacks, expected ${expectedCalls}`);
    const callsBeforeCleanup = subscriberCalls; const deliveriesBeforeCleanup = nativeDeliveries;
    const cleanupStarted = performance.now(); cleanup(); const cleanupMs = performance.now() - cleanupStarted;
    phase = 'after-cleanup'; scopes[0].append(document.createElement('span')); await pause(throttleMs * 3);
    const stopped = shared?.getStatus() ?? { isStarted: false, callbackCount: 0 };
    const noLateSubscribers = subscriberCalls === callsBeforeCleanup;
    const noLateNativeDeliveries = nativeDeliveries === deliveriesBeforeCleanup;
    if (!noLateSubscribers || !noLateNativeDeliveries || nativeObserversActive !== 0 || stopped.isStarted || stopped.callbackCount !== 0) throw new Error('Observer cleanup left active callbacks/deliveries');
    return { ...measured, restoration, cleanup: { cleanupMs, pendingThrottleCount, nativeDisconnects,
      activeNativeObservers: nativeObserversActive, noLateSubscribers, noLateNativeDeliveries,
      sharedStopped: !stopped.isStarted, registeredSubscribers: stopped.callbackCount } };
  } finally {
    cleanup(); window.MutationObserver = NativeObserver;
    Element.prototype.matches = nativeMatches; Element.prototype.closest = nativeClosest; Element.prototype.querySelector = nativeQuery;
    host.remove();
    restoration.nativeConstructorRestored = window.MutationObserver === NativeObserver;
    restoration.selectorMethodsRestored = Element.prototype.matches === nativeMatches
      && Element.prototype.closest === nativeClosest && Element.prototype.querySelector === nativeQuery;
    restoration.syntheticHostRemoved = !host.isConnected;
  }
}
