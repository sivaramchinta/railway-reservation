/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // @swc/jest strips TypeScript types (fast); `npm run typecheck` does the type checking.
  transform: { '^.+\\.ts$': ['@swc/jest'] },
  setupFiles: ['<rootDir>/test/loadEnv.ts'],
};
