import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'node:path';

// import.meta.dirname rather than __dirname: Vite's native (ESM) config loader is
// becoming the default, and __dirname does not exist there.
const here = import.meta.dirname;

export default defineConfig({
  root: path.resolve(here, 'src/renderer'),
  // Loaded via file:// from the main process, so every asset URL must be relative.
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(here, 'dist/renderer'),
    emptyOutDir: true,
  },
});
