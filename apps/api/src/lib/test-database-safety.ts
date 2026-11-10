type TestDatabaseEnvironment = {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  TEST_DATABASE_URL?: string;
  TEST_DIRECT_URL?: string;
};

function databaseIdentity(value: string) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Test and application database URLs must use PostgreSQL.');
  }
  const schema = url.searchParams.get('schema') ?? 'public';
  const username = decodeURIComponent(url.username);
  const projectReference = username.match(/^postgres\.([a-z0-9]+)$/i)?.[1]
    ?? url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  return {
    hostname: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.slice(1)),
    schema,
    projectReference,
  };
}

export function assertIsolatedTestDatabase(environment: TestDatabaseEnvironment = process.env) {
  const { DATABASE_URL, DIRECT_URL, TEST_DATABASE_URL, TEST_DIRECT_URL } = environment;
  if (!DATABASE_URL || !DIRECT_URL || !TEST_DATABASE_URL || !TEST_DIRECT_URL) {
    throw new Error('Set DATABASE_URL, DIRECT_URL, TEST_DATABASE_URL and TEST_DIRECT_URL before database tests.');
  }

  const production = databaseIdentity(DATABASE_URL);
  const productionDirect = databaseIdentity(DIRECT_URL);
  const test = databaseIdentity(TEST_DATABASE_URL);
  const testDirect = databaseIdentity(TEST_DIRECT_URL);
  if (test.database !== testDirect.database || test.schema !== testDirect.schema) {
    throw new Error('TEST_DATABASE_URL and TEST_DIRECT_URL must target the same database and schema.');
  }
  if (test.projectReference && testDirect.projectReference && test.projectReference !== testDirect.projectReference) {
    throw new Error('Test runtime and direct URLs point to different Supabase projects.');
  }

  const sameProject = (test.projectReference && production.projectReference)
    ? test.projectReference === production.projectReference
    : test.hostname === production.hostname && test.database === production.database;
  const sameProductionSchema = sameProject && test.schema === production.schema;
  if (sameProductionSchema) {
    throw new Error('Refusing to run tests: test URLs resolve to the production database schema.');
  }
  if (sameProject && test.schema !== 'marketplace_test') {
    throw new Error('When sharing a Supabase project, test URLs must use the isolated marketplace_test schema.');
  }
  if (test.schema === productionDirect.schema && test.database === productionDirect.database
    && testDirect.hostname === productionDirect.hostname) {
    throw new Error('Refusing to run tests against the configured production direct connection.');
  }

  return {
    databaseUrl: TEST_DATABASE_URL,
    directUrl: TEST_DIRECT_URL,
    schema: test.schema,
  };
}
