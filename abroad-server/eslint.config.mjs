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
console.log('tsconfigRootDir', tsconfigRootDir)

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
        project: ['./tsconfig.json'],
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
    },

    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
]
