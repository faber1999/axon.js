# axon.js

A fine-grained reactive frontend framework built from scratch.
JSX syntax · Signals reactivity · Router · Store · No Virtual DOM · Zero dependencies.

```tsx
import { signal, createApp } from 'axon.js'

function Counter() {
  const [count, setCount] = signal(0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>+1</button>
    </div>
  )
}

createApp(Counter).mount('#app')
```

Components run **once**. Only the exact DOM nodes that depend on a signal update — no diffing, no re-renders.

---

## Installation

```bash
npm install axon.js
```

### Vite setup

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'axon.js/jsx'`
  }
})
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "strict": true
  }
}
```

That's it. No plugins, no Babel, no extra config.

---

## Core API

### Reactivity

```ts
import { signal, effect, computed, batch, untrack } from 'axon.js'

// signal — reactive value
const [count, setCount] = signal(0)
count() // read
setCount(1) // write
setCount((c) => c + 1) // update with function

// effect — runs immediately and re-runs when dependencies change
effect(() => {
  console.log('count is', count())
})

// computed — derived reactive value
const double = computed(() => count() * 2)
double() // 0, 2, 4...

// batch — group multiple updates into one notification
batch(() => {
  setFirstName('John')
  setLastName('Doe')
})

// untrack — read a signal without subscribing
effect(() => {
  const a = count() // subscribes
  const b = untrack(() => x()) // does NOT subscribe
})
```

### JSX & Components

```tsx
import { onMount, onCleanup, createApp } from 'axon.js'

function Timer() {
  const [seconds, setSeconds] = signal(0)

  onMount(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    onCleanup(() => clearInterval(id))
  })

  return <p>Elapsed: {seconds}s</p>
}

createApp(Timer).mount('#app')
```

### Control flow

```tsx
import { Show, For, Dynamic, Portal } from 'axon.js'

// Conditional rendering
<Show when={isLoggedIn} fallback={<Login />}>
  <Dashboard />
</Show>

// List rendering
<For each={todos}>
  {(todo, index) => <li>{todo.text}</li>}
</For>

// Dynamic component
<Dynamic component={currentView} />

// Render outside the tree (e.g. modals)
<Portal mount={document.body}>
  <Modal />
</Portal>
```

### Router

```tsx
import { createRouter, RouterView, Link, useRouter, useParams } from 'axon.js'

createRouter(
  [
    { path: '/', component: Home },
    { path: '/about', component: About },

    // Route groups — shared layout and/or guard
    {
      layout: DashboardLayout,
      guard: () => isLoggedIn() || '/login',
      fallbackPath: '/login',
      children: [
        { path: '/dashboard', component: Dashboard },
        { path: '/settings', component: Settings }
      ]
    },

    // Catch-all 404
    { path: '*', component: NotFound }
  ],
  { viewTransitions: true }
) // optional animated transitions

function App() {
  return (
    <div>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/about" activeClass="active">
          About
        </Link>
      </nav>
      <main>
        <RouterView />
      </main>
    </div>
  )
}
```

**Guard return values:**

| Returns   | Behavior                                                  |
| --------- | --------------------------------------------------------- |
| `true`    | Allow access, render the component                        |
| `false`   | Navigate back to the previous route, or to `fallbackPath` |
| `"/path"` | Redirect to that path                                     |

**Router hooks:**

```ts
const router = useRouter() // full router instance
const params = useParams() // { id: '42' }
const navigate = useNavigate() // navigate('/path')
```

### Store

```ts
import { createStore, select } from 'axon.js'

interface AppState {
  theme: 'dark' | 'light'
  count: number
}

const [store, setStore] = createStore<AppState>({
  theme: 'dark',
  count: 0
})

store.theme // read (reactive)
setStore('theme', 'light') // set one property
setStore('count', (c) => c + 1) // update with function
setStore({ theme: 'light', count: 5 }) // merge update

// Derived value from store
const label = select(store, (s) => `Theme: ${s.theme}`)
label() // reactive getter
```

Multiple independent stores are supported — just call `createStore` multiple times.

### Context

```tsx
import { createContext } from 'axon.js'

const ThemeContext = createContext<'dark' | 'light'>('dark')

function App() {
  return (
    <ThemeContext.Provider value="light">
      <Page />
    </ThemeContext.Provider>
  )
}

function Page() {
  const theme = ThemeContext.use()
  return <div class={theme}>...</div>
}
```

### View Transitions

Pass `{ viewTransitions: true }` to `createRouter` and name your content area:

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

The framework handles the rest automatically. Falls back gracefully in unsupported browsers.

---

## How it works

axon.js uses **fine-grained reactivity**: a global effect stack tracks which signals are read during execution, creating subscriptions automatically. No compiler magic — pure runtime JavaScript.

- Components execute **once** to build their initial DOM.
- Only `effect()` callbacks re-execute when signals change.
- DOM updates are surgical — only the exact node that depends on a signal is touched.

For a deep dive into the internals, see [INTERNALS.md](INTERNALS.md).

---

## License

MIT

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/faber1999">faber1999</a></sub>
</div>
