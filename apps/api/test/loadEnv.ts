// Loads the repo-root .env before any test module imports src/db.ts.
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
