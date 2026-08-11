import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // field/roles.js is shared with the server and the phone and sits outside
  // this root, so the dev server has to be allowed to reach up to it.
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
