module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
  ],
  coveragePathIgnorePatterns: [
    'src/routes.ts',
    'src/.*\\.d\\.ts$',
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup/jest.setup.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.ts?(x)'],
  transform: {
    '^.+\\.ts?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
}
