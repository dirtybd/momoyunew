import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('frontend'),
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Keep the browser Host so the backend's same-origin check also works in development.
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false } }
  },
  build: { outDir: path.resolve('dist'), emptyOutDir: true }
});
