/**
 * axon.js - Reactivity: effect
 *
 * A stack-based dependency tracking system.
 * The currently executing effect is always at the top of the stack.
 */

import type { EffectRun } from '../types.ts';

// Stack of active effects. The top of the stack is the current observer.
export const effectStack: EffectRun[] = [];

/**
 * Returns the currently executing effect, if any.
 */
export function getCurrentEffect(): EffectRun | null {
  return effectStack[effectStack.length - 1] ?? null;
}

/**
 * Creates a reactive effect that re-runs whenever any signal it reads changes.
 * Returns a dispose function to stop tracking.
 *
 * @param fn - Effect function. May return a cleanup function.
 * @returns dispose — call to stop the effect and unsubscribe from all signals.
 */
export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: (() => void) | null = null;

  const run = (() => {
    // Dispose previous cleanup before re-running
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = null;
    }

    effectStack.push(run);
    try {
      cleanup = fn() ?? null;
    } finally {
      effectStack.pop();
    }
  }) as EffectRun;

  // Track which signals this effect is subscribed to, for disposal
  run._subscriptions = new Set<() => void>();
  run._disposed = false;

  run();

  const dispose = (): void => {
    run._disposed = true;
    run._subscriptions.forEach(unsub => unsub());
    run._subscriptions.clear();
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = null;
    }
  };

  return dispose;
}

/**
 * Runs a function without tracking any signals.
 * Reads inside will not subscribe the current effect.
 */
export function untrack<T>(fn: () => T): T {
  const saved = effectStack.splice(0); // Extrae todos los elementos
  try {
    return fn();
  } finally {
    effectStack.push(...saved); // Restaura
  }
}
