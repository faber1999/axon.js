/**
 * axon.js - Router
 *
 * Client-side router using the History API.
 * Built entirely on signals — the current URL is a signal,
 * so route matching is reactive automatically.
 */

import { signal, batch } from '../reactivity/signal.ts';
import { withViewTransition } from '../dom/transitions.ts';
import type { Getter, ComponentFn, JSXChild } from '../types.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouteConfig {
  path: string;
  component: ComponentFn;
}

/**
 * A group of routes that share a layout and/or an access guard.
 *
 * @example
 * {
 *   layout: DashboardLayout,
 *   guard: () => isLoggedIn() || '/login',
 *   children: [
 *     { path: '/dashboard', component: Dashboard },
 *     { path: '/settings',  component: Settings  },
 *   ],
 * }
 */
export interface RouteGroup {
  layout?: ComponentFn<{ children?: JSXChild }>;
  /**
   * Called before rendering any child route.
   * - Return `true`    → allow access.
   * - Return `false`   → deny: go back to the previous route, or to `fallbackPath`
   *                       if there is no previous route (e.g. direct URL access).
   * - Return a string  → redirect to that path.
   *
   * Reactive: if the guard reads a signal (e.g. `isLoggedIn()`),
   * RouterView re-evaluates it whenever that signal changes.
   */
  guard?: () => boolean | string;
  /**
   * Path to redirect to when the guard returns `false` and there is no
   * previous route to go back to (e.g. the user typed the URL directly).
   * If omitted and there is no previous route, nothing is rendered.
   */
  fallbackPath?: string;
  children: RouteConfig[];
}

/** Union of a flat route and a route group. Pass this to `createRouter`. */
export type RouteDefinition = RouteConfig | RouteGroup;

export interface CompiledRoute extends RouteConfig {
  regex: RegExp;
  paramNames: string[];
  layout?: ComponentFn<{ children?: JSXChild }>;
  guard?: () => boolean | string;
  fallbackPath?: string;
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface RouterOptions {
  /** Wrap route transitions in the View Transitions API for animated navigation. */
  viewTransitions?: boolean;
}

export interface Router {
  /** Reactive getter for the current pathname (e.g. '/user/42'). */
  pathname: Getter<string>;
  /** Reactive getter for the current query string (e.g. '?tab=posts'). */
  search: Getter<string>;
  /** Reactive getter for the current route params (e.g. { id: '42' }). */
  params: Getter<Record<string, string>>;
  /** Navigate to a new path programmatically. */
  navigate(to: string, options?: NavigateOptions): void;
  /** Compiled route definitions. */
  routes: CompiledRoute[];
  /** Returns the route matching the current path, or null. */
  currentRoute(): CompiledRoute | null;
}

// ── Path matching ─────────────────────────────────────────────────────────────

function compilePath(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern
    .replace(/:([^/]+)/g, (_, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    })
    .replace(/\*/g, '.*');

  return {
    regex: new RegExp(`^${regexStr}(?:/)?$`),
    paramNames,
  };
}

function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const { regex, paramNames } = compilePath(pattern);
  const match = pathname.match(regex);
  if (!match) return null;
  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}

// ── Router singleton ──────────────────────────────────────────────────────────

let _router: Router | null = null;

/**
 * Creates and registers the global router instance.
 * Call this once at app startup, before mounting.
 *
 * Accepts flat routes and/or route groups (with shared layout and guard).
 *
 * @example
 * createRouter([
 *   { path: '/login', component: Login },
 *   {
 *     layout: DashboardLayout,
 *     guard: () => isLoggedIn() || '/login',
 *     children: [
 *       { path: '/dashboard', component: Dashboard },
 *     ],
 *   },
 * ], { viewTransitions: true })
 */
export function createRouter(routes: RouteDefinition[], options: RouterOptions = {}): Router {
  // Disable the default root transition so only named elements animate.
  // This prevents the background flash when view transitions are enabled.
  if (options.viewTransitions) {
    const style = document.createElement('style');
    style.dataset.axon = 'view-transitions';
    style.textContent = [
      '::view-transition-old(root),',
      '::view-transition-new(root) { animation: none; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  const [pathname, setPathname] = signal(location.pathname);
  const [search, setSearch] = signal(location.search);
  const [params, setParams] = signal<Record<string, string>>({});

  // Flatten RouteDefinitions: groups expand into CompiledRoutes that carry
  // the group's layout and guard alongside the compiled path data.
  const compiledRoutes: CompiledRoute[] = [];
  for (const def of routes) {
    if ('children' in def) {
      for (const child of def.children) {
        compiledRoutes.push({
          ...child,
          ...compilePath(child.path),
          ...(def.layout        !== undefined && { layout:        def.layout        }),
          ...(def.guard         !== undefined && { guard:         def.guard         }),
          ...(def.fallbackPath  !== undefined && { fallbackPath:  def.fallbackPath  }),
        });
      }
    } else {
      compiledRoutes.push({ ...def, ...compilePath(def.path) });
    }
  }

  function syncLocation(): void {
    batch(() => {
      setPathname(location.pathname);
      setSearch(location.search);

      for (const route of compiledRoutes) {
        const matched = matchPath(route.path, location.pathname);
        if (matched) {
          setParams(matched);
          return;
        }
      }
      setParams({});
    });
  }

  const doSync = (): void => {
    if (options.viewTransitions) {
      withViewTransition(syncLocation);
    } else {
      syncLocation();
    }
  };

  // Sync on browser back/forward navigation
  window.addEventListener('popstate', doSync);

  const navigate = (to: string, { replace = false }: NavigateOptions = {}): void => {
    if (replace) {
      history.replaceState(null, '', to);
    } else {
      history.pushState(null, '', to);
    }
    // pushState does not fire popstate — sync manually
    doSync();
  };

  const router: Router = {
    pathname,
    search,
    params,
    navigate,
    routes: compiledRoutes,
    currentRoute(): CompiledRoute | null {
      const path = pathname();
      for (const route of compiledRoutes) {
        if (matchPath(route.path, path)) return route;
      }
      return null;
    },
  };

  _router = router;
  return router;
}

/**
 * Returns the active router instance.
 * Must be called after `createRouter()`.
 */
export function useRouter(): Router {
  if (!_router) throw new Error('[axon] No router found. Call createRouter() first.');
  return _router;
}

/**
 * Returns the current route params as a plain object.
 * Reactive: re-reads when the route changes.
 */
export function useParams(): Record<string, string> {
  return useRouter().params();
}

/**
 * Returns the `navigate` function from the active router.
 */
export function useNavigate(): Router['navigate'] {
  return useRouter().navigate;
}
