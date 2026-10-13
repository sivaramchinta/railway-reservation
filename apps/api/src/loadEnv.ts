// Loads the repo-root .env. Imported FIRST by server.ts, before anything reads process.env.
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
