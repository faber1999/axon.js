/**
 * axon.js - Store
 *
 * Global reactive state built on signals.
 * Each property is a signal internally; reading via the Proxy creates subscriptions.
 *
 * @example
 * const [store, setStore] = createStore({ count: 0, theme: 'dark' })
 *
 * // Read (reactive inside effects/components):
 * store.count        // 0
 *
 * // Write:
 * setStore('count', 42)
 * setStore('count', prev => prev + 1)
 * setStore({ count: 10, theme: 'light' })  // merge update
 */

import { signal } from '../reactivity/signal.ts';
import { computed } from '../reactivity/computed.ts';
import type { Signal, Getter } from '../types.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Updater function or direct value — mirrors signal's setter API.
 */
type ValueOrUpdater<T> = T | ((prev: T) => T);

/**
 * The setStore function with 3 call signatures:
 *   setStore(key, value)           — set one property
 *   setStore(key, fn)              — update one property with a function
 *   setStore(partialObject)        — merge-update multiple properties
 */
export interface SetStore<T extends object> {
  <K extends keyof T>(key: K, valueOrUpdater: ValueOrUpdater<T[K]>): void;
  (partial: Partial<T>): void;
}

// ── createStore ───────────────────────────────────────────────────────────────

/**
 * Creates a reactive store from an initial state object.
 * Each top-level property becomes an independent signal.
 *
 * @returns A `[store, setStore]` tuple.
 *   - `store` — read-only Proxy; reading a property is reactive.
 *   - `setStore` — write function with 3 overloads.
 */
export function createStore<T extends object>(
  initialState: T
): [T, SetStore<T>] {
  // One signal per top-level property.
  // `any` is intentional here: the map stores signals of heterogeneous types.
  // The public API (store proxy + SetStore) is fully typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signals: Partial<Record<keyof T, Signal<any>>> = {};

  for (const key of Object.keys(initialState) as (keyof T)[]) {
    signals[key] = signal(initialState[key]);
  }

  // Proxy that reads from the appropriate signal getter
  const store = new Proxy({} as T, {
    get(_: T, key: string): unknown {
      const sig = signals[key as keyof T];
      if (!sig) throw new Error(`[axon] store has no property "${key}"`);
      return sig[0](); // call getter → reactive read
    },
    set(): boolean {
      throw new Error('[axon] Store is read-only. Use setStore() to update values.');
    },
    has(_: T, key: string): boolean {
      return key in signals;
    },
    ownKeys(): string[] {
      return Object.keys(signals);
    },
    getOwnPropertyDescriptor(_: T, key: string): PropertyDescriptor | undefined {
      if (key in signals) return { configurable: true, enumerable: true, writable: false };
      return undefined;
    },
  });

  function setStore<K extends keyof T>(key: K, valueOrUpdater: ValueOrUpdater<T[K]>): void;
  function setStore(partial: Partial<T>): void;
  function setStore<K extends keyof T>(
    keyOrPartial: K | Partial<T>,
    valueOrUpdater?: ValueOrUpdater<T[K]>
  ): void {
    if (typeof keyOrPartial === 'object' && keyOrPartial !== null) {
      // Merge update: setStore({ a: 1, b: 2 })
      for (const [k, v] of Object.entries(keyOrPartial) as [keyof T, T[keyof T]][]) {
        if (!(k in signals)) {
          signals[k] = signal(v);
        } else {
          (signals[k] as Signal<T[keyof T]>)[1](v);
        }
      }
    } else {
      // Single key: setStore('count', 42) or setStore('count', c => c + 1)
      const key = keyOrPartial as K;
      if (!(key in signals)) {
        signals[key] = signal(valueOrUpdater as T[K]);
      } else {
        (signals[key] as Signal<T[K]>)[1](valueOrUpdater as ValueOrUpdater<T[K]>);
      }
    }
  }

  return [store, setStore as SetStore<T>];
}

// ── select ────────────────────────────────────────────────────────────────────

/**
 * Creates a computed value derived from a store.
 * Syntactic sugar for `computed(() => selector(store))`.
 *
 * @example
 * const fullName = select(store, s => `${s.firstName} ${s.lastName}`)
 * effect(() => console.log(fullName())) // reactive
 */
export function select<T extends object, R>(
  store: T,
  selector: (store: T) => R
): Getter<R> {
  return computed(() => selector(store));
}
