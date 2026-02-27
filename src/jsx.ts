/**
 * axon.js — JSX-only entry point
 *
 * Used by `jsxInject` in vite.config so that .tsx files inside
 * the framework itself don't create circular dependencies with index.ts.
 *
 * `axon/jsx` → this file → dom/h.ts  (no cycle back to index.ts)
 */
export { h, Fragment } from './dom/h.ts';
