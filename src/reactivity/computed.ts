/**
 * axon.js - Reactivity: computed
 *
 * A derived, read-only reactive value.
 * Like a signal, but its value is calculated from other signals.
 */

import { signal } from './signal.ts';
import { effect } from './effect.ts';
import type { Getter } from '../types.ts';

/**
 * Creates a computed (derived) signal.
 * Re-evaluates automatically when its dependencies change.
 * Returns a read-only getter — computed values cannot be set directly.
 *
 * @param fn - Pure derivation function. Should have no side effects.
 * @returns A getter function. Reading it inside an effect creates a subscription.
 *
 * @example
 * const [count, setCount] = signal(0)
 * const double = computed(() => count() * 2)
 * effect(() => console.log(double())) // logs 0
 * setCount(5)                          // logs 10
 */
export function computed<T>(fn: () => T): Getter<T> {
  const [get, set] = signal<T | undefined>(undefined);
  // The effect tracks fn's signal reads and updates the internal signal
  effect(() => set(fn()));
  // Cast is safe: the effect runs immediately, so `get()` is never undefined
  return get as Getter<T>;
}
