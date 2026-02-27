import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    jsx: 'src/jsx.ts' // entry separado para evitar el ciclo circular
  },
  format: ['esm'],
  dts: true, // genera los .d.ts
  clean: true, // limpia dist/ antes de cada build
  target: 'es2020'
})
