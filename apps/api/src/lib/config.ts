import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '@pagebroadcast/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(__dirname, '../../.env'),
];
for (const p of candidates) {
  dotenv.config({ path: p });
}

export const config = loadConfig(process.env);
