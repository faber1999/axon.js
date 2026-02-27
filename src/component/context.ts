/**
 * axon.js - Context API
 *
 * Allows passing data down the component tree without prop drilling.
 * Uses a stack-based approach during the synchronous render phase.
 */

import type { JSXChild, ComponentFn } from '../types.ts';

// Map from context symbol → stack of current values (one per nested Provider)
const contextMap = new Map<symbol, unknown[]>();

export interface Context<T> {
  /** Wrap children with this to provide a value down the tree. */
  Provider: ComponentFn<{ value: T; children?: JSXChild | JSXChild[] }>;
  /** Read the nearest Provider's value. Returns defaultValue if no Provider found. */
  use(): T;
}

/**
 * Creates a context object.
 *
 * @param defaultValue - Returned by `use()` when no Provider is found above.
 * @returns `{ Provider, use }` — Provider component and reader function.
 *
 * @example
 * const ThemeCtx = createContext('dark')
 *
 * function App() {
 *   return <ThemeCtx.Provider value="light"><Child /></ThemeCtx.Provider>
 * }
 * function Child() {
 *   const theme = ThemeCtx.use() // 'light'
 *   return <div class={theme}>...</div>
 * }
 */
export function createContext<T>(defaultValue: T): Context<T> {
  const key = Symbol('axon.context');

  const Provider: ComponentFn<{ value: T; children?: JSXChild | JSXChild[] }> = ({
    value,
    children,
  }) => {
    if (!contextMap.has(key)) contextMap.set(key, []);
    (contextMap.get(key) as T[]).push(value);

    // Schedule cleanup after this render cycle
    queueMicrotask(() => {
      const stack = contextMap.get(key);
      if (stack) stack.pop();
    });

    // Return children as-is — Provider adds no DOM elements
    if (children == null) return null;
    return Array.isArray(children) ? (children as Node[]) : [children as Node];
  };

  const use = (): T => {
    const stack = contextMap.get(key) as T[] | undefined;
    if (stack && stack.length > 0) return stack[stack.length - 1];
    return defaultValue;
  };

  return { Provider, use };
}
