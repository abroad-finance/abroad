/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import type { PluginOption, UserConfig } from 'vite'
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

type VitestEnabledConfig = UserConfig & { test?: import('vitest/config').UserConfig['test'] }

const plugins: PluginOption[] = [
  react({ include: '**/*.tsx' }),
  tailwindcss(),
]

const readEnv = (key: string): string | undefined => {
  const raw = process.env[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

const resolveReleaseName = (): string | undefined => (
  readEnv('SENTRY_RELEASE')
  ?? readEnv('COMMIT_SHA')
  ?? readEnv('GITHUB_SHA')
  ?? readEnv('VERCEL_GIT_COMMIT_SHA')
  ?? readEnv('SOURCE_VERSION')
)

const sentryAuthToken = readEnv('SENTRY_AUTH_TOKEN')
const sentryOrg = readEnv('SENTRY_ORG')
const sentryProject = readEnv('SENTRY_PROJECT')
const sentryRelease = resolveReleaseName()
const enableSentrySourcemaps = Boolean(sentryAuthToken && sentryOrg && sentryProject && sentryRelease)

if (enableSentrySourcemaps && sentryAuthToken && sentryOrg && sentryProject && sentryRelease) {
  plugins.push(
    ...sentryVitePlugin({
      authToken: sentryAuthToken,
      org: sentryOrg,
      project: sentryProject,
      release: { name: sentryRelease },
      sourcemaps: {
        assets: ['./dist/assets/**'],
        filesToDeleteAfterUpload: ['./dist/assets/**/*.map'],
      },
      telemetry: false,
    }),
  )
}

const config: VitestEnabledConfig = {
  root: __dirname,
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
          solana: ['@solana/web3.js', '@solana/spl-token'],
          stellar: ['@stellar/stellar-sdk', '@creit.tech/stellar-wallets-kit'],
          web3: ['ethers'],
        },
      },
    },
    sourcemap: enableSentrySourcemaps ? 'hidden' : false,
  },
  define: {
    'global': 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/': path.resolve(__dirname, 'src'),
    },
  },
  plugins,
  server: {
    allowedHosts: true,
    watch: {
      usePolling: true,
    },
  },
  test: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/': path.resolve(__dirname, 'src'),
    },
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
    setupFiles: ['./src/test/setupTests.ts'],
  },
}

export default defineConfig(config)
