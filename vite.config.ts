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
  server: {
    // Bind to 0.0.0.0 so port-forwarding proxies (Codespaces, containers) can reach it
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
