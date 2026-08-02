import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    // The engine is small and entirely interdependent; splitting it costs a
    // round trip and saves nothing.
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: false },
});
