import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({ include: "**/*.tsx" }),
    tailwindcss(),
  ],
  define: {
    'global': 'globalThis',
    'process.env': {},
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          icons: ['lucide-react'],
          lottie: ['lottie-web', '@lordicon/react'],
          stellar: ['@stellar/stellar-sdk', '@creit.tech/stellar-wallets-kit'],
          qr: ['@yudiel/react-qr-scanner'],
          headless: ['@headlessui/react'],
        }
      }
    },
    chunkSizeWarningLimit: 1200,
  },
  server: {
    watch: {
      usePolling: true,
    }
  },
})
