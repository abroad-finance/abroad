import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import perfectionist from 'eslint-plugin-perfectionist'
import importPlugin from 'eslint-plugin-import'
import react from 'eslint-plugin-react'
import newlineDestructuring from 'eslint-plugin-newline-destructuring';

export default tseslint.config(
  { ignores: ['dist', 'src/api/index.ts'] },

  {
    files: ['**/src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      stylistic.configs.recommended,
      perfectionist.configs['recommended-natural'],
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
      },
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx'] },
      },
      react: {
        version: 'detect',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
      react,
      '@stylistic': stylistic,
      'newline-destructuring': newlineDestructuring,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/exhaustive-deps': 'error',
      // Disallow inline styles on DOM nodes and components
      'react/forbid-dom-props': ['warn', { forbid: ['style'] }],
      'react/forbid-component-props': ['warn', { forbid: ['style'] }],

      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/shared/components',
              from: './src',
              except: ['./assets', './shared/constants']
            },
            {
              target: './src/features/**/components/**/*',
              from: './src/**/*',
              except: [
                '**/features/**/constants/**/*',
                '**/shared/**/*',
                '**/assets/**/*',
                '**/api/**/*',
                '**/types/**/*',
                '**/contexts/**/*',
              ],
            },
          ],
        },
      ],
      '@stylistic/array-element-newline': ['error', { minItems: 3 }],
      '@stylistic/array-bracket-newline': ['error', { minItems: 3 }],
      'import/no-cycle': ['warn', { maxDepth: 1 }],

      // Disallow non-null assertions ("!") to encourage safer type narrowing
      '@typescript-eslint/no-non-null-assertion': 'error',

      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      '@stylistic/object-curly-newline': ['error', {
        ObjectExpression: { minProperties: 4, multiline: true, consistent: true },
        ObjectPattern: { minProperties: 4, multiline: true, consistent: true },
        ImportDeclaration: { minProperties: 4, multiline: true, consistent: true },
        ExportDeclaration: { minProperties: 4, multiline: true, consistent: true },
      }],
      // '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: false }],
      "newline-destructuring/newline": ["error", {
        "items": 3,
        "allowAllPropertiesOnSameLine": false
      }]

    },
  },
)
