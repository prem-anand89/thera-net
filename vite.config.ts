import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split vendor libraries into stable, independently cacheable chunks.
        // App code changes every deploy; these rarely do — a returning user
        // (the common case for a clinic app) re-downloads only the app chunk.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
          'vendor-router': ['@tanstack/react-router'],
        },
      },
    },
  },
  server: {
    // Bind to 0.0.0.0 so port-forwarding proxies (Codespaces, containers) can reach it
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
