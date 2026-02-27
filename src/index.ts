/**
 * axon.js — A fine-grained reactive frontend framework
 *
 * @module axon
 */

// ── Reactivity ────────────────────────────────────────────────────────────────
export { signal, batch } from './reactivity/signal.ts';
export { effect, untrack } from './reactivity/effect.ts';
export { computed } from './reactivity/computed.ts';

// ── JSX Runtime ───────────────────────────────────────────────────────────────
export { h, Fragment } from './dom/h.ts';

// ── DOM / Rendering ───────────────────────────────────────────────────────────
export { mount, createApp } from './dom/render.ts';
export { Show, For, Dynamic, Portal } from './dom/helpers.ts';
export { withViewTransition } from './dom/transitions.ts';

// ── Component Lifecycle ───────────────────────────────────────────────────────
export { onMount, onCleanup } from './component/lifecycle.ts';
export { createContext } from './component/context.ts';

// ── Router ────────────────────────────────────────────────────────────────────
export { createRouter, useRouter, useParams, useNavigate } from './router/router.ts';
export { RouterView, Link } from './router/components.tsx';

// ── Store ─────────────────────────────────────────────────────────────────────
export { createStore, select } from './store/store.ts';

// ── Public types ──────────────────────────────────────────────────────────────
export type { Signal, Getter, Setter, ComponentFn, JSXChild } from './types.ts';
export type { Context } from './component/context.ts';
export type { Router, RouteConfig, RouteGroup, RouteDefinition, NavigateOptions, RouterOptions } from './router/router.ts';
export type { SetStore } from './store/store.ts';
export type { ShowProps, ForProps, DynamicProps, PortalProps } from './dom/helpers.ts';
export type { LinkProps } from './router/components.tsx';
