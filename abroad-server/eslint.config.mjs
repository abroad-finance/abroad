import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'
import importNewlines from 'eslint-plugin-import-newlines'
import perfectionist from 'eslint-plugin-perfectionist'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tsconfigRootDir = path.dirname(new URL(import.meta.url).pathname)

/**
 * Machine-checks the module boundaries AGENTS.md describes, which until now were
 * documentation only.
 *
 * Two zones are enforced across every module because they are already clean.
 * The other three still have known violations, so they list the modules they
 * cover explicitly and omit the offenders, named below with what closes them.
 * A module may only ever be ADDED to these lists — if enforcement is in your
 * way, fix the import, do not remove the module.
 */
const modulesWithCleanApplicationLayer = [
  'auth', 'flows', 'kyc', 'operations', 'partners', 'payments',
  'quotes', 'realtime', 'shared', 'telemetry', 'transfero',
  'transparency', 'webhooks',
]

const modulesWithCleanTransportBoundary = [
  'auth', 'flows', 'kyc', 'operations', 'partners', 'payments', 'quotes',
  'realtime', 'shared', 'telemetry', 'transactions', 'transfero',
  'transparency', 'treasury', 'webhooks',
]

const applicationGlobs = names => names.map(name => `./src/modules/${name}/application/**/*`)

const boundaryZones = [
  {
    // Omits `transactions` and `treasury`: PartnerPixReconciliationService,
    // PartnerPixReceiptService and TreasuryReplenishService still reach for a
    // concrete adapter. Adding their ports lets both modules join this list.
    from: './src/modules/*/infrastructure/**/*',
    message: 'application may not depend on infrastructure. Declare a port in application/contracts and bind the adapter in app/container.',
    target: applicationGlobs(modulesWithCleanApplicationLayer),
  },
  {
    from: './src/modules/*/interfaces/**/*',
    message: 'infrastructure may not depend on the transport layer.',
    target: './src/modules/*/infrastructure/**/*',
  },
  {
    // Every module. No application file imports transport code.
    from: './src/modules/*/interfaces/**/*',
    message: 'application may not depend on transport contracts. Move the shared schema into application and re-export it from interfaces/http.',
    target: applicationGlobs(modulesWithCleanTransportBoundary),
  },
  {
    // Omits notifications/: webhookNotifier resolves partner webhook secrets
    // through a concrete partners service instead of a port.
    from: './src/modules/**/*',
    message: 'platform is cross-cutting and may not depend on a domain module.',
    target: [
      './src/platform/cacheLock/**/*',
      './src/platform/messaging/**/*',
      './src/platform/observability/**/*',
      './src/platform/outbox/**/*',
      './src/platform/persistence/**/*',
      './src/platform/secrets/**/*',
    ],
  },
  {
    from: ['./src/modules/**/*', './src/platform/**/*'],
    message: 'core is the innermost layer and may not depend on modules or platform.',
    target: './src/core/**/*',
  },
]

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  allConfig: js.configs.all,
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
})

export default [
  // Ignore generated and compiled outputs
  {
    ignores: [
      'dist/**',
      'dependency-graph.svg',
      'stryker-tmp/**',
    ],
  },
  importPlugin.flatConfigs.typescript,
  perfectionist.configs['recommended-natural'],
  stylistic.configs['recommended'],
  ...fixupConfigRules(
    compat.extends(
      'plugin:@typescript-eslint/recommended',
      'plugin:import/typescript',
    ),
  ),
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir,
      },
    },

    plugins: {
      '@typescript-eslint': fixupPluginRules(typescriptEslint),
      'import-newlines': importNewlines,
    },

    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'import-newlines/enforce': 'error',

      'import/no-restricted-paths': ['error', {
        basePath: tsconfigRootDir,
        zones: boundaryZones,
      }],
    },

    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  {
    // Tests deliberately reach across layers to exercise adapters directly, and
    // ambient declarations have no runtime imports to place. Neither is a zone
    // target, but the rule still tries to resolve their specifiers.
    files: ['src/tests/**/*.{ts,tsx}', 'src/types/**/*.d.ts'],
    rules: {
      'import/no-restricted-paths': 'off',
    },
  },
]
