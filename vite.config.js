import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          if (
            id.includes('src/components/ui.jsx') ||
            id.includes('src/constants/colors.js') ||
            id.includes('src/constants/plans.js') ||
            id.includes('src/constants/data.js')
          ) {
            return 'ui-components';
          }
          if (id.includes('src/components/auth.jsx')) {
            return 'auth';
          }
          if (id.includes('src/components/backoffice.jsx')) {
            return 'backoffice';
          }
          if (id.includes('src/components/payment.jsx')) {
            return 'payment';
          }
          if (id.includes('src/components/presta-screens.jsx')) {
            return 'presta';
          }
          if (id.includes('src/components/client-screens.jsx')) {
            return 'client';
          }
        }
      }
    }
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
})
