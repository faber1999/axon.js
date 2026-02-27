/**
 * axon.js - DOM Renderer: mount() and createApp()
 */

import { runWithOwner } from '../component/lifecycle.ts';
import type { ComponentFn } from '../types.ts';

/**
 * Mounts a component into a DOM container.
 * Clears the container first.
 *
 * @param component - Component function or a pre-built DOM node.
 * @param container - Target DOM element.
 * @param props - Props to pass to the component (if it's a function).
 */
export function mount(
  component: ComponentFn | Node,
  container: Element,
  props: Record<string, unknown> = {}
): void {
  container.innerHTML = '';

  let nodes: Node | Node[] | null;
  if (typeof component === 'function') {
    nodes = runWithOwner(component, props);
  } else {
    nodes = component;
  }

  const append = (node: Node | Node[] | null): void => {
    if (node == null) return;
    if (Array.isArray(node)) node.forEach(append);
    else container.appendChild(node);
  };

  append(nodes);
}

/**
 * Creates an application entry point.
 *
 * @example
 * createApp(App).mount('#app')
 * createApp(App).mount(document.getElementById('root')!)
 */
export function createApp(RootComponent: ComponentFn): { mount(selector: string | Element): void } {
  return {
    mount(selector: string | Element): void {
      const container =
        typeof selector === 'string'
          ? document.querySelector(selector)
          : selector;

      if (!container) throw new Error(`[axon] mount target not found: ${selector}`);
      mount(RootComponent, container);
    },
  };
}
