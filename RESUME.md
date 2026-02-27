# axon.js — Resumen del framework

> Guía de alto nivel. Explica qué hace cada parte del framework y cómo se conectan entre sí, sin entrar en detalles de implementación. Para la versión detallada, ver [INTERNALS.md](INTERNALS.md).

---

## ¿Qué es axon.js?

axon.js es un framework frontend minimalista construido desde cero. Usa **reactividad de grano fino** (fine-grained reactivity) + **JSX** como sintaxis de plantillas, sin Virtual DOM.

La diferencia clave con React: **los componentes se ejecutan exactamente una vez**. No hay re-renders. Cuando un dato cambia, solo la parte mínima del DOM que depende de ese dato se actualiza.

---

## Las tres capas del framework

### 1. Reactividad (`src/reactivity/`)

La capa más fundamental. Proporciona tres primitivas:

**`signal(valor)`** — un valor que puede cambiar. Devuelve un par `[getter, setter]`.

```ts
const [count, setCount] = signal(0)
count() // lee el valor (0)
setCount(1) // actualiza el valor → notifica a todos los observadores
```

**`effect(fn)`** — ejecuta `fn` inmediatamente y la re-ejecuta cada vez que un signal que leyó dentro de ella cambia. Es el observador.

```ts
effect(() => {
  document.title = `Clicks: ${count()}` // se suscribe a count automáticamente
})
```

**`computed(fn)`** — un signal derivado. Lee otros signals, produce un nuevo valor reactivo.

```ts
const double = computed(() => count() * 2)
double() // 0, 2, 4... actualizado automáticamente
```

**Cómo funciona la suscripción automática:** cuando `effect` ejecuta su función, pone una referencia de sí mismo en una pila global. Mientras está ahí, cualquier `signal` que se lea registra ese efecto como suscriptor. Al terminar, el efecto se quita de la pila. Simple, sin magia de compilador.

Extras: `batch(fn)` agrupa múltiples cambios de signal en una sola notificación. `untrack(fn)` lee signals sin crear suscripciones.

---

### 2. JSX Runtime (`src/dom/`)

Transforma JSX en nodos DOM reales sin ningún Virtual DOM intermedio.

**`h(type, props, ...children)`** — la función a la que el compilador JSX transforma cada elemento. Tres caminos:

- Si `type` es un `Symbol` (Fragment): devuelve los hijos como array.
- Si `type` es una función (componente): lo ejecuta con su lifecycle.
- Si `type` es un string (`'div'`, `'p'`...): crea el elemento DOM.

**Props reactivas vs estáticas:** si el valor de una prop es una función (y no empieza por `on`), se envuelve en un `effect`. Si es un valor, se aplica una vez.

```jsx
<div class={cls}>       // cls es función → reactivo, actualiza automáticamente
<div class="static">    // string → se aplica una vez
<button onClick={fn}>   // función con "on" → event listener, no reactivo
```

**Hijos reactivos:** si un hijo es una función, `h` coloca dos nodos comentario como marcadores de posición y crea un `effect` que actualiza el contenido entre ellos cuando el signal cambia. Esto permite que los hijos sean texto, elementos o incluso nada.

**Helpers de control de flujo** (`src/dom/helpers.ts`):

- `Show` — renderizado condicional reactivo. Necesario porque el ternario JSX evalúa sus ramas de forma estática.
- `For` — renderizado de listas reactivo.
- `Dynamic` — cambia el componente renderizado dinámicamente.
- `Portal` — renderiza contenido en un nodo DOM diferente (e.g. `document.body` para modales).

**`mount(component, container)`** y **`createApp(Root)`** — el punto de entrada. Inserta el componente raíz en el DOM y crea el árbol de owners.

---

### 3. Sistema de componentes y lifecycle (`src/component/`)

Cada componente tiene un **owner** — un registro interno que guarda:

- Callbacks `onMount`: se ejecutan justo después de que el componente se inserta en el DOM.
- Callbacks `onCleanup`: se ejecutan cuando el componente se destruye.
- Lista de owners hijos: para propagar la destrucción en cascada.

El árbol de owners espeja el árbol de componentes. Cuando un componente se destruye, todos sus hijos también.

**API pública:**

```ts
onMount(() => {
  /* el DOM está listo */
})
onCleanup(() => {
  /* libera recursos */
})
```

**Primitivas internas:**

- `runOwned(fn)` — ejecuta `fn` en un contexto de owner, retorna `[resultado, owner]`. Se usa cuando necesitas el handle del owner para hacer dispose manual.
- `runWithOwner(fn, props)` — igual pero descarta el owner. `h()` la usa para cada componente.

**Context API** (`src/component/context.ts`): `createContext(defaultValue)` crea un contexto que puede compartir datos entre componentes sin prop drilling, usando un `Provider` y un `use()`.

---

## El Router (`src/router/`)

Router client-side basado en la History API. El estado de la URL (pathname, search, params) son signals — cualquier componente que los lea se actualiza reactivamente cuando la URL cambia.

### Definición de rutas

`createRouter(routes, options)` acepta dos tipos de definiciones:

**Rutas planas:**

```ts
{ path: '/about', component: About }
```

**RouteGroups** — comparten layout y/o guard:

```ts
{
  layout: DashboardLayout,
  guard: () => isLoggedIn() || '/login',
  fallbackPath: '/login',
  children: [
    { path: '/dashboard', component: Dashboard },
    { path: '/settings',  component: Settings  },
  ],
}
```

Los grupos se aplanan internamente. Cada ruta compilada lleva la información de su grupo.

**Ruta 404 catch-all:** usar el patrón `*` al final del array de rutas:

```ts
{ path: '*', component: NotFound }
```

### Guards de acceso

El `guard` es una función que retorna:

- `true` → permite el acceso
- `false` → navega de vuelta al path anterior, o al `fallbackPath` configurado
- `"/otra-ruta"` → redirige a esa ruta

Los guards son reactivos: si leen un signal (`isLoggedIn()`), se re-evalúan automáticamente cuando ese signal cambia.

### Layouts

Un layout envuelve el contenido de las páginas del grupo. Recibe `children` (la página actual) y puede añadir una barra de navegación, un banner, etc. Cuando se navega entre rutas del mismo grupo, el layout permanece montado — solo se reemplaza el contenido de `{children}`.

### RouterView y Link

**`RouterView`** — colócalo donde quieras que aparezca el contenido de las rutas. Se actualiza reactivamente al navegar.

**`Link`** — equivalente a `<a>` pero sin recarga de página. Soporta `activeClass` para aplicar clases cuando la ruta es la activa.

### View Transitions

```ts
createRouter(routes, { viewTransitions: true })
```

Integra la View Transitions API del browser para animar las navegaciones. El framework desactiva automáticamente la transición del elemento raíz (evita un flash de fondo). El usuario solo necesita dar nombre a su área de contenido:

```css
main {
  view-transition-name: page;
}
::view-transition-old(page) {
  animation: 120ms ease-out fade-out both;
}
::view-transition-new(page) {
  animation: 180ms ease-in fade-in both;
}
```

### Helpers de navegación

```ts
useRouter() // acceso completo al router
useParams() // params de la ruta activa: { id: '42' }
useNavigate() // función navigate() del router
```

---

## El Store (`src/store/`)

Estado global reactivo. Internamente cada propiedad del estado es un signal independiente. La interfaz es un `Proxy` que hace las lecturas transparentemente reactivas.

```ts
interface AppState {
  theme: 'dark' | 'light'
  count: number
}

const [store, setStore] = createStore<AppState>({ theme: 'dark', count: 0 })

store.theme // lee (reactivo dentro de effects/JSX)
setStore('theme', 'light') // actualiza una propiedad
setStore('count', (c) => c + 1) // actualiza con función
setStore({ theme: 'light', count: 5 }) // actualiza varias a la vez
```

Puedes crear tantas stores como quieras — no hay singleton. La "globalidad" viene de exportar la store desde un módulo ES:

```ts
// themeStore.ts
export const [themeStore, setThemeStore] = createStore<ThemeState>({ theme: 'dark' })

// cartStore.ts
export const [cartStore, setCartStore] = createStore<CartState>({ items: [], total: 0 })
```

**`select(store, selector)`** — azúcar sintáctico para crear un `computed` sobre una store:

```ts
const fullName = select(store, (s) => `${s.firstName} ${s.lastName}`)
// fullName() es reactivo: se actualiza cuando firstName o lastName cambia
```

---

## El build system

El proyecto usa **Vite 5** + **TypeScript 5**. La configuración relevante en `vite.config.ts`:

```ts
esbuild: {
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  jsxInject: `import { h, Fragment } from 'axon/jsx'`,
}
```

- **`jsxInject`** — inyecta automáticamente `h` y `Fragment` en cada archivo `.tsx`. No hay que importarlos manualmente.
- **`axon/jsx`** apunta a `src/jsx.ts` (no a `src/index.ts`) para evitar una importación circular.
- **`axon`** apunta a `src/index.ts` — el entry point principal.
- **Tailwind CSS v4** — plugin `@tailwindcss/vite`. Basta con `@import "tailwindcss"` en el CSS.

---

## Principios de diseño

| Principio                                     | Consecuencia                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| Componentes se ejecutan una sola vez          | No hay re-renders ni Virtual DOM                                |
| Las funciones son el mecanismo de reactividad | Pasar un getter como prop/hijo lo hace reactivo automáticamente |
| Stacks globales para contexto implícito       | `onMount`, `effect`, context funcionan sin pasar parámetros     |
| Sin magia de compilador                       | Todo es JavaScript/TypeScript estándar en runtime               |

---

## Estructura de archivos

```
src/
  index.ts              ← exports públicos del framework
  jsx.ts                ← entry point solo para JSX (evita ciclo circular)
  types.ts              ← tipos compartidos internos
  reactivity/
    signal.ts           ← signal, batch, untrack
    effect.ts           ← effect, effectStack
    computed.ts         ← computed
  dom/
    h.ts                ← JSX runtime (h, Fragment, namespace JSX)
    render.ts           ← mount, createApp
    helpers.ts          ← Show, For, Dynamic, Portal
    transitions.ts      ← withViewTransition
  component/
    lifecycle.ts        ← runOwned, runWithOwner, onMount, onCleanup, disposeOwner
    context.ts          ← createContext
  router/
    router.ts           ← createRouter, useRouter, useParams, useNavigate
    components.tsx      ← RouterView, Link
  store/
    store.ts            ← createStore, select

examples/app/           ← app de demo completa
  main.tsx              ← punto de entrada, createRouter, createApp
  store.ts              ← store global de ejemplo
  style.css             ← estilos globales + Tailwind + view transitions
  vite.config.ts        ← configuración de Vite
  pages/                ← Home, About, TodoPage, PrivatePage, NotFound
  components/           ← Nav, Badge, Counter, PrivateLayout, PublicLayout
```

---

> axon.js v0.1.0. Código fuente en [`src/`](src/).
