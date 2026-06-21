import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [react()],
  css: {
    // PostCSS plugins inlined here so we don't need a postcss.config.ts file.
    // Vite evaluates these at build time; Tailwind picks up tailwind.config.ts
    // automatically (which requires `ts-node` in devDeps to load the TS config).
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
