module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
  ],
  coveragePathIgnorePatterns: [
    'src/app/http/routes.ts',
    'src/.*\\.d\\.ts$',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup/jest.setup.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/tests/**/*.ts?(x)'],
  transform: {
    '^.+\\.ts?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
}
