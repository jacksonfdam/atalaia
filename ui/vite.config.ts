import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BFF = process.env.BFF_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the client is served by Vite and the BFF runs alongside
    // it, so cookies and the API key stay on the same origin from the
    // browser's point of view.
    proxy: {
      '/bff': { target: BFF, changeOrigin: true },
      '/auth': { target: BFF, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
