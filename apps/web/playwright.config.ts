import { config as loadDotenv } from 'dotenv';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertIsolatedTestDatabase } from '../api/src/lib/test-database-safety.ts';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..', '..');
loadDotenv({ path: path.resolve(currentDirectory, '..', 'api', '.env') });
const testDatabase = assertIsolatedTestDatabase();
if (!process.env.E2E_STAFF_EMAIL || !process.env.E2E_STAFF_PASSWORD) {
  throw new Error('Set E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD for the isolated E2E staff account.');
}

const testEnvironment = {
  ...process.env,
  DATABASE_URL: testDatabase.databaseUrl,
  DIRECT_URL: testDatabase.directUrl,
  NODE_ENV: 'test',
  CLIENT_URL: 'http://127.0.0.1:5173',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev --workspace @monoprix/api',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:4000/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...testEnvironment, PORT: '4000' },
    },
    {
      command: 'npm run dev --workspace @monoprix/web -- --host 127.0.0.1 --port 5173',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: testEnvironment,
    },
  ],
});
