import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertIsolatedTestDatabase } from '../src/lib/test-database-safety.js';

const action = process.argv[2];
if (!['migrate', 'integration', 'e2e'].includes(action ?? '')) {
  throw new Error('Usage: test-database-runner.ts migrate|integration|e2e');
}

const target = assertIsolatedTestDatabase();
if (action === 'migrate') {
  if (process.env.CONFIRM_TEST_MIGRATION !== 'true') {
    throw new Error('Set CONFIRM_TEST_MIGRATION=true only after reviewing the isolated test target and additive migrations.');
  }
  const migrationRoot = resolve('prisma/migrations');
  for (const directory of readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const sql = readFileSync(resolve(migrationRoot, directory.name, 'migration.sql'), 'utf8');
    if (/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE[\s\S]{0,100}\bDROP\b)\b/i.test(sql)) {
      throw new Error(`Refusing test migration: ${directory.name} contains a destructive SQL operation.`);
    }
  }
}
const childEnvironment = {
  ...process.env,
  DATABASE_URL: target.databaseUrl,
  DIRECT_URL: target.directUrl,
  NODE_ENV: 'test',
};

if (action !== 'migrate') {
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${target.schema}
    `;
    const tableNames = new Set(tables.map((table) => table.table_name));
    const required = ['_prisma_migrations', 'User', 'Category', 'Product', 'Cart', 'CartItem', 'Order', 'InventoryMovement'];
    const missing = required.filter((name) => !tableNames.has(name));
    if (missing.length) {
      throw new Error(`Test schema is not migrated; missing: ${missing.join(', ')}. Run the explicit test migration command after approval.`);
    }
    console.log(`Verified isolated test schema "${target.schema}" contains required tables.`);
  } finally {
    await prisma.$disconnect();
  }
}

const command = action === 'migrate'
  ? ['prisma', ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']]
  : action === 'integration'
    ? ['tsx', ['--test', 'tests/integration/database.integration.test.ts']]
    : ['playwright', ['test', '--config', '../web/playwright.config.ts']];

const executable = process.platform === 'win32' ? `${command[0]}.cmd` : command[0]!;
const result = spawnSync(executable, command[1], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
