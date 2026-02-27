/**
 * axon.js — Tipos internos compartidos
 *
 * Este archivo define las interfaces y tipos que se usan en múltiples módulos.
 * No importa nada del framework para evitar dependencias circulares.
 */

// ── Sistema de efectos ────────────────────────────────────────────────────────

/**
 * Una función de efecto enriquecida con metadatos de suscripción.
 * Es la unidad de observación del sistema reactivo.
 */
export interface EffectRun {
  (): void;
  /** Conjunto de funciones unsubscribe — una por cada signal suscrito. */
  _subscriptions: Set<() => void>;
  /** True cuando el efecto ha sido destruido y no debe volver a ejecutarse. */
  _disposed: boolean;
}

// ── Sistema de lifecycle ──────────────────────────────────────────────────────

/**
 * Contexto de lifecycle de un componente.
 * Cada componente tiene uno; los owners forman un árbol que espeja el de componentes.
 */
export interface ComponentOwner {
  _onMount: (() => void)[];
  _onCleanup: (() => void)[];
  _children: ComponentOwner[];
  _mounted: boolean;
}

// ── Signals ───────────────────────────────────────────────────────────────────

/** Función que lee un valor reactivo y crea una suscripción si hay un efecto activo. */
export type Getter<T> = () => T;

/** Función que escribe un signal. Acepta un valor directo o una función updater. */
export type Setter<T> = (value: T | ((prev: T) => T)) => void;

/** Par [getter, setter] que representa un signal reactivo. */
export type Signal<T> = [Getter<T>, Setter<T>];

// ── Componentes y JSX ─────────────────────────────────────────────────────────

/**
 * Función componente de axon.js.
 * Recibe props y devuelve uno o varios nodos DOM (o null).
 * Se ejecuta exactamente una vez — no hay re-renders.
 */
export type ComponentFn<P extends Record<string, unknown> = Record<string, unknown>> = (
  props: P
) => Node | Node[] | null;

/**
 * Tipos válidos como hijos en JSX.
 * Las funciones se tratan como hijos reactivos (signal getters).
 */
export type JSXChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | JSXChild[]
  | (() => JSXChild);
