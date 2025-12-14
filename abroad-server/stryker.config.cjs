/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  checkers: ['typescript'],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  jest: {
    configFile: 'jest.config.js',
    projectType: 'custom',
  },
  mutate: [
    'src/**/*.ts',
    '!src/app/http/routes.ts',
    '!src/**/*.d.ts',
    '!src/**/tests/**/*',
    '!src/**/?(*.)+(spec|test).ts',
  ],
  mutator: {
    name: 'typescript',
  },
  packageManager: 'npm',
  reporters: [
    'html',
    'clear-text',
    'progress',
    'json',
  ],
  tempDirName: 'stryker-tmp',
  testRunner: 'jest',
  thresholds: {
    break: 41,
    high: 80,
    low: 60,
  },
  tsconfigFile: 'tsconfig.json',
}
