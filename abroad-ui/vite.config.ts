import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          icons: ['lucide-react'],
          lottie: ['lottie-web', '@lordicon/react'],
          motion: ['framer-motion'],
          qr: ['@yudiel/react-qr-scanner'],
          react: [
            'react',
            'react-dom',
            'react-router-dom',
          ],
          stellar: ['@stellar/stellar-sdk', '@creit.tech/stellar-wallets-kit'],
        },
      },
    },
    sourcemap: false,
  },
  define: {
    'global': 'globalThis',
    'process.env': {},
  },
  plugins: [react({ include: '**/*.tsx' }), tailwindcss()],
  server: {
    watch: {
      usePolling: true,
    },
  },
})
