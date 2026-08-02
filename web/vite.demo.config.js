import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Demo build: one classic script so the preview works from a file:// path. */
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': '"1"' },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    target: 'es2018',
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } },
  },
});
