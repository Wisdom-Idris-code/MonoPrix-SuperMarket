type SeedEnvironment = {
  NODE_ENV?: string;
  ALLOW_DEMO_SEED?: string;
  DEMO_SEED_PASSWORD?: string;
  DATABASE_URL?: string;
};

export function assertSafeDemoSeedTarget(environment: SeedEnvironment, arguments_: string[]) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Demo seeding is disabled when NODE_ENV=production.');
  }
  if (environment.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_DEMO_SEED=true to explicitly enable demo data creation.');
  }
  if (!arguments_.includes('--confirm-demo-seed')) {
    throw new Error('Pass --confirm-demo-seed to explicitly confirm demo data creation.');
  }
  if (!environment.DEMO_SEED_PASSWORD || environment.DEMO_SEED_PASSWORD.length < 12) {
    throw new Error('Set DEMO_SEED_PASSWORD to a unique password of at least 12 characters.');
  }
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required.');

  const databaseUrl = new URL(environment.DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(databaseUrl.hostname) || !/(?:^|[_-])(dev|test|local)(?:$|[_-])/i.test(databaseName)) {
    throw new Error('Demo seeding is restricted to a local database named for development, testing, or local use.');
  }
}
