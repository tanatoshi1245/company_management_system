import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // React 本体は別チャンクにして、画面側の変更でキャッシュが無駄にならないようにする
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
});
