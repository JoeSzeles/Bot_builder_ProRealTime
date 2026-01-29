import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/downloads': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/share': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/embed': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/oembed': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/images': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
