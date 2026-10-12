// @ts-check
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/dist/',
    '**/coverage/',
    '**/next-env.d.ts',
    'prisma/migrations/',
    'apps/api/src/generated/',
  ]),

  // Base rules for every file.
  js.configs.recommended,

  // TypeScript: strict rules that use type information (catches e.g. a forgotten
  // `await` on a transaction call). Each file is type-checked with its nearest tsconfig.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Next.js rules apply to the web app only.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [nextVitals],
    settings: { next: { rootDir: 'apps/web/' } },
  },

  // Plain JS config files (like this one) run in Node.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  // Project-wide hard rules from CLAUDE.md.
  {
    rules: {
      // Use the pino logger.
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use crypto.randomInt (PNRs must be unguessable).',
        },
        {
          property: '$queryRawUnsafe',
          message: 'Use the $queryRaw tagged template (parameterised).',
        },
        {
          property: '$executeRawUnsafe',
          message: 'Use the $executeRaw tagged template (parameterised).',
        },
      ],
    },
  },

  // Must be last: turns off rules that would fight with Prettier's formatting.
  prettier,
]);
