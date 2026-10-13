import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas para poder publicar en GitHub Pages u otro hosting estático.
  base: './',
  build: {
    chunkSizeWarningLimit: 7000,
  },
});
