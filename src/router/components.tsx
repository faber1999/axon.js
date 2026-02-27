/**
 * axon.js - Router Components: RouterView, Link
 */

import { effect } from '../reactivity/effect.ts';
import { runOwned, runWithOwner, disposeOwner } from '../component/lifecycle.ts';
import { useRouter } from './router.ts';
import type { JSXChild, ComponentOwner } from '../types.ts';

// ── RouterView ────────────────────────────────────────────────────────────────

/**
 * Renders the component matching the current route.
 * Handles route guards and optional group layouts automatically.
 * Place this where you want the page content to appear.
 *
 * @example
 * function App() {
 *   return (
 *     <div>
 *       <Nav />
 *       <main><RouterView /></main>
 *     </div>
 *   )
 * }
 */
export function RouterView(): DocumentFragment {
  const router = useRouter();
  const start = document.createComment('RouterView');
  const end = document.createComment('/RouterView');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  let currentOwner: ComponentOwner | null = null;
  // Tracks the last path that successfully passed all guards and rendered.
  // Used to restore the previous location when a guard denies navigation.
  let lastValidPath: string | null = null;

  effect(() => {
    const path = router.pathname(); // Subscribe to pathname changes
    const parent = end.parentNode;
    if (!parent) return;

    // Dispose and clear the previous route's component tree
    if (currentOwner) {
      disposeOwner(currentOwner);
      currentOwner = null;
    }
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      parent.removeChild(node);
      node = next;
    }

    // Find the matching route
    for (const route of router.routes) {
      if (!route.regex.test(path)) continue;

      // ── Guard ──────────────────────────────────────────────────────────────
      if (route.guard) {
        const access = route.guard();
        if (access === false) {
          // Denied — navigate back to where the user came from, or to the
          // configured fallback, or do nothing (leaves the URL but renders nothing).
          const target = lastValidPath ?? route.fallbackPath ?? null;
          if (target) queueMicrotask(() => router.navigate(target, { replace: true }));
          return;
        }
        if (typeof access === 'string') {
          // Explicit redirect — defer so we don't mutate signals inside an effect
          queueMicrotask(() => router.navigate(access, { replace: true }));
          return;
        }
      }

      // ── Render ─────────────────────────────────────────────────────────────
      lastValidPath = path; // Guard passed — remember this as the last valid location
      const params = router.params();
      let result: Node | Node[] | null;
      let owner: ComponentOwner;

      if (route.layout) {
        // The layout receives `children` as a lazy function.
        // When the layout calls {children} in its JSX, axon wraps it in an
        // effect — that effect calls children(), which calls runWithOwner for
        // the page component. At that point the layout's owner is still in
        // ownerStack, so the page owner becomes a child of the layout owner.
        // Disposing the layout owner cascades to the page owner automatically.
        const Layout = route.layout;
        const Page = route.component;
        [result, owner] = runOwned(() =>
          Layout({ children: (() => runWithOwner(Page, { params })) as JSXChild })
        );
      } else {
        [result, owner] = runOwned(() => route.component({ params }));
      }

      currentOwner = owner; // Track for cleanup on next navigation

      const nodes = Array.isArray(result) ? result.flat() : [result];
      nodes.forEach(n => { if (n != null) parent.insertBefore(n, end); });
      return;
    }
  });

  return fragment;
}

// ── Link ──────────────────────────────────────────────────────────────────────

export interface LinkProps {
  /** Target path for navigation. */
  href: string;
  /** Use replaceState instead of pushState. Default: false. */
  replace?: boolean;
  /** CSS class always applied to the anchor. */
  class?: string;
  /** CSS class applied when `href` matches the current pathname. */
  activeClass?: string;
  children?: JSXChild | JSXChild[];
}

/**
 * A client-side navigation link. Prevents full page reload.
 *
 * @example
 * <Link href="/about">About</Link>
 * <Link href="/profile" activeClass="active">Profile</Link>
 */
export function Link({ href, replace = false, class: cls, activeClass, children }: LinkProps): HTMLAnchorElement {
  const router = useRouter();

  const el = document.createElement('a');
  el.href = href;

  if (cls) el.className = cls;

  // Reactively apply/remove the active class when the route changes
  if (activeClass) {
    const classes = activeClass.split(/\s+/).filter(Boolean);
    effect(() => {
      if (router.pathname() === href) {
        el.classList.add(...classes);
      } else {
        el.classList.remove(...classes);
      }
    });
  }

  el.addEventListener('click', (e: MouseEvent) => {
    // Only intercept plain left-clicks without modifier keys
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      router.navigate(href, { replace });
    }
  });

  const appendChildren = (parent: Node, child: JSXChild): void => {
    if (child == null) return;
    if (Array.isArray(child)) child.forEach(c => appendChildren(parent, c as JSXChild));
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  };

  appendChildren(el, children as JSXChild);
  return el;
}
