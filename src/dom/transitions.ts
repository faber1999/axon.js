/**
 * axon.js — View Transitions
 *
 * Wraps DOM updates in the browser's View Transitions API for smooth animations.
 * Gracefully falls back to a direct call if the browser doesn't support the API.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
 */

/**
 * Wraps a DOM update function in a View Transition.
 *
 * If the browser supports `document.startViewTransition`, the update is
 * animated. Otherwise it runs immediately with no transition.
 *
 * @param fn - The function that updates the DOM (e.g. a navigate call).
 *
 * @example
 * // Manually trigger a transition on any state change:
 * withViewTransition(() => navigate('/about'))
 * withViewTransition(() => setCurrentTab('settings'))
 *
 * @example
 * // Custom CSS for the transition (add to your stylesheet):
 * // ::view-transition-old(root) { animation: 150ms ease-out fade-out; }
 * // ::view-transition-new(root) { animation: 150ms ease-in  fade-in;  }
 */
export function withViewTransition(fn: () => void): void {
  if ('startViewTransition' in document) {
    document.startViewTransition(fn);
  } else {
    fn();
  }
}
