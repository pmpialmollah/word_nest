import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'home.html'),
        index: resolve(__dirname, 'index.html'),
        notes: resolve(__dirname, 'notes.html'),
        settings: resolve(__dirname, 'settings.html')
      }
    }
  }
});
