/**
 * axon.js - DOM Helpers: Show, For, Dynamic, Portal
 *
 * Control-flow components for use in JSX.
 * These are the idiomatic way to handle conditionals and lists
 * with fine-grained reactivity (no re-render of the whole tree).
 */

import { effect } from '../reactivity/effect.ts';
import { runWithOwner, disposeOwner } from '../component/lifecycle.ts';
import type { JSXChild, ComponentFn, ComponentOwner } from '../types.ts';

// ── Show ──────────────────────────────────────────────────────────────────────

export interface ShowProps<T = unknown> {
  /** Reactive condition. If a function, it's read as a signal getter. */
  when: (() => T) | T;
  /** Rendered when `when` is falsy. */
  fallback?: JSXChild;
  /** Rendered when `when` is truthy. */
  children?: JSXChild | JSXChild[];
}

/**
 * Conditionally renders children or a fallback.
 *
 * @example
 * <Show when={isLoggedIn} fallback={<Login />}>
 *   <Dashboard />
 * </Show>
 */
export function Show<T = unknown>({ when, fallback = null, children }: ShowProps<T>): DocumentFragment {
  const start = document.createComment('Show');
  const end = document.createComment('/Show');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  let currentOwner: ComponentOwner | null = null;

  const condition = typeof when === 'function' ? (when as () => T) : () => when;

  const insert = (parent: Node, content: JSXChild): void => {
    if (content == null) return;
    if (Array.isArray(content)) {
      content.forEach(c => insert(parent, c as JSXChild));
    } else {
      parent.insertBefore(
        content instanceof Node ? content : document.createTextNode(String(content)),
        end
      );
    }
  };

  effect(() => {
    const isTrue = Boolean(condition());

    // Clear previous content between markers
    if (currentOwner) {
      disposeOwner(currentOwner);
      currentOwner = null;
    }
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      node.parentNode?.removeChild(node);
      node = next;
    }

    const content = isTrue ? children : fallback;
    if (content == null) return;

    const parent = end.parentNode;
    if (!parent) return;

    if (typeof content === 'function') {
      currentOwner = { _onMount: [], _onCleanup: [], _children: [], _mounted: false };
      insert(parent, (content as () => JSXChild)());
    } else {
      insert(parent, content as JSXChild);
    }
  });

  return fragment;
}

// ── For ───────────────────────────────────────────────────────────────────────

export interface ForProps<T> {
  /** Reactive array. If a function, it's read as a signal getter. */
  each: (() => T[]) | T[];
  /** Render function called for each item. */
  children: (item: T, index: () => number) => JSXChild;
}

/**
 * Reactively renders a list.
 *
 * @example
 * <For each={items}>
 *   {(item, index) => <li>{item.name}</li>}
 * </For>
 */
export function For<T>({ each, children: renderItem }: ForProps<T>): DocumentFragment {
  const start = document.createComment('For');
  const end = document.createComment('/For');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  const getList = typeof each === 'function' ? (each as () => T[]) : () => each;

  // Track rendered nodes per index for cleanup
  let renderedNodes: Node[][] = [];

  effect(() => {
    const list = getList() ?? [];
    const parent = end.parentNode;
    if (!parent) return;

    // Non-keyed reconciliation: remove all, re-render
    renderedNodes.forEach(nodes => {
      nodes.forEach(n => parent.removeChild(n));
    });
    renderedNodes = [];

    list.forEach((item, index) => {
      const result = renderItem(item, () => index);
      const nodes = (Array.isArray(result) ? result : [result]) as Node[];
      nodes.forEach(n => {
        if (n != null) parent.insertBefore(n, end);
      });
      renderedNodes.push(nodes);
    });
  });

  return fragment;
}

// ── Dynamic ───────────────────────────────────────────────────────────────────

export interface DynamicProps {
  /** Reactive component getter. */
  component: (() => ComponentFn) | ComponentFn;
  [key: string]: unknown;
}

/**
 * Reactively renders a dynamic component.
 * Useful when the component itself needs to change based on state.
 *
 * @example
 * const [currentView, setCurrentView] = signal(HomeView)
 * <Dynamic component={currentView} title="Hello" />
 */
export function Dynamic({ component: getComponent, ...props }: DynamicProps): DocumentFragment {
  const start = document.createComment('Dynamic');
  const end = document.createComment('/Dynamic');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  const getter =
    typeof getComponent === 'function' && getComponent.length === 0
      ? (getComponent as () => ComponentFn)
      : () => getComponent as ComponentFn;

  effect(() => {
    const Component = getter();
    const parent = end.parentNode;
    if (!parent || !Component) return;

    // Clear previous
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      parent.removeChild(node);
      node = next;
    }

    const result = runWithOwner(Component, props);
    const nodes = Array.isArray(result) ? result : [result];
    nodes.forEach(n => {
      if (n != null) parent.insertBefore(n, end);
    });
  });

  return fragment;
}

// ── Portal ────────────────────────────────────────────────────────────────────

export interface PortalProps {
  /** Target DOM element to render into. */
  mount: Element;
  children?: JSXChild | JSXChild[];
}

/**
 * Renders children into a different part of the DOM.
 * Useful for modals, tooltips, and overlays.
 *
 * @example
 * <Portal mount={document.body}>
 *   <Modal />
 * </Portal>
 */
export function Portal({ mount: target, children }: PortalProps): Comment {
  const nodes = Array.isArray(children) ? children : [children];
  nodes.forEach(n => {
    if (n != null) target.appendChild(n as Node);
  });
  // Return a placeholder comment in the original tree position
  return document.createComment('Portal');
}
