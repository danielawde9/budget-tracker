import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      // zod 4.6.5 places two /*#__PURE__*/ comments where Rollup cannot use
      // them; Rollup drops them harmlessly. Only that exact notice, only for
      // zod's own files, is silenced; every other warning still prints.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && /node_modules\/(\.pnpm\/)?zod@?/.test(warning.id ?? '')) return;
        warn(warning);
      },
      output: {
        // Vendor code changes rarely: separate chunks cache well and keep
        // every chunk under the 500 kB warning without raising the limit.
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          zod: ['zod'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
