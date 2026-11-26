import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and must not clear its terminal output.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1440, // not 1420/1430: BRSOrganizer and BRSDispatcher, all run side by side
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
