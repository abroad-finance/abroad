import type { PluginOption, UserConfig } from 'vite'

import { sentryVitePlugin } from '@sentry/vite-plugin'
/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Helper to create (stable within one build) random hashes for each file.
const hashCache = new Map<string, string>()
type VitestEnabledConfig = UserConfig & { test?: import('vitest/config').UserConfig['test'] }

function randomHash(key: string): string {
  if (!hashCache.has(key)) {
    hashCache.set(key, crypto.randomBytes(8).toString('hex')) // 16 hex chars
  }
  return hashCache.get(key) as string
}

const plugins: PluginOption[] = [
  react({ include: '**/*.tsx' }),
  tailwindcss(),
  versionFilePlugin(),
]

const buildVersion = randomHash('__build_version__')

function versionFilePlugin(): PluginOption {
  return {
    apply: 'build',
    closeBundle() {
      const outPath = path.resolve(__dirname, 'dist', 'version.json')
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, JSON.stringify({ version: buildVersion }))
    },
    name: 'version-file',
  }
}

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
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          const originalName = assetInfo.name || 'asset'
          const ext = path.extname(originalName)
          const base = path.basename(originalName, ext)
          return `assets/${base}.${randomHash(originalName)}${ext}`
        },
        chunkFileNames: (chunk) => {
          // Use sorted module ids as key to stay stable within this build run
          const key = [...chunk.moduleIds].sort().join('|') || chunk.name
          return `assets/${chunk.name}.${randomHash(key)}.js`
        },
        // Custom file name patterns with random (non-content) hashes
        entryFileNames: (chunk) => {
          const key = chunk.facadeModuleId || chunk.name
          return `assets/${chunk.name}.${randomHash(key)}.js`
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
    '__ABROAD_UI_VERSION__': JSON.stringify(sentryRelease ?? 'development'),
    'global': 'globalThis',
    'process.env': {},
  },
  plugins,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/': path.resolve(__dirname, 'src'),
    },
  },
  root: __dirname,
  server: {
    allowedHosts: process.env.VITE_ALLOW_ALL_HOSTS === 'true' ? true : [],
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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/*.spec.{ts,tsx}',
    ],
    globals: true,
    restoreMocks: true,
    setupFiles: ['./src/test/setupTests.ts'],
  },
}

export default defineConfig(config)
