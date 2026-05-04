import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build outputs to ./dist; hub serves these at the `/dashboard` URL prefix
// (DEC-025), so all asset URLs need the prefix baked in via `base`.
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Dev convenience: proxy hub APIs so the dashboard can run against a
    // running hub at localhost:3000 without CORS hassle.
    proxy: {
      '/status': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
      '/readyz': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/metrics': 'http://localhost:3000',
    },
  },
});
