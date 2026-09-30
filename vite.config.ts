import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Thera.Net',
        short_name: 'Thera.Net',
        description: 'Patient Visit Ledger',
        theme_color: '#1e5054',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
          { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'apple touch icon' }
        ]
      }
    })
  ],
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
    // Node by default; component tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
