import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import crypto from 'node:crypto'
import path from 'node:path'

// https://vite.dev/config/
// Helper to create (stable within one build) random hashes for each file.
const hashCache = new Map<string, string>()
function randomHash(key: string): string {
  if (!hashCache.has(key)) {
    hashCache.set(key, crypto.randomBytes(8).toString('hex')) // 16 hex chars
  }
  return hashCache.get(key) as string
}

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Custom file name patterns with random (non-content) hashes
        entryFileNames: (chunk) => {
          const key = chunk.facadeModuleId || chunk.name
          return `assets/${chunk.name}.${randomHash(key)}.js`
        },
        chunkFileNames: (chunk) => {
          // Use sorted module ids as key to stay stable within this build run
          const key = [...chunk.moduleIds].sort().join('|') || chunk.name
          return `assets/${chunk.name}.${randomHash(key)}.js`
        },
        assetFileNames: (assetInfo) => {
          const originalName = assetInfo.name || 'asset'
          const ext = path.extname(originalName)
          const base = path.basename(originalName, ext)
          return `assets/${base}.${randomHash(originalName)}${ext}`
        },
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
