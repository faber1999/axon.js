# axon.js — Cómo funciona por dentro

> Documento técnico exhaustivo. Explica cada capa del framework, cómo están conectadas entre sí, y por qué están diseñadas de esa manera.

---

## Tabla de contenidos

1. [Filosofía y principios de diseño](#1-filosofía-y-principios-de-diseño)
2. [El sistema de reactividad](#2-el-sistema-de-reactividad)
   - 2.1 [effect — el observador](#21-effect--el-observador)
   - 2.2 [signal — el valor reactivo](#22-signal--el-valor-reactivo)
   - 2.3 [El mecanismo de suscripción automática](#23-el-mecanismo-de-suscripción-automática)
   - 2.4 [computed — valores derivados](#24-computed--valores-derivados)
   - 2.5 [batch — actualizaciones agrupadas](#25-batch--actualizaciones-agrupadas)
   - 2.6 [untrack — lectura sin suscripción](#26-untrack--lectura-sin-suscripción)
3. [El runtime de JSX](#3-el-runtime-de-jsx)
   - 3.1 [Qué hace el compilador JSX](#31-qué-hace-el-compilador-jsx)
   - 3.2 [La función h()](#32-la-función-h)
   - 3.3 [Props estáticas vs reactivas](#33-props-estáticas-vs-reactivas)
   - 3.4 [Hijos estáticos vs reactivos](#34-hijos-estáticos-vs-reactivos)
   - 3.5 [El truco de los comment markers](#35-el-truco-de-los-comment-markers)
   - 3.6 [Fragment](#36-fragment)
4. [El sistema de componentes y lifecycle](#4-el-sistema-de-componentes-y-lifecycle)
   - 4.1 [Qué es un owner](#41-qué-es-un-owner)
   - 4.2 [runWithOwner — cómo se ejecuta un componente](#42-runwithowner--cómo-se-ejecuta-un-componente)
   - 4.3 [onMount y onCleanup](#43-onmount-y-oncleanup)
   - 4.4 [disposeOwner — destrucción del árbol](#44-disposeowner--destrucción-del-árbol)
   - 4.5 [Context API](#45-context-api)
5. [El renderer: mount() y createApp()](#5-el-renderer-mount-y-createapp)
6. [Los helpers de control de flujo](#6-los-helpers-de-control-de-flujo)
   - 6.1 [Show — renderizado condicional](#61-show--renderizado-condicional)
   - 6.2 [For — renderizado de listas](#62-for--renderizado-de-listas)
   - 6.3 [Dynamic — componente dinámico](#63-dynamic--componente-dinámico)
   - 6.4 [Portal — renderizado fuera del árbol](#64-portal--renderizado-fuera-del-árbol)
7. [El router](#7-el-router)
   - 7.1 [Compilación de rutas y RouteGroups](#71-compilación-de-rutas-y-routegroups)
   - 7.2 [Los signals del router](#72-los-signals-del-router)
   - 7.3 [navigate()](#73-navigate)
   - 7.4 [RouterView — guards, layouts y lifecycle](#74-routerview--guards-layouts-y-lifecycle)
   - 7.5 [Link](#75-link)
   - 7.6 [View Transitions](#76-view-transitions)
   - 7.7 [Helpers del router: useParams, useNavigate, currentRoute](#77-helpers-del-router-useparams-usenavigate-currentroute)
8. [El store global](#8-el-store-global)
   - 8.1 [createStore — arquitectura interna](#81-createstore--arquitectura-interna)
   - 8.2 [El Proxy como interfaz](#82-el-proxy-como-interfaz)
   - 8.3 [setStore](#83-setstore)
   - 8.4 [select — computed sobre store](#84-select--computed-sobre-store)
9. [La coherencia entre capas](#9-la-coherencia-entre-capas)
   - 9.1 [El flujo de datos completo](#91-el-flujo-de-datos-completo)
   - 9.2 [El hilo conductor: "las funciones son reactivas"](#92-el-hilo-conductor-las-funciones-son-reactivas)
   - 9.3 [Las dos pilas paralelas](#93-las-dos-pilas-paralelas)
   - 9.4 [Diagrama de dependencias entre módulos](#94-diagrama-de-dependencias-entre-módulos)
10. [El build system y la solución al problema circular](#10-el-build-system-y-la-solución-al-problema-circular)
11. [Traza de ejecución completa: de createApp() al DOM](#11-traza-de-ejecución-completa-de-createapp-al-dom)

---

## 1. Filosofía y principios de diseño

axon.js se basa en **tres principios fundamentales** que determinan todas las decisiones de implementación:

### Principio 1: Reactividad fina (fine-grained reactivity)

En React, cuando un estado cambia, **la función del componente completa se vuelve a ejecutar**. React luego compara el resultado con el anterior (Virtual DOM diff) y aplica los cambios mínimos al DOM real.

En axon.js, cuando un signal cambia, **solo los efectos específicos que leen ese signal se vuelven a ejecutar**. Esos efectos saben exactamente qué nodo del DOM actualizar. No hay comparación, no hay árbol virtual.

Esto significa:

- **Componentes se ejecutan exactamente una vez** — para crear el DOM inicial.
- **Updates son quirúrgicos** — solo el nodo exacto que depende del signal se toca.
- **No existe el concepto de "re-render"** en axon.js.

### Principio 2: Las funciones son el mecanismo de reactividad

axon.js no tiene magia de compilador (a diferencia de Svelte). En cambio, usa una convención elegante:

> **Si un valor que pasas al JSX es una función, axon lo trata como reactivo.**

```jsx
const [count, setCount] = signal(0)

<p>{count}</p>       // count es una función (getter) → reactivo
<p>{"hola"}</p>      // string → estático, se aplica una vez
<p>{count()}</p>     // count() es el valor evaluado (número) → estático
```

Esta convención aplica a props y a hijos por igual. Es el hilo conductor de todo el framework.

### Principio 3: Stacks globales para contexto implícito

axon.js usa **dos pilas globales** para pasar información implícitamente durante la ejecución de componentes, sin necesidad de parámetros:

- `effectStack` — para el sistema de reactividad: sabe qué efecto está ejecutándose ahora.
- `ownerStack` — para el sistema de lifecycle: sabe a qué componente pertenece un `onMount`.

Estos stacks son el "hilo invisible" que conecta el sistema de reactividad con el sistema de componentes.

---

## 2. El sistema de reactividad

El sistema de reactividad vive en `src/reactivity/`. Es la capa más fundamental — todo lo demás depende de ella.

### 2.1 effect — el observador

**Archivo:** [`src/reactivity/effect.ts`](src/reactivity/effect.ts)

`effect` es la primitiva más básica del sistema de reactividad. Es un observador: ejecuta una función y **rastrea automáticamente qué signals lee durante esa ejecución**.

#### La pila de efectos (`effectStack`)

```js
export const effectStack = []
```

Este array es el corazón del rastreo automático. Es una **pila** porque los efectos pueden anidarse (un effect puede contener otro effect). La pila garantiza que en cada momento, solo el efecto del tope es el "observador actual".

```js
export function getCurrentEffect() {
  return effectStack[effectStack.length - 1] ?? null
}
```

Esto devuelve `null` si no hay ningún efecto ejecutándose — lo que significa que no se debe crear ninguna suscripción.

#### Cómo funciona `effect(fn)`

```js
export function effect(fn) {
  let cleanup = null

  const run = () => {
    if (typeof cleanup === 'function') {
      cleanup() // 1. Limpia el cleanup anterior antes de re-ejecutar
      cleanup = null
    }

    effectStack.push(run) // 2. Se convierte en el observador actual
    try {
      cleanup = fn() ?? null // 3. Ejecuta fn — mientras se ejecuta, cualquier signal que se lea nos suscribirá
    } finally {
      effectStack.pop() // 4. Deja de ser el observador actual (siempre, aunque haya error)
    }
  }

  run._subscriptions = new Set() // 5. Registra sus propias suscripciones (para poder cancelarlas)
  run._disposed = false

  run() // 6. Primera ejecución inmediata

  const dispose = () => {
    run._disposed = true
    run._subscriptions.forEach((unsub) => unsub()) // 7. Cancela todas las suscripciones
    run._subscriptions.clear()
    if (typeof cleanup === 'function') {
      cleanup()
      cleanup = null
    }
  }

  return dispose
}
```

**Puntos clave:**

- `run` es la función que se registra como suscriptor en los signals. No es `fn` — es el **wrapper** que maneja el push/pop del stack.
- `run._subscriptions` es un `Set` de funciones "unsubscribe". Cuando el efecto se dispone, llama a cada una para quitarse de los signals a los que estaba suscrito.
- `run._disposed` evita que un efecto ya eliminado vuelva a ejecutarse si una notificación llegó tarde.
- El `try/finally` garantiza que aunque `fn()` lance un error, el stack siempre se restaura correctamente. Sin esto, un error dejaría el stack corrupto y todos los signals subsecuentes pensarían que están siendo observados por el efecto roto.
- `fn()` puede retornar una función de cleanup. Este cleanup se ejecuta **antes de cada re-ejecución** del efecto. Esto es útil para limpiar event listeners, timers, etc.

#### `untrack`

```js
export function untrack(fn) {
  const len = effectStack.length
  effectStack.length = 0 // Vacía la pila temporalmente
  try {
    return fn()
  } finally {
    effectStack.length = len // Restaura
  }
}
```

`untrack` permite leer signals dentro de un efecto **sin crear suscripciones**. Al vaciar la pila, `getCurrentEffect()` devuelve `null`, y los signals ignoran la lectura.

---

### 2.2 signal — el valor reactivo

**Archivo:** [`src/reactivity/signal.ts`](src/reactivity/signal.ts)

Un signal es un contenedor de valor reactivo. Tiene dos partes: un **getter** (función que lee el valor) y un **setter** (función que escribe y notifica).

```js
export function signal(initialValue) {
  let value = initialValue
  const subscribers = new Map() // Map<runFn, unsubscribeFn>

  const read = () => {
    const currentEffect = getCurrentEffect()
    if (currentEffect && !subscribers.has(currentEffect)) {
      // Suscripción bidireccional:
      subscribers.set(currentEffect, () => {
        subscribers.delete(currentEffect) // El signal puede olvidar al efecto
      })
      currentEffect._subscriptions?.add(() => {
        subscribers.delete(currentEffect) // El efecto puede olvidar al signal
      })
    }
    return value
  }

  const write = (newValue) => {
    const next = typeof newValue === 'function' ? newValue(value) : newValue
    if (Object.is(next, value)) return // Optimización: no notifica si el valor no cambió
    value = next

    const subs = [...subscribers.keys()] // Snapshot para evitar problemas con mutaciones durante iteración
    subs.forEach((run) => {
      if (!run._disposed) scheduleEffect(run)
    })
  }

  return [read, write]
}
```

**Por qué `Map` en lugar de `Set` para subscribers:**

El `Map` mapea `runFn → unsubscribeFn`. Esto permite:

1. Verificar si un efecto ya está suscrito: `subscribers.has(currentEffect)` — evita duplicados.
2. Tener la función para des-suscribir lista para cuando el efecto se destruye.

**La suscripción bidireccional:**

Cuando un signal registra un efecto como suscriptor, simultáneamente le dice al efecto "recuerda que me estás suscribiendo". Esto es la suscripción bidireccional — ambos lados saben del otro:

- El signal puede notificar al efecto cuando cambia.
- El efecto puede des-suscribirse del signal cuando se destruye.

**El snapshot `[...subscribers.keys()]`:**

Al notificar, se hace un snapshot de la lista de suscriptores antes de iterarla. Esto es crucial porque al notificar a un efecto, ese efecto podría re-ejecutarse y añadir/quitar suscriptores del mismo signal, lo que causaría errores si iteráramos el Map original.

**`Object.is(next, value)`:**

Usa `Object.is` en lugar de `===` porque `Object.is` diferencia correctamente `NaN !== NaN` (en JS, `NaN === NaN` es `false`, pero `Object.is(NaN, NaN)` es `true`). Esto evita notificaciones infinitas si el valor es `NaN`.

---

### 2.3 El mecanismo de suscripción automática

Este es el momento más importante para entender el sistema. Veamos qué pasa cuando escribes esto:

```js
const [count, setCount] = signal(0)

effect(() => {
  document.title = `Clicks: ${count()}`
})
```

**Paso a paso:**

1. `effect(fn)` es llamado. Crea `run` y lo pone en `effectStack`: `[run]`.
2. `fn()` se ejecuta: `document.title = \`Clicks: ${count()}\``
3. Dentro de `fn`, se llama `count()` → que es la función `read`.
4. `read` llama `getCurrentEffect()` → devuelve `run` (está en el tope de la pila).
5. `run` no está aún en `subscribers` del signal, así que se suscribe.
6. `read` devuelve `0`. El title se pone `"Clicks: 0"`.
7. `fn()` termina. `run` se saca del stack: `[]`.

Ahora, cuando `setCount(1)` es llamado:

8. `write` calcula `next = 1`. `Object.is(1, 0)` es `false`, así que procede.
9. `value = 1`.
10. Notifica a todos los subscribers — en este caso, solo `run`.
11. `run` se ejecuta de nuevo → `fn()` se ejecuta de nuevo → `document.title = "Clicks: 1"`.

**Y el ciclo se mantiene:** cada vez que `run` se re-ejecuta, lee `count()` de nuevo, lo que renueva la suscripción.

> **Importante:** Las suscripciones en axon.js son **dinámicas y por ejecución**. No son permanentes. Cada vez que un efecto se re-ejecuta, sus suscripciones se renuevan. Esto permite suscripciones condicionales:

```js
effect(() => {
  if (isLoggedIn()) {
    // Solo suscribe a userName cuando el usuario está logueado
    document.title = userName()
  }
})
```

---

### 2.4 computed — valores derivados

**Archivo:** [`src/reactivity/computed.ts`](src/reactivity/computed.ts)

`computed` es notablemente simple porque está construido sobre las primitivas anteriores:

```js
export function computed(fn) {
  const [get, set] = signal(undefined)
  effect(() => set(fn()))
  return get
}
```

Internamente es **un signal + un effect**:

- El `effect` ejecuta `fn()`, lo que suscribe el efecto a todos los signals que `fn` lea.
- Cuando alguno de esos signals cambia, el efecto se re-ejecuta, llama `fn()` de nuevo y escribe el resultado en el signal interno.
- El signal interno notifica a todos los efectos que leen el computed.
- Solo retorna el getter (`get`), haciendo el computed **read-only**.

**Por qué esto funciona con anidamiento:**

```js
const [a, setA] = signal(1)
const [b, setB] = signal(2)
const sum = computed(() => a() + b()) // signal interno: 3
const doubled = computed(() => sum() * 2) // signal interno: 6
```

El `effect` de `doubled` lee `sum()`, que llama al getter del signal interno de `sum`. Eso crea una suscripción entre el efecto de `doubled` y el signal de `sum`. Cuando `setA(2)`:

1. El efecto de `sum` se re-ejecuta → el signal de `sum` cambia de 3 a 4.
2. Eso notifica al efecto de `doubled` → `doubled` se re-ejecuta → `doubled` cambia de 6 a 8.

La cadena reactiva se propaga automáticamente.

---

### 2.5 batch — actualizaciones agrupadas

**Archivo:** [`src/reactivity/signal.ts`](src/reactivity/signal.ts)

Sin `batch`, si actualizas dos signals, cada uno notifica a sus efectos inmediatamente:

```js
// Sin batch: los efectos se ejecutan DOS veces
setFirstName('Juan') // → notifica efectos
setLastName('García') // → notifica efectos de nuevo
```

Con `batch`, todas las notificaciones se posponen hasta que el bloque termina:

```js
// Con batch: los efectos se ejecutan UNA vez
batch(() => {
  setFirstName('Juan')
  setLastName('García')
}) // → aquí se notifica, una sola vez
```

**Cómo funciona:**

```js
let batchDepth = 0
const pendingEffects = new Set()

function scheduleEffect(run) {
  if (batchDepth > 0) {
    pendingEffects.add(run) // Acumula en lugar de ejecutar
  } else {
    run() // Ejecuta inmediatamente si no estamos en batch
  }
}

export function batch(fn) {
  batchDepth++
  try {
    fn()
  } finally {
    batchDepth--
    if (batchDepth === 0) flushEffects() // Solo flush al salir del batch más externo
  }
}
```

`batchDepth` es un contador, no un booleano, para soportar **batches anidados**. Si llamas `batch()` dentro de otro `batch()`, el flush solo ocurre cuando el batch más externo termina.

`pendingEffects` es un `Set`, no un array, para evitar duplicados. Si el mismo efecto fue invalidado por múltiples signals en el mismo batch, solo se ejecuta una vez.

---

### 2.6 untrack — lectura sin suscripción

```js
export function untrack(fn) {
  const len = effectStack.length
  effectStack.length = 0
  try {
    return fn()
  } finally {
    effectStack.length = len
  }
}
```

Un caso de uso real:

```js
effect(() => {
  const current = count() // sí crea suscripción
  const prev = untrack(() => prevCount()) // NO crea suscripción
  console.log(`cambió de ${prev} a ${current}`)
})
```

El efecto solo se re-ejecuta cuando `count` cambia, no cuando `prevCount` cambia.

---

## 3. El runtime de JSX

### 3.1 Qué hace el compilador JSX

JSX no es JavaScript válido. Antes de ejecutarse, Vite (usando esbuild) transforma cada expresión JSX en llamadas a funciones. La configuración en `vite.config.js`:

```js
esbuild: {
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  jsxInject: `import { h, Fragment } from 'axon/jsx'`,
}
```

Esto le dice a esbuild: _"cuando veas JSX, conviértelo en llamadas a `h()`. Para fragmentos usa `Fragment`. Y auto-importa `h` y `Fragment` de `axon/jsx` en cada archivo .jsx"._

**Ejemplo de transformación:**

```jsx
// Lo que escribes
;<div class="app">
  <p>{count}</p>
  <button onClick={() => setCount((c) => c + 1)}>+</button>
</div>

// Lo que esbuild genera
h('div', { class: 'app' }, h('p', null, count), h('button', { onClick: () => setCount((c) => c + 1) }, '+'))
```

Observa que `{count}` se convierte en simplemente `count` — el getter del signal, que es una función. Esto es exactamente lo que necesitamos para el mecanismo reactivo.

---

### 3.2 La función h()

**Archivo:** [`src/dom/h.ts`](src/dom/h.ts)

`h(type, props, ...children)` es la función central del runtime. Tiene tres caminos:

```js
export function h(type, props, ...children) {
  // Camino 1: Fragment — devuelve los hijos como array plano
  if (type === Fragment) {
    return children.flat()
  }

  // Camino 2: Función — es un componente
  if (typeof type === 'function') {
    const componentProps = { ...props }
    if (children.length === 1) componentProps.children = children[0]
    else if (children.length > 1) componentProps.children = children.flat()
    return runWithOwner(type, componentProps)
  }

  // Camino 3: String — es un elemento DOM nativo
  const el = document.createElement(type)
  // ... aplicar props y children
  return el
}
```

**El camino 2 es la conexión entre el JSX y el sistema de lifecycle.** Cuando `h` encuentra un componente función, no lo llama directamente — lo ejecuta a través de `runWithOwner`, que crea un contexto de lifecycle para ese componente.

---

### 3.3 Props estáticas vs reactivas

Para cada prop, `h` decide si es estática o reactiva:

```js
for (const key of Object.keys(props)) {
  const value = props[key]
  if (key === 'children') continue

  if (typeof value === 'function' && !key.startsWith('on')) {
    // REACTIVA: es una función que no es un event handler
    effect(() => applyProp(el, key, value()))
  } else {
    // ESTÁTICA: se aplica una sola vez
    applyProp(el, key, value)
  }
}
```

La condición `!key.startsWith('on')` es crucial: los event handlers (`onClick`, `onInput`, etc.) **también son funciones**, pero no deben tratarse como reactivos — son handlers que se registran una vez y no cambian.

Entonces la regla es: **función que no empieza con "on" = reactiva**.

```jsx
<div class={cls}>          // cls es función → effect(() => el.className = cls())
<div class="static">       // string → el.className = 'static'
<button onClick={handler}> // función con "on" → el.addEventListener('click', handler)
```

La función `applyProp` maneja correctamente cada tipo de prop:

| Prop                  | Comportamiento                                 |
| --------------------- | ---------------------------------------------- |
| `class` / `className` | `el.className = value`                         |
| `style` (string)      | `el.style.cssText = value`                     |
| `style` (objeto)      | `Object.assign(el.style, value)`               |
| `ref` (función)       | `value(el)` — callback ref                     |
| `ref` (objeto)        | `value.current = el` — mutable ref             |
| `onXxx`               | `el.addEventListener('xxx', value)`            |
| atributos booleanos   | `setAttribute` o `removeAttribute`             |
| `innerHTML`           | `el.innerHTML = value` (cuidado con XSS)       |
| resto                 | `setAttribute` / `removeAttribute` según valor |

---

### 3.4 Hijos estáticos vs reactivos

```js
function appendChild(parent, child) {
  if (child == null || child === false) return // null/false → nada

  if (Array.isArray(child)) {
    // array → recursivo
    child.forEach((c) => appendChild(parent, c))
    return
  }

  if (child instanceof Node) {
    // nodo DOM → directo
    parent.appendChild(child)
    return
  }

  if (typeof child === 'function') {
    // FUNCIÓN → reactivo
    // ... (ver sección 3.5)
    return
  }

  parent.appendChild(document.createTextNode(String(child))) // string/número → texto estático
}
```

---

### 3.5 El truco de los comment markers

Cuando un hijo es una función (reactivo), no podemos simplemente insertar el texto y actualizarlo, porque el hijo podría devolver un **elemento DOM completo**, un **array de elementos**, o incluso `null`.

La solución: **dos nodos comentario como marcadores de posición**.

```js
if (typeof child === 'function') {
  let startMarker = document.createComment('')
  let endMarker = document.createComment('')
  parent.appendChild(startMarker)
  parent.appendChild(endMarker)

  effect(() => {
    const result = child()

    // 1. Limpia todo lo que haya entre los dos marcadores
    let node = startMarker.nextSibling
    while (node && node !== endMarker) {
      const next = node.nextSibling
      parent.removeChild(node)
      node = next
    }

    // 2. Inserta el nuevo contenido justo antes del marcador final
    const nodes = Array.isArray(result) ? result : [result]
    nodes.forEach((n) => {
      if (n != null && n !== false) {
        parent.insertBefore(toNode(n), endMarker)
      }
    })
  })
}
```

**Por qué comentarios y no un div wrapper:**

Un `<div>` cambiaría la semántica del HTML. Los comentarios son invisibles al usuario y no afectan el layout. Son "marcadores posicionales" puros.

**El DOM resultante se ve así:**

```
<!-- (startMarker) -->
<p>El texto reactivo actual</p>  ← puede ser cualquier cosa
<!-- (endMarker) -->
```

Cuando el signal cambia, el efecto elimina todo lo que esté entre los dos comentarios e inserta el nuevo contenido. Los comentarios permanecen como anclas permanentes.

**Este mismo patrón se usa en `Show`, `For`, `Dynamic` y `RouterView`** — es la técnica fundamental para actualizar secciones del DOM sin afectar lo que está alrededor.

---

### 3.6 Fragment

```js
export const Fragment = Symbol('Fragment')

// En h():
if (type === Fragment) {
  return children.flat()
}
```

`Fragment` es un símbolo único. Cuando `h` lo recibe como `type`, devuelve los hijos directamente como un array plano — sin envolver en ningún elemento. El código que recibe este array (ya sea `mount`, `appendChild`, o el padre en el árbol) sabe manejar arrays.

```jsx
// Esto:
;<>
  <p>Uno</p>
  <p>Dos</p>
</>

// Se compila a:
h(Fragment, null, h('p', null, 'Uno'), h('p', null, 'Dos'))[
  // Que devuelve:
  ((<p>Uno</p>), (<p>Dos</p>))
] // Array de nodos, sin wrapper
```

---

## 4. El sistema de componentes y lifecycle

### 4.1 Qué es un owner

**Archivo:** [`src/component/lifecycle.ts`](src/component/lifecycle.ts)

Cada componente tiene un **owner** — un objeto que actúa como registro de su lifecycle:

```js
const owner = {
  _onMount: [], // callbacks a ejecutar cuando el componente está en el DOM
  _onCleanup: [], // callbacks a ejecutar cuando el componente se destruye
  _children: [], // owners de componentes hijos (árbol de owners)
  _mounted: false // flag para evitar ejecutar onMount dos veces
}
```

El árbol de owners **espeja el árbol de componentes**. Si `App` renderiza `TodoPage`, el owner de `TodoPage` es hijo del owner de `App`. Cuando `App` se destruye, `disposeOwner` recorre el árbol destruyendo también a `TodoPage`.

---

### 4.2 runOwned y runWithOwner — cómo se ejecuta un componente

El sistema de lifecycle expone dos primitivas para ejecutar código dentro de un contexto de owner:

#### `runOwned<T>(fn: () => T): [T, ComponentOwner]`

La primitiva de bajo nivel. Crea un owner, ejecuta `fn` dentro de él, y retorna **tanto el resultado como el owner handle**. Útil cuando necesitas retener el owner para hacer dispose manual después (por ejemplo, `RouterView` lo usa para disponer el componente de la ruta anterior al navegar).

```ts
export function runOwned<T>(fn: () => T): [T, ComponentOwner] {
  const owner = { _onMount: [], _onCleanup: [], _children: [], _mounted: false }

  const parent = getCurrentOwner()
  if (parent) parent._children.push(owner) // Conecta al árbol de owners

  ownerStack.push(owner)
  let result!: T
  try {
    result = fn() // fn puede ser cualquier cosa: un componente, un layout, etc.
  } finally {
    ownerStack.pop() // Restaura siempre, aunque fn() lance un error
  }

  queueMicrotask(() => {
    if (!owner._mounted) {
      owner._mounted = true
      owner._onMount.forEach((cb) => cb())
    }
  })

  return [result, owner] // ← retorna el handle del owner para uso externo
}
```

#### `runWithOwner(fn, props): Node | Node[] | null`

Envoltura conveniente sobre `runOwned`. Crea el owner y lo descarta — el caller no necesita el handle. Es la función que `h()` usa internamente para cada componente.

```ts
export function runWithOwner<P extends Record<string, unknown>>(fn, props) {
  const [result] = runOwned(() => fn(props))
  return result
}
```

**Por qué dos funciones y no una:**

`h()` nunca necesita el owner — llama al componente y solo le importa el resultado DOM. `RouterView` sí necesita el owner para poder hacer `disposeOwner(currentOwner)` cuando el usuario navega a otra ruta. Separar las funciones mantiene la API de `h()` simple y da acceso preciso al owner cuando se necesita.

**El rol de `queueMicrotask`:**

La función del componente devuelve nodos DOM, pero esos nodos todavía no están **en el documento** — están siendo construidos. El código que llamó a `runOwned` los insertará en el DOM después.

`queueMicrotask` pospone la ejecución de `onMount` hasta después del script actual, cuando los nodos ya están insertados. Así, `onMount` puede acceder a dimensiones, hacer scroll, etc.

```
Ejecución síncrona:
  runOwned(fn)
    → fn() ejecuta → crea nodos DOM → los devuelve
    → queueMicrotask(llamar onMount) ← programado para después
  → los nodos se insertan en el DOM

Microtask queue (siguiente tick):
  → onMount callbacks se ejecutan ← el DOM ya está listo
```

**El rol de `queueMicrotask`:**

La función del componente devuelve nodos DOM, pero esos nodos todavía no están **en el documento** — están siendo construidos. El código que llamó a `runWithOwner` los insertará en el DOM después.

`queueMicrotask` pospone la ejecución de `onMount` hasta después del script actual, cuando los nodos ya están insertados. Así, `onMount` puede acceder a dimensiones, hacer scroll, etc.

```
Ejecución síncrona:
  runWithOwner(Component, props)
    → fn(props) ejecuta → crea nodos DOM → los devuelve
    → queueMicrotask(llamar onMount) ← programado para después
  → los nodos se insertan en el DOM

Microtask queue (siguiente tick):
  → onMount callbacks se ejecutan ← el DOM ya está listo
```

---

### 4.3 onMount y onCleanup

```js
export function onMount(fn) {
  const owner = getCurrentOwner() // Lee el tope de ownerStack
  if (owner) owner._onMount.push(fn)
}

export function onCleanup(fn) {
  const owner = getCurrentOwner()
  if (owner) owner._onCleanup.push(fn)
}
```

Ambos funcionan igual: leen el owner actual de la pila y registran el callback. Por eso **solo pueden llamarse durante la ejecución síncrona de la función del componente** — después de que `runWithOwner` devuelve, el owner ya no está en la pila.

```js
function MyComponent() {
  onMount(() => {
    // ← owner está en la pila → se registra ✓
    console.log('montado')
  })

  setTimeout(() => {
    onMount(() => {
      // ← owner ya NO está → console.warn ✗
      console.log('nunca se registrará')
    })
  }, 1000)

  return <div>...</div>
}
```

---

### 4.4 disposeOwner — destrucción del árbol

```js
export function disposeOwner(owner) {
  owner._children.forEach(disposeOwner) // Destruye hijos primero (depth-first)
  owner._onCleanup.forEach((cb) => cb()) // Luego ejecuta sus propios cleanups
  owner._onMount = []
  owner._onCleanup = []
  owner._children = []
}
```

La destrucción es **depth-first**: primero se destruyen los hijos, luego el padre. Esto garantiza que cuando el cleanup del padre se ejecuta, los hijos ya están limpios.

---

### 4.5 Context API

**Archivo:** [`src/component/context.ts`](src/component/context.ts)

El Context permite pasar datos a través del árbol sin prop drilling:

```js
const contextMap = new Map() // Symbol → valor[]  (pilas por contexto)

export function createContext(defaultValue) {
  const key = Symbol('axon.context') // Clave única e irrepetible

  const Provider = ({ value, children }) => {
    if (!contextMap.has(key)) contextMap.set(key, [])
    contextMap.get(key).push(value) // Apila el valor

    queueMicrotask(() => {
      contextMap.get(key)?.pop() // Desapila después del render
    })

    return Array.isArray(children) ? children : [children]
  }

  const use = () => {
    const stack = contextMap.get(key)
    if (stack && stack.length > 0) return stack[stack.length - 1] // Lee tope
    return defaultValue // Fallback si no hay Provider
  }

  return { Provider, use }
}
```

**Cómo funciona la pila de contextos:**

El render de axon.js es **síncrono y en profundidad** (depth-first). Cuando `Provider` se ejecuta, apila su valor. Todos sus descendientes que llamen `use()` leerán ese valor del tope de la pila. Cuando el render del subárbol termina, `queueMicrotask` desapila el valor.

Múltiples `Provider` anidados del mismo contexto forman una pila, y el `use()` siempre lee el Provider más cercano.

---

## 5. El renderer: mount() y createApp()

**Archivo:** [`src/dom/render.ts`](src/dom/render.ts)

```js
export function mount(component, container, props = {}) {
  container.innerHTML = '' // Limpia el container

  let nodes
  if (typeof component === 'function') {
    nodes = runWithOwner(component, props) // Crea el owner raíz
  } else {
    nodes = component // Ya es un nodo DOM
  }

  const append = (node) => {
    if (node == null) return
    if (Array.isArray(node))
      node.forEach(append) // Soporta Fragments
    else container.appendChild(node)
  }

  append(nodes)
}

export function createApp(RootComponent) {
  return {
    mount(selector) {
      const container = typeof selector === 'string' ? document.querySelector(selector) : selector
      if (!container) throw new Error(`[axon] mount target not found: ${selector}`)
      mount(RootComponent, container)
    }
  }
}
```

`mount()` es el punto de entrada. Crea el **owner raíz** — el ancestro de todos los owners de la app. Todo el árbol de componentes desciende de aquí.

`createApp()` es solo una envoltura de conveniencia para una sintaxis familiar: `createApp(App).mount('#app')`.

---

## 6. Los helpers de control de flujo

Todos los helpers siguen el **mismo patrón**: comment markers + effect. Difieren solo en la lógica de qué se renderiza.

### 6.1 Show — renderizado condicional

**Archivo:** [`src/dom/helpers.ts`](src/dom/helpers.ts)

```jsx
<Show when={isLoggedIn} fallback={<Login />}>
  <Dashboard />
</Show>
```

**Por qué Show necesita ser un componente y no un ternario:**

En React puedes escribir `{isLoggedIn ? <Dashboard /> : <Login />}`. Pero en axon.js, el JSX se evalúa **una sola vez** al crear el árbol. El ternario evaluaría `<Dashboard />` y `<Login />` una sola vez y el resultado sería estático.

`Show` reactivo necesita:

1. Evaluar `when` reactivamente (como función)
2. Montar/desmontar el contenido correcto cuando `when` cambia

```js
export function Show({ when, fallback = null, children }) {
  const start = document.createComment('Show')
  const end = document.createComment('/Show')
  const fragment = document.createDocumentFragment() // No es un elemento real
  fragment.appendChild(start)
  fragment.appendChild(end)

  let currentOwner = null
  const condition = typeof when === 'function' ? when : () => when

  effect(() => {
    const isTrue = Boolean(condition()) // Suscribe al signal de la condición

    // Limpia contenido anterior
    if (currentOwner) {
      disposeOwner(currentOwner)
      currentOwner = null
    }
    let node = start.nextSibling
    while (node && node !== end) {
      const next = node.nextSibling
      node.parentNode?.removeChild(node)
      node = next
    }

    // Inserta contenido nuevo
    const content = isTrue ? children : fallback
    if (content == null) return

    const parent = end.parentNode
    if (!parent) return

    if (typeof content === 'function') {
      const result = content()
      insert(parent, result, end)
    } else {
      insert(parent, content, end)
    }
  })

  return fragment // Devuelve el fragmento con los marcadores
}
```

**Por qué devuelve un `DocumentFragment` y no un elemento:**

Un `DocumentFragment` es un contenedor DOM temporal. Cuando se inserta en el árbol con `appendChild`, **sus hijos se mueven al árbol, no el fragmento en sí**. Así, el `start` y `end` comment van al DOM directamente, y el fragment desaparece. Los marcadores quedan en el lugar correcto.

---

### 6.2 For — renderizado de listas

```jsx
<For each={todos}>{(todo, index) => <li>{todo.text}</li>}</For>
```

```js
export function For({ each, children: renderItem }) {
  const start = document.createComment('For')
  const end = document.createComment('/For')
  const fragment = document.createDocumentFragment()
  fragment.appendChild(start)
  fragment.appendChild(end)

  const getList = typeof each === 'function' ? each : () => each
  let renderedNodes = []

  effect(() => {
    const list = getList() ?? []
    const parent = end.parentNode
    if (!parent) return

    // Limpia todos los nodos renderizados anteriormente
    renderedNodes.forEach((nodes) => {
      nodes.forEach((n) => parent.removeChild(n))
    })
    renderedNodes = []

    // Renderiza cada item
    list.forEach((item, index) => {
      const result = renderItem(item, () => index)
      const nodes = Array.isArray(result) ? result : [result]
      nodes.forEach((n) => {
        if (n != null) parent.insertBefore(n, end)
      })
      renderedNodes.push(nodes)
    })
  })

  return fragment
}
```

**Limitación actual:** es una reconciliación **no-keyed** — cuando la lista cambia, re-renderiza todos los items. Una implementación con keyed diffing compararía items por clave y solo movería/añadiría/eliminaría los que cambiaron. Esto es una mejora futura.

**Por qué `renderItem` recibe `() => index` y no `index`:**

Para consistencia con el sistema: si el usuario quiere el índice reactivo en el futuro (cuando se implemente keyed diffing, el índice puede cambiar para un mismo item), tendría que ser una función.

---

### 6.3 Dynamic — componente dinámico

```jsx
const [currentView, setCurrentView] = signal(HomeView)
<Dynamic component={currentView} />
```

`Dynamic` permite cambiar el componente que se renderiza reactivamente. Cuando `currentView` cambia a un componente diferente, `Dynamic` destruye el anterior e instancia el nuevo.

```js
effect(() => {
  const Component = getter() // getter es currentView (signal getter)
  // ... limpia anterior
  const result = runWithOwner(Component, props) // monta el nuevo con su lifecycle
  // ... inserta en DOM
})
```

---

### 6.4 Portal — renderizado fuera del árbol

```jsx
<Portal mount={document.body}>
  <Modal />
</Portal>
```

`Portal` es el más simple de los helpers. Toma los hijos y los inserta directamente en el `target` en lugar de en la posición actual del árbol. Devuelve un comment placeholder para marcar dónde "está lógicamente" el portal en el árbol.

---

## 7. El router

### 7.1 Compilación de rutas y RouteGroups

**Archivo:** [`src/router/router.ts`](src/router/router.ts)

#### Compilación de paths

Las rutas se definen como patrones de string: `/`, `/about`, `/user/:id`. Para hacer matching eficiente, `compilePath` las convierte a regex:

```ts
function compilePath(pattern) {
  const paramNames = []
  const regexStr = pattern
    .replace(/:([^/]+)/g, (_, name) => {
      // :id → ([^/]+)
      paramNames.push(name)
      return '([^/]+)'
    })
    .replace(/\*/g, '.*') // * → .*  (wildcard catch-all)

  return {
    regex: new RegExp(`^${regexStr}(?:/)?$`), // (?:/)? acepta trailing slash
    paramNames
  }
}
```

Ejemplo: `/user/:id/posts/:postId` se convierte en:

- regex: `/^\/user\/([^/]+)\/posts\/([^/]+)(?:\/)?$/`
- paramNames: `['id', 'postId']`

El wildcard `*` se convierte en `.*`, que acepta cualquier sufijo — útil para una ruta 404 catch-all. El orden de las rutas importa: el array se itera de arriba hacia abajo, por lo que `*` debe ir al final.

Cuando la regex hace match, los grupos de captura se mapean a los nombres de parámetros:

```ts
function matchPath(pattern, pathname) {
  const { regex, paramNames } = compilePath(pattern)
  const match = pathname.match(regex)
  if (!match) return null
  const params = {}
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]) // match[0] es el full match
  })
  return params // { id: '42', postId: '7' }
}
```

#### RouteGroup — agrupación de rutas con layout y guard

`createRouter` acepta `RouteDefinition[]`, que puede mezclar rutas planas (`RouteConfig`) y grupos (`RouteGroup`):

```ts
export interface RouteGroup {
  layout?: ComponentFn<{ children?: JSXChild }>
  guard?: () => boolean | string
  fallbackPath?: string
  children: RouteConfig[]
}

export type RouteDefinition = RouteConfig | RouteGroup
```

Un `RouteGroup` permite que varias rutas compartan el mismo layout y/o guard de acceso. `createRouter` aplana los grupos en un array de `CompiledRoute`, donde cada ruta lleva la metadata del grupo al que pertenece:

```ts
const compiledRoutes: CompiledRoute[] = []
for (const def of routes) {
  if ('children' in def) {
    // Es un RouteGroup — expande cada child y le añade layout/guard/fallbackPath
    for (const child of def.children) {
      compiledRoutes.push({
        ...child,
        ...compilePath(child.path),
        ...(def.layout !== undefined && { layout: def.layout }),
        ...(def.guard !== undefined && { guard: def.guard }),
        ...(def.fallbackPath !== undefined && { fallbackPath: def.fallbackPath })
      })
    }
  } else {
    compiledRoutes.push({ ...def, ...compilePath(def.path) })
  }
}
```

El resultado es siempre un array plano de `CompiledRoute`. Internamente no hay estructura de árbol. `RouterView` solo itera este array para encontrar la ruta activa.

**Ejemplo de definición completa:**

```ts
createRouter(
  [
    { path: '/login', component: Login }, // ruta plana
    {
      layout: PublicLayout, // grupo público (solo layout)
      children: [
        { path: '/', component: Home },
        { path: '/about', component: About }
      ]
    },
    {
      layout: DashboardLayout,
      guard: () => isLoggedIn() || '/login', // guard reactivo
      fallbackPath: '/login',
      children: [
        { path: '/dashboard', component: Dashboard },
        { path: '/settings', component: Settings }
      ]
    },
    { path: '*', component: NotFound } // catch-all 404
  ],
  { viewTransitions: true }
)
```

---

### 7.2 Los signals del router

El router crea tres signals para representar el estado de la URL:

```js
const [pathname, setPathname] = signal(location.pathname) // '/user/42'
const [search, setSearch] = signal(location.search) // '?tab=posts'
const [params, setParams] = signal({}) // { id: '42' }
```

Al ser signals, cualquier componente que los lea se suscribe automáticamente y re-actualiza cuando la URL cambia. `RouterView` lee `pathname()` en un `effect`, así que cuando `pathname` cambia, el efecto se re-ejecuta y actualiza el contenido visible.

El router es un **singleton global** (`_router`). Esto permite que cualquier componente pueda llamar `useRouter()` sin necesidad de prop drilling.

---

### 7.3 navigate()

```ts
const navigate = (to: string, { replace = false }: NavigateOptions = {}): void => {
  if (replace) {
    history.replaceState(null, '', to) // No añade entrada al historial
  } else {
    history.pushState(null, '', to) // Añade entrada al historial
  }
  doSync() // Actualiza los signals (y aplica view transition si está habilitada)
}
```

**Por qué `syncLocation()` manual:**

`history.pushState()` cambia la URL pero **no dispara el evento `popstate`**. El evento `popstate` solo se dispara cuando el usuario presiona atrás/adelante o cuando se llama `history.back()`/`history.forward()`. Por eso, después de `pushState`, hay que sincronizar los signals manualmente.

`doSync` es un wrapper que decide si llamar a `syncLocation` directamente o envolverla en `withViewTransition`:

```ts
const doSync = (): void => {
  if (options.viewTransitions) {
    withViewTransition(syncLocation) // Sincroniza dentro de una view transition
  } else {
    syncLocation()
  }
}

window.addEventListener('popstate', doSync) // Para botones back/forward del browser
```

`syncLocation` usa `batch` para actualizar los tres signals (pathname, search, params) en una sola operación, evitando que los efectos se ejecuten tres veces:

```js
function syncLocation() {
  batch(() => {
    setPathname(location.pathname)
    setSearch(location.search)
    // Encuentra la ruta que hace match y actualiza params
    for (const route of compiledRoutes) {
      const matched = matchPath(route.path, location.pathname)
      if (matched) {
        setParams(matched)
        return
      }
    }
    setParams({})
  })
}
```

---

### 7.4 RouterView — guards, layouts y lifecycle

**Archivo:** [`src/router/components.tsx`](src/router/components.tsx)

`RouterView` es el componente que renderiza el contenido de la ruta activa. Usa el mismo patrón de comment markers que `Show` y `For`, más `runOwned` para gestionar el lifecycle de cada página.

#### Estructura general

```ts
export function RouterView(): DocumentFragment {
  const router = useRouter()
  const start = document.createComment('RouterView')
  const end = document.createComment('/RouterView')
  const fragment = document.createDocumentFragment()
  fragment.appendChild(start)
  fragment.appendChild(end)

  let currentOwner: ComponentOwner | null = null
  let lastValidPath: string | null = null // ← última ruta que pasó el guard

  effect(() => {
    const path = router.pathname() // SUSCRIPCIÓN: re-ejecuta cuando pathname cambia
    const parent = end.parentNode
    if (!parent) return

    // 1. Dispose del componente anterior y limpia sus nodos del DOM
    if (currentOwner) {
      disposeOwner(currentOwner)
      currentOwner = null
    }
    // ... limpia nodos entre markers ...

    // 2. Busca la ruta que hace match
    for (const route of router.routes) {
      if (!route.regex.test(path)) continue

      // 3. Evalúa el guard (si existe)
      // 4. Monta el componente (con layout si existe)
      // 5. Actualiza currentOwner y lastValidPath
      return
    }
  })

  return fragment
}
```

#### Guards de acceso

Cuando una ruta pertenece a un `RouteGroup` con `guard`, `RouterView` evalúa el guard antes de renderizar:

```ts
if (route.guard) {
  const access = route.guard()

  if (access === false) {
    // Denegado: vuelve al path anterior, o al fallbackPath, o no renderiza nada
    const target = lastValidPath ?? route.fallbackPath ?? null
    if (target) queueMicrotask(() => router.navigate(target, { replace: true }))
    return
  }

  if (typeof access === 'string') {
    // Redirección explícita — navega al path indicado
    queueMicrotask(() => router.navigate(access, { replace: true }))
    return
  }
  // access === true → permite el acceso, continúa al render
}
```

**Por qué `queueMicrotask` para navegar:**

`navigate()` llama a `setPathname()`, que es una escritura en un signal. Escribir en un signal dentro de un efecto que está reaccionando a ese mismo signal causaría un bucle. `queueMicrotask` difiere la navegación al siguiente tick, fuera del contexto del efecto actual.

**`lastValidPath`:**

Variable de closure que recuerda la última ruta que pasó exitosamente el guard y se renderizó. Cuando el guard deniega el acceso (`false`) y no hay `fallbackPath`, el usuario vuelve aquí. Se actualiza justo antes de cada render exitoso:

```ts
lastValidPath = path // Guard pasó — registra este path como válido
```

**Tabla de comportamientos del guard:**

| `guard()` retorna | Comportamiento                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| `true`            | Permite acceso, renderiza el componente                                         |
| `false`           | Navega a `lastValidPath` (path previo), o a `fallbackPath`, o no renderiza nada |
| `"/otra-ruta"`    | Navega a ese path con `replace: true`                                           |

#### Layouts y composición de owners

Cuando la ruta tiene `layout`, `RouterView` usa `runOwned` para ejecutar el layout y retener su owner handle:

```ts
if (route.layout) {
  const Layout = route.layout
  const Page = route.component

  ;[result, owner] = runOwned(() => Layout({ children: (() => runWithOwner(Page, { params })) as JSXChild }))
} else {
  ;[result, owner] = runOwned(() => route.component({ params }))
}

currentOwner = owner // Se usará para disposeOwner en la próxima navegación
```

**La clave del layout como función lazy:**

El layout recibe `children` como una función `() => Node`. Cuando el layout procesa `{children}` en su JSX, `h()` detecta que es una función y crea un `effect` que la invoca. Ese `effect` se ejecuta síncronamente **mientras `runOwned` del layout sigue activo** (el owner del layout está en el `ownerStack`).

Cuando la función `children()` se ejecuta, llama a `runWithOwner(Page, ...)`, que crea el owner de la página. Como el owner del layout sigue en el stack, el owner de la página se registra como hijo del owner del layout automáticamente.

**El resultado:** al hacer `disposeOwner(layoutOwner)`, la destrucción en cascada limpia también el componente de la página. No hay que rastrear dos owners por separado.

La conexión clave: `router.pathname()` en el efecto crea una suscripción. Cuando el usuario navega (vía `Link` o `navigate()`), `pathname` cambia, el efecto se re-ejecuta, el owner del componente anterior se dispone (haciendo cascade a sus hijos), y el nuevo componente se monta.

---

### 7.5 Link

```js
export function Link({ href, replace = false, class: cls, activeClass, children }) {
  const router = useRouter()
  const el = document.createElement('a')
  el.href = href

  if (activeClass) {
    // activeClass puede ser "bg-violet-600 text-white" — split para manejar múltiples clases
    const classes = activeClass.split(/\s+/).filter(Boolean)
    effect(() => {
      // Aplica/quita las clases activas reactivamente según pathname
      if (router.pathname() === href) {
        el.classList.add(...classes)
      } else {
        el.classList.remove(...classes)
      }
    })
  }

  el.addEventListener('click', (e) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault() // Evita la navegación nativa del browser
      router.navigate(href, { replace })
    }
  })
  // ...
}
```

`Link` hace dos cosas:

1. **Previene la navegación nativa** (`e.preventDefault()`) y usa `router.navigate()` en su lugar.
2. **Aplica clases activas reactivamente**: el `effect` se suscribe a `pathname()`, así que cuando la URL cambia, las clases se actualizan en todos los Links automáticamente. `activeClass` puede contener múltiples clases separadas por espacio — se hace split antes de pasarlas a `classList.add/remove`.

---

### 7.6 View Transitions

**Archivos:** [`src/dom/transitions.ts`](src/dom/transitions.ts), [`src/router/router.ts`](src/router/router.ts)

axon.js integra la [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) del browser para animar navegaciones.

#### La primitiva: `withViewTransition`

```ts
// src/dom/transitions.ts
export function withViewTransition(fn: () => void): void {
  if ('startViewTransition' in document) {
    document.startViewTransition(fn)
  } else {
    fn() // Fallback: ejecuta directamente en browsers sin soporte
  }
}
```

`document.startViewTransition(fn)` captura el estado actual del DOM como snapshot ("old"), ejecuta `fn` (que actualiza el DOM), y luego anima la transición entre el estado viejo y el nuevo usando pseudo-elementos CSS.

La comprobación `'startViewTransition' in document` garantiza que el código funciona en browsers que no soportan la API (Firefox, Safari antes de 18).

#### Integración en el router

`createRouter` acepta un segundo argumento `options: RouterOptions`:

```ts
export interface RouterOptions {
  viewTransitions?: boolean
}

createRouter(routes, { viewTransitions: true })
```

Cuando `viewTransitions: true`, el router hace dos cosas automáticamente:

**1. Inyecta un `<style>` en el `<head>`:**

```ts
const style = document.createElement('style')
style.dataset.axon = 'view-transitions'
style.textContent = `
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
`
document.head.appendChild(style)
```

Esto desactiva la transición del pseudo-elemento `root` (que capturaría toda la pantalla). Sin esto, el fondo y la nav también se animarían, causando un flash blanco cuando el contenido se hace transparente. Al desactivar `root`, solo los elementos con `view-transition-name` explícito se animan — el fondo siempre está visible.

**2. Envuelve `syncLocation` en `withViewTransition`:**

```ts
const doSync = (): void => {
  if (options.viewTransitions) {
    withViewTransition(syncLocation) // Los signal updates ocurren dentro de la transición
  } else {
    syncLocation()
  }
}
```

El momento exacto en que `syncLocation` se ejecuta es lo que determina qué captura el browser como estado "nuevo". Como `syncLocation` actualiza los signals de `pathname`, `search` y `params`, esos cambios disparan los efectos reactivos que actualizan el DOM — todo dentro del callback de `startViewTransition`.

#### Lo que el usuario configura en CSS

El usuario solo necesita nombrar su área de contenido y definir sus animaciones:

```css
main {
  view-transition-name: page; /* solo los elementos nombrados se animan */
}
::view-transition-old(page) {
  animation: 120ms ease-out fade-out both;
}
::view-transition-new(page) {
  animation: 180ms ease-in fade-in both;
}
```

La regla `root` ya está desactivada por el framework. El usuario no necesita conocer ese detalle.

---

### 7.7 Helpers del router: useParams, useNavigate, currentRoute

Además de `useRouter()`, el router expone tres helpers de conveniencia:

#### `useParams(): Record<string, string>`

Atajo para `useRouter().params()`. Devuelve los parámetros dinámicos de la ruta activa como objeto plano. Es reactivo: si se llama dentro de un `effect` o en JSX como función, se re-evaluará cuando cambie la ruta.

```ts
function UserProfile() {
  const params = useParams(); // { id: '42' }
  return <h1>Usuario {params.id}</h1>
}
```

#### `useNavigate(): Router['navigate']`

Atajo para `useRouter().navigate`. Útil cuando solo necesitas la función de navegación sin acceder a toda la interfaz del router.

```ts
function LogoutButton() {
  const navigate = useNavigate();
  return <button onClick={() => { logout(); navigate('/login') }}>Salir</button>
}
```

#### `currentRoute(): CompiledRoute | null`

Método en la interfaz `Router` que devuelve la ruta activa actual (o `null` si ninguna hace match). Útil para acceder a metadata de la ruta activa fuera de `RouterView`.

```ts
const router = useRouter()
const route = router.currentRoute() // { path: '/user/:id', component: UserProfile, ... }
```

---

## 8. El store global

### 8.1 createStore — arquitectura interna

**Archivo:** [`src/store/store.ts`](src/store/store.ts)

```ts
export function createStore<T extends object>(initialState: T): [T, SetStore<T>] {
  // Un signal por cada propiedad top-level
  const signals: Partial<Record<keyof T, Signal<any>>> = {}
  for (const key of Object.keys(initialState) as (keyof T)[]) {
    signals[key] = signal(initialState[key])
  }

  // ...
}
```

El constraint genérico es `T extends object` (no `Record<string, unknown>`). Este detalle es importante: `Record<string, unknown>` es un tipo con índice implícito que las `interface` de TypeScript no satisfacen automáticamente (las interfaces son "abiertas" y extensibles). Al usar `object`, tanto `interface` como `type` funcionan correctamente como parámetro de tipo:

```ts
// ✅ Ambos funcionan
interface ThemeState {
  theme: 'dark' | 'light'
}
type ThemeState = { theme: 'dark' | 'light' }

const [store, setStore] = createStore<ThemeState>({ theme: 'dark' })
```

Internamente, `createStore({ theme: 'dark', count: 0 })` crea:

```
signals = {
  theme: [getTheme, setTheme],   // signal('dark')
  count: [getCount, setCount],   // signal(0)
}
```

---

### 8.2 El Proxy como interfaz

En lugar de exponer los signals directamente (lo que requeriría escribir `store.theme[0]()`), el store usa un `Proxy` para interceptar los accesos a propiedades:

```js
const store = new Proxy(
  {},
  {
    get(_, key) {
      if (!(key in signals)) throw new Error(`[axon] store has no property "${String(key)}"`)
      return signals[key][0]() // Llama al getter del signal → reactivo
    },
    set() {
      throw new Error('[axon] Store is read-only. Use setStore() to update values.')
    }
    // ...
  }
)
```

Cuando en un componente escribes `store.theme`, el Proxy intercepta el `get`, llama `signals['theme'][0]()` (el getter del signal), y como estamos dentro de un efecto (el render), crea una suscripción automáticamente.

**El resultado:** `store.theme` se comporta como una lectura reactiva normal, pero con sintaxis de objeto simple.

---

### 8.3 setStore

```js
function setStore(keyOrObject, valueOrUpdater) {
  if (typeof keyOrObject === 'object' && keyOrObject !== null) {
    // setStore({ theme: 'light', count: 5 })
    for (const [k, v] of Object.entries(keyOrObject)) {
      if (!(k in signals))
        signals[k] = signal(v) // Crea signal nuevo si no existe
      else signals[k][1](v) // Usa el setter del signal existente
    }
  } else {
    // setStore('theme', 'light') o setStore('count', c => c + 1)
    const key = keyOrObject
    if (!(key in signals)) signals[key] = signal(valueOrUpdater)
    else signals[key][1](valueOrUpdater) // El setter acepta valor o función updater
  }
}
```

`setStore` puede añadir nuevas propiedades dinámicamente. Cuando llamas `setStore('newProp', 42)` y `newProp` no existía, crea un nuevo signal. Cualquier `store.newProp` que se lea después será reactivo.

---

### 8.4 select — computed sobre store

```js
export function select(store, selector) {
  return computed(() => selector(store))
}
```

Un helper que combina `computed` con el store:

```js
const fullName = select(store, (s) => `${s.firstName} ${s.lastName}`)
// fullName es un getter reactivo que se actualiza cuando firstName o lastName cambia
```

Funciona porque dentro del `computed`, `selector(store)` accede a `store.firstName` y `store.lastName` via el Proxy, creando suscripciones a esos signals.

---

## 9. La coherencia entre capas

### 9.1 El flujo de datos completo

Cuando el usuario hace click en un botón que llama `setCount(c => c + 1)`:

```
Usuario hace click
  → handler: setCount(c => c + 1)
  → signal.write(newValue)
    → Object.is(new, old) → false → procede
    → value = nuevo valor
    → notifica subscribers (efectos que leyeron este signal)
      → para cada efecto:
        → scheduleEffect(run) → (batch? acumula : ejecuta)
        → run() ejecuta:
          → efectStack.push(run)
          → fn() se ejecuta (ej: actualiza el DOM)
          → effectStack.pop()
```

Si el efecto está en un `For` o `Show`, su `fn()` limpia los nodos entre markers y re-inserta los nuevos.
Si el efecto es una prop reactiva, llama `applyProp(el, key, value())`.
Si el efecto es un hijo reactivo, actualiza el texto entre los comment markers.

### 9.2 El hilo conductor: "las funciones son reactivas"

La decisión más importante del diseño es que **las funciones son el mecanismo de reactividad**. Esta convención aparece en todas las capas:

| Capa           | Aplicación de la convención                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| `signal`       | Devuelve un getter (función). Leerlo crea suscripción.                       |
| `computed`     | Devuelve un getter (función).                                                |
| `h()` props    | Si el valor es función (no-event) → `effect(() => applyProp(..., val()))`    |
| `h()` children | Si el hijo es función → comment markers + `effect(() => child())`            |
| `Show`         | `when` puede ser función → `condition()`                                     |
| `For`          | `each` puede ser función → `getList()`                                       |
| `store`        | El Proxy llama `signals[key][0]()` (función getter) al acceder a propiedades |
| `Link`         | `activeClass` usa `effect(() => router.pathname() === href)`                 |
| `RouterView`   | `effect(() => { const path = router.pathname() ... })`                       |

En todas partes, el mismo patrón: **funciones como valores reactivos, efectos como observadores**.

---

### 9.3 Las dos pilas paralelas

Existen dos pilas globales que corren en paralelo durante el render:

```
Durante runWithOwner(Component, props):

  effectStack:  [... efectos de componentes padre ...]
  ownerStack:   [... owners de componentes padre ..., ownerActual]

  → fn(props) ejecuta
  → dentro de fn, si hay un effect():
      effectStack: [..., ownerActual, newEffect]
      ownerStack:  [..., ownerActual]
  → efecto termina:
      effectStack: [..., ownerActual]
  → fn termina:
      ownerStack:  [...] (ownerActual se pops)
```

**Por qué son pilas separadas y no una sola:**

Los efectos y los owners son conceptos distintos:

- Los **efectos** se crean para cada `effect()` call — dentro de un componente puede haber múltiples efectos.
- Los **owners** se crean para cada componente — un componente es un owner, sin importar cuántos efectos tenga.

Separar las pilas permite que `onMount` se asocie al componente correcto aunque se llame desde dentro de un efecto, y que las suscripciones de reactividad funcionen independientemente del lifecycle.

---

### 9.4 Diagrama de dependencias entre módulos

```
src/index.ts
  ↳ reactivity/signal.ts
      ↳ reactivity/effect.ts          (getCurrentEffect)
  ↳ reactivity/effect.ts
  ↳ reactivity/computed.ts
      ↳ reactivity/signal.ts
      ↳ reactivity/effect.ts
  ↳ dom/h.ts
      ↳ reactivity/effect.ts          (effect)
      ↳ component/lifecycle.ts        (runWithOwner)
  ↳ dom/render.ts
      ↳ component/lifecycle.ts        (runWithOwner)
  ↳ dom/helpers.ts
      ↳ reactivity/effect.ts          (effect)
      ↳ component/lifecycle.ts        (runWithOwner, disposeOwner)
  ↳ dom/transitions.ts
      (sin dependencias propias del framework)
  ↳ component/lifecycle.ts
      (sin dependencias propias del framework)
  ↳ component/context.ts
      (sin dependencias propias del framework)
  ↳ router/router.ts
      ↳ reactivity/signal.ts          (signal, batch)
      ↳ dom/transitions.ts            (withViewTransition)
  ↳ router/components.tsx
      ↳ reactivity/effect.ts          (effect)
      ↳ component/lifecycle.ts        (runWithOwner, disposeOwner)
      ↳ router/router.ts              (useRouter)
  ↳ store/store.ts
      ↳ reactivity/signal.ts          (signal)
      ↳ reactivity/computed.ts        (computed)
```

**Observación clave:** `reactivity/` y `component/lifecycle.ts` son las capas base. **No importan nada del framework**. Todas las demás capas importan de ellas, creando una jerarquía limpia sin ciclos.

La única excepción potencialmente circular es `index.ts → router/components.tsx → (jsxInject) axon/jsx`. Por eso se creó `src/jsx.ts` como entry point separado que solo exporta `h` y `Fragment`, rompiendo el ciclo.

---

## 10. El build system y la solución al problema circular

**Archivo:** [`examples/app/vite.config.ts`](examples/app/vite.config.ts)

```ts
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  root: '.',
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'axon/jsx'`
  },
  resolve: {
    alias: {
      'axon/jsx': fileURLToPath(new URL('../../src/jsx.ts', import.meta.url)),
      axon: fileURLToPath(new URL('../../src/index.ts', import.meta.url))
    }
  }
})
```

**Puntos clave del build:**

- **TypeScript** — Todo el código fuente es `.ts`/`.tsx`. El `tsconfig.json` usa `"jsx": "preserve"` para que TypeScript no toque el JSX (lo deja para esbuild) pero sí valide los tipos vía el namespace `JSX` declarado en `src/dom/h.ts`. `"noEmit": true` porque Vite es quien emite, no `tsc`.

- **`jsxInject`** — esbuild inyecta automáticamente `import { h, Fragment } from 'axon/jsx'` en cada archivo `.tsx`. Esto evita tener que escribir ese import manualmente en cada componente.

- **Tailwind CSS v4** — El plugin `@tailwindcss/vite` procesa los archivos CSS que usan `@import "tailwindcss"`. Escanea todos los archivos `.tsx` en busca de class names usados y genera solo el CSS necesario.

- **`vite-env.d.ts`** — Archivo `/// <reference types="vite/client" />` en `examples/app/` que le dice a TypeScript cómo tipear los imports de `.css` (importados como side effects en los componentes).

### El problema de importación circular

`src/index.ts` re-exporta desde `router/components.tsx`. Si `jsxInject` inyectara `import { h, Fragment } from 'axon'` en `components.tsx`, se crearía este ciclo:

```
index.ts
  → (exporta desde) router/components.tsx
    → (jsxInject) import { h, Fragment } from 'axon'
      → (alias) index.ts  ← CICLO
```

ESM puede manejar ciclos en algunos casos, pero esbuild (el bundler de Vite) lo rechaza como error en la fase de escaneo de dependencias.

### La solución: `src/jsx.ts`

```ts
// src/jsx.ts — entry point solo para JSX runtime
export { h, Fragment } from './dom/h.ts'
```

Este archivo existe únicamente para romper el ciclo. `axon/jsx` apunta a `jsx.ts`, que importa directamente de `dom/h.ts`. No importa nada de `index.ts`, por lo que no puede haber ciclo.

```
index.ts
  → router/components.tsx
    → (jsxInject) import { h, Fragment } from 'axon/jsx'
      → (alias) src/jsx.ts
        → src/dom/h.ts  ← no regresa a index.ts ✓
```

---

## 11. Traza de ejecución completa: de createApp() al DOM

Siguiendo `createApp(App).mount('#app')` en el ejemplo:

```
1. createApp(App) → devuelve { mount(selector) }

2. .mount('#app')
   → container = document.querySelector('#app')
   → mount(App, container)

3. mount(App, container)
   → container.innerHTML = ''
   → nodes = runWithOwner(App, {})

4. runWithOwner(App, {})
   → owner_app = { _onMount: [], _onCleanup: [], _children: [] }
   → ownerStack.push(owner_app)       ← owner_app es el owner actual
   → result = App({})                 ← ejecuta la función del componente

5. App({}) → JSX → h() calls
   → h('div', null, h(Nav, ...), h('main', null, h(RouterView)))
   → h('div', ...) crea <div>
   → h(Nav, ...) → runWithOwner(Nav, ...)
       → owner_nav = {...}
       → owner_app._children.push(owner_nav)
       → Nav({}) ejecuta → crea <nav>
       → ownerStack.pop()
       → queueMicrotask(Nav.onMount)
   → h('main', ...) crea <main>
   → h(RouterView, ...) → runWithOwner(RouterView, ...)
       → owner_rv = {...}
       → owner_app._children.push(owner_rv)
       → RouterView({}) ejecuta:
           → router = useRouter()  ← accede al singleton _router
           → crea comment markers (start, end)
           → effect(() => { ... router.pathname() ... })
               → effectStack.push(run_rv)
               → fn(): router.pathname() → signal read → SUSCRIPCIÓN al pathname signal
               → ... match ruta → runWithOwner(Home, {...})
                   → owner_home = {...}
                   → owner_rv._children.push(owner_home)  ← árbol de owners
                   → Home({}) ejecuta:
                       → const [count, setCount] = signal(0)
                       → const double = computed(...)
                           → signal interno + effect ← otro suscriptor
                       → return JSX → h() calls → DOM nodes
                   → ownerStack.pop()
                   → queueMicrotask(Home.onMount)
               → los nodos de Home se insertan entre markers de RouterView
               → effectStack.pop()
           → queueMicrotask: propagar onMount de RouterView
       → ownerStack.pop()  ← RouterView owner termina
       → devuelve fragment (con markers)
   → resultado: <div> con <nav>, <main>

6. ownerStack.pop()  ← App owner termina
   → queueMicrotask(App.onMount)

7. container.appendChild(nodes)  ← todo el árbol DOM va al documento

8. [Microtask queue se ejecuta]
   → App.onMount()     ← si existe
   → Nav.onMount()     ← si existe
   → RouterView.onMount() ← si existe
   → Home.onMount()    ← si existe (eg: console.log('[axon] TodoPage mounted'))
   → Context cleanup (si hay Providers)
```

Ahora el DOM está en pantalla. Cuando el usuario hace click en `<Link href="/todos">`:

```
9. Link.click handler
   → e.preventDefault()
   → router.navigate('/todos')
       → history.pushState(null, '', '/todos')
       → syncLocation()
           → batch(() => {
               setPathname('/todos')   ← signal write
               setSearch('')           ← signal write
               setParams({})           ← signal write
             })
           → batch termina → flushEffects()
           → run_rv se ejecuta (estaba suscrito a pathname)

10. run_rv (efecto de RouterView) ejecuta:
    → const path = router.pathname() → '/todos' → renueva suscripción
    → disposeOwner(owner_home)
        → Home.onCleanup() ejecuta (eg: console.log('[axon] TodoPage unmounted'))
    → limpia nodos de Home del DOM
    → match '/todos' → TodoPage
    → runWithOwner(TodoPage, {...})
        → owner_todo = {...}
        → owner_rv._children.push(owner_todo)
        → TodoPage({}) ejecuta → crea su DOM
        → queueMicrotask(TodoPage.onMount)
    → inserta DOM de TodoPage entre markers

11. [Microtask]
    → TodoPage.onMount() → console.log('[axon] TodoPage mounted')
```

Y los Links actualizan su clase activa porque también estaban suscritos a `router.pathname()`.

---

> Este documento describe el estado de axon.js v0.1.0.
> Código fuente en [`src/`](src/).
