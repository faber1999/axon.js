/**
 * axon.js - JSX Runtime: h() and Fragment
 *
 * This is the JSX factory. Configure your build tool with:
 *   jsxFactory: 'h'
 *   jsxFragment: 'Fragment'
 *
 * Design rule:
 *   - Static values (string, number, Node) → applied once
 *   - Function values → wrapped in effect() for reactive updates
 *
 * This means signal getters passed as children or props are reactive:
 *   const [count] = signal(0)
 *   <p>{count}</p>          ← count is a getter function → reactive text node
 *   <div class={cls}>       ← cls is a getter function → reactive attribute
 */

import { effect } from '../reactivity/effect.ts';
import { runWithOwner } from '../component/lifecycle.ts';
import type { JSXChild, ComponentFn } from '../types.ts';

export const Fragment = Symbol('Fragment');

// ── JSX namespace ─────────────────────────────────────────────────────────────
// Tells TypeScript how to type-check JSX expressions in .tsx files.

declare global {
  namespace JSX {
    type Element = Node | Node[];

    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }

    interface ElementChildrenAttribute {
      children: Record<string, never>;
    }
  }
}

// ── SVG support ───────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_ELEMENTS = new Set([
  'svg', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
  'g', 'defs', 'use', 'symbol', 'text', 'tspan', 'image', 'clipPath',
  'mask', 'filter', 'linearGradient', 'radialGradient', 'stop', 'marker',
  'pattern', 'foreignObject', 'animate', 'animateTransform',
]);

// ── Prop application ──────────────────────────────────────────────────────────

const BOOLEAN_ATTRS = new Set([
  'checked', 'disabled', 'readonly', 'multiple', 'selected',
  'autofocus', 'autoplay', 'controls', 'default', 'defer',
  'formnovalidate', 'hidden', 'ismap', 'loop', 'novalidate',
  'open', 'required', 'reversed', 'scoped', 'seamless',
]);

type MutableRef<T> = { current: T | null };

function applyProp(el: Element, key: string, value: unknown): void {
  if (key === 'class' || key === 'className') {
    // SVGElement.className is SVGAnimatedString, so always use setAttribute
    el.setAttribute('class', (value as string) ?? '');
  } else if (key === 'style') {
    if (typeof value === 'string') {
      (el as HTMLElement).style.cssText = value;
    } else if (value && typeof value === 'object') {
      Object.assign((el as HTMLElement).style, value);
    }
  } else if (key === 'ref') {
    if (typeof value === 'function') {
      (value as (el: Element) => void)(el);
    } else if (value && typeof value === 'object') {
      (value as MutableRef<Element>).current = el;
    }
  } else if (key.startsWith('on') && key.length > 2) {
    const event = key.slice(2).toLowerCase();
    el.addEventListener(event, value as EventListener);
  } else if (BOOLEAN_ATTRS.has(key)) {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
  } else if (key === 'innerHTML') {
    el.innerHTML = value as string;
  } else {
    if (value == null || value === false) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

// ── Child appending ───────────────────────────────────────────────────────────

function toNode(value: JSXChild): Node {
  if (value == null || value === false) return document.createTextNode('');
  if (value instanceof Node) return value;
  if (typeof value === 'function') return document.createTextNode(''); // handled separately
  return document.createTextNode(String(value));
}

function appendChild(parent: Node, child: JSXChild): void {
  if (child == null || child === false) return;

  if (Array.isArray(child)) {
    child.forEach(c => appendChild(parent, c));
    return;
  }

  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }

  if (typeof child === 'function') {
    // Reactive child: use comment markers as stable anchors in the DOM
    const startMarker = document.createComment('');
    const endMarker = document.createComment('');
    parent.appendChild(startMarker);
    parent.appendChild(endMarker);

    effect(() => {
      const result = (child as () => JSXChild)();

      // Clear nodes between markers
      let node = startMarker.nextSibling;
      while (node && node !== endMarker) {
        const next = node.nextSibling;
        (parent as Element).removeChild(node);
        node = next;
      }

      // Insert new content before endMarker
      const nodes = Array.isArray(result) ? result : [result];
      nodes.forEach(n => {
        if (n != null && n !== false) {
          parent.insertBefore(toNode(n as JSXChild), endMarker);
        }
      });
    });
    return;
  }

  parent.appendChild(document.createTextNode(String(child)));
}

// ── h() factory ───────────────────────────────────────────────────────────────

type Props = Record<string, unknown> | null;

/**
 * JSX factory function. Called automatically by the JSX compiler.
 *
 * - `h(Fragment, ...)` → returns children as a flat array
 * - `h(ComponentFn, props, ...children)` → runs the component with lifecycle
 * - `h('div', props, ...children)` → creates a real DOM element
 *
 * Props that are functions (not event handlers) are reactive:
 *   `class={cls}` where `cls` is a signal getter → updates className on each change.
 *
 * Children that are functions are reactive:
 *   `{count}` where `count` is a signal getter → updates a text node on each change.
 */
export function h(
  type: string | ComponentFn | typeof Fragment,
  props: Props,
  ...children: JSXChild[]
): Node | Node[] | null {
  // Fragment: return children as flat array (no wrapper element)
  if (type === Fragment) {
    return children.flat() as Node[];
  }

  // Component function
  if (typeof type === 'function') {
    const componentProps: Record<string, unknown> = { ...(props ?? {}) };
    if (children.length === 1) componentProps.children = children[0];
    else if (children.length > 1) componentProps.children = children.flat();
    return runWithOwner(type as ComponentFn, componentProps);
  }

  // Native DOM element (SVG elements need createElementNS)
  const el = SVG_ELEMENTS.has(type)
    ? document.createElementNS(SVG_NS, type)
    : document.createElement(type);

  // Apply props
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (key === 'children') continue; // handled below

      if (typeof value === 'function' && !key.startsWith('on')) {
        // Reactive prop: re-apply whenever the getter's value changes
        effect(() => applyProp(el, key, (value as () => unknown)()));
      } else {
        applyProp(el, key, value);
      }
    }
  }

  // Append children
  const flatChildren = children.flat() as JSXChild[];
  flatChildren.forEach(child => appendChild(el, child));

  return el;
}
