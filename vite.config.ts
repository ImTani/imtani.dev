import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        // Two pages. index.html is the public holding page and is plain HTML
        // with no script at all; harness.html carries the engine and is
        // noindex. Keeping them separate means the placeholder ships nothing
        // it does not need, and the harness stays reachable without being what
        // the domain serves.
        index: resolve(here, 'index.html'),
        harness: resolve(here, 'harness.html'),
      },
    },
    // The engine is small and entirely interdependent; splitting it costs a
    // round trip and saves nothing.
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: false },
});
