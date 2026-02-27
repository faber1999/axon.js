/**
 * axon.js - Reactivity: signal
 *
 * A signal is a reactive value container.
 * Reading it inside an effect creates a subscription.
 * Writing it notifies all subscribers.
 */

import { getCurrentEffect } from './effect.ts';
import type { EffectRun, Signal } from '../types.ts';

// Pending batch notifications
let batchDepth = 0;
const pendingEffects = new Set<EffectRun>();

function flushEffects(): void {
  pendingEffects.forEach(run => {
    if (!run._disposed) run();
  });
  pendingEffects.clear();
}

function scheduleEffect(run: EffectRun): void {
  if (batchDepth > 0) {
    pendingEffects.add(run);
  } else {
    run();
  }
}

/**
 * Creates a reactive signal.
 *
 * @param initialValue - The starting value.
 * @returns A [getter, setter] tuple. Reading the getter inside an effect
 *          creates a subscription. Writing the setter notifies all subscribers.
 *
 * @example
 * const [count, setCount] = signal(0)
 * effect(() => console.log(count())) // logs 0
 * setCount(1)                         // logs 1
 */
export function signal<T>(initialValue: T): Signal<T> {
  let value: T = initialValue;
  // Map from effect run function → its unsubscribe function
  const subscribers = new Map<EffectRun, () => void>();

  const read = (): T => {
    const currentEffect = getCurrentEffect();
    if (currentEffect && !subscribers.has(currentEffect)) {
      // Bidirectional subscription:
      // The signal knows the effect, the effect knows the signal.
      subscribers.set(currentEffect, () => {
        subscribers.delete(currentEffect);
      });
      currentEffect._subscriptions.add(() => {
        subscribers.delete(currentEffect);
      });
    }
    return value;
  };

  const write = (newValue: T | ((prev: T) => T)): void => {
    const next = typeof newValue === 'function'
      ? (newValue as (prev: T) => T)(value)
      : newValue;
    if (Object.is(next, value)) return; // No change — skip notification
    value = next;

    // Snapshot to avoid mutation during iteration
    const subs = [...subscribers.keys()];
    subs.forEach(run => {
      if (!run._disposed) scheduleEffect(run);
    });
  };

  return [read, write];
}

/**
 * Batches multiple signal writes into a single flush of effects.
 * Prevents effects from running multiple times when several signals change together.
 *
 * @example
 * batch(() => {
 *   setFirstName('Juan')
 *   setLastName('García')
 * }) // effects run once, not twice
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushEffects();
  }
}
