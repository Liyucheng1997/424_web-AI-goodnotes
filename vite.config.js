import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'], include: ['opencc-js/t2cn'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
});
