import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2022',
    // No inline scripts or data: modules; everything is a first-party file (CSP: script-src 'self').
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
    // `pnpm dev` runs the Worker on 8787; proxy its routes so the SPA can use relative URLs.
    proxy: {
      '/api': 'http://localhost:8787',
      '/.well-known': 'http://localhost:8787',
    },
  },
});
