/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // @swc/jest strips TypeScript types (fast); `npm run typecheck` does the type checking.
  transform: { '^.+\\.ts$': ['@swc/jest'] },
  setupFiles: ['<rootDir>/test/loadEnv.ts'],

  // `npm run test:coverage`: the pure domain layer must stay at 100% (IMPLEMENTATION_PLAN Phase 2).
  coverageProvider: 'v8',
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/*.test.ts'],
  coverageThreshold: {
    './src/domain/': { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
};
