import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages / Origin Pages serve the app from /<repo-name>/, dev from /.
// Keep this in sync with the repository name: elanoide-s89/compresso-v2.
const REPO_BASE = '/compresso-v2/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Export tooling is only needed on demand — keep it out of the
        // initial bundle so the studio paints fast.
        manualChunks(id: string) {
          if (id.includes('node_modules/opentype.js') || id.includes('node_modules/jszip')) {
            return 'font-tools';
          }
          return undefined;
        },
      },
    },
  },
}));
