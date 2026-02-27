/**
 * axon.js - Component Lifecycle
 *
 * Each component gets an "owner" context that tracks:
 *   - onMount callbacks (run after the component's DOM is inserted)
 *   - onCleanup callbacks (run when the component is destroyed)
 *   - child owners (for propagating cleanup down the tree)
 */

import type { ComponentOwner, ComponentFn } from '../types.ts';
import { effectStack } from '../reactivity/effect.ts';

// Stack of active component owners — mirrors the component call stack
const ownerStack: ComponentOwner[] = [];

function getCurrentOwner(): ComponentOwner | null {
  return ownerStack[ownerStack.length - 1] ?? null;
}

/**
 * Low-level primitive: creates an owner context, runs an arbitrary function
 * inside it, and returns both the result and the owner handle.
 *
 * Use this when you need to track the owner for manual disposal later
 * (e.g. RouterView managing per-page lifecycles).
 */
export function runOwned<T>(fn: () => T): [T, ComponentOwner] {
  const owner: ComponentOwner = {
    _onMount: [],
    _onCleanup: [],
    _children: [],
    _mounted: false,
  };

  const parent = getCurrentOwner();
  if (parent) parent._children.push(owner);

  ownerStack.push(owner);
  // Pause parent effect tracking during component render.
  // Signal reads in the render phase should NOT subscribe parent effects —
  // only effects explicitly created with effect() inside the component should track signals.
  const savedEffects = effectStack.splice(0);
  let result!: T;
  try {
    result = fn();
  } finally {
    ownerStack.pop();
    effectStack.push(...savedEffects);
  }

  queueMicrotask(() => {
    if (!owner._mounted) {
      owner._mounted = true;
      owner._onMount.forEach(cb => cb());
    }
  });

  return [result, owner];
}

/**
 * Creates a new owner context and runs the component function inside it.
 * Used internally by h() when calling component functions.
 *
 * @param fn - Component function
 * @param props - Props to pass to the component
 * @returns The DOM nodes returned by the component
 */
export function runWithOwner<P extends Record<string, unknown>>(
  fn: ComponentFn<P>,
  props: P
): Node | Node[] | null {
  const [result] = runOwned(() => fn(props));
  return result;
}

/**
 * Registers a callback to run after the component mounts (DOM is inserted).
 * Must be called synchronously during component setup.
 */
export function onMount(fn: () => void): void {
  const owner = getCurrentOwner();
  if (owner) owner._onMount.push(fn);
  else console.warn('[axon] onMount called outside of a component');
}

/**
 * Registers a cleanup callback to run when the component is destroyed.
 * Must be called synchronously during component setup.
 */
export function onCleanup(fn: () => void): void {
  const owner = getCurrentOwner();
  if (owner) owner._onCleanup.push(fn);
  else console.warn('[axon] onCleanup called outside of a component');
}

/**
 * Destroys an owner and all its children, running cleanup callbacks depth-first.
 */
export function disposeOwner(owner: ComponentOwner): void {
  owner._children.forEach(disposeOwner);
  owner._onCleanup.forEach(cb => cb());
  owner._onMount = [];
  owner._onCleanup = [];
  owner._children = [];
}
