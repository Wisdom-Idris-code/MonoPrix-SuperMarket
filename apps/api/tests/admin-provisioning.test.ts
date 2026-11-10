import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { OWNER_EMAIL, provisionOwnerAdmin } from '../src/lib/admin-provisioning.js';

test('owner provisioning promotes only the exact active CUSTOMER and records an audit event', async () => {
  const account = { id: 'owner-account', email: OWNER_EMAIL, role: 'CUSTOMER' };
  const auditRecords: unknown[] = [];
  let updateArguments: unknown;
  let role = 'CUSTOMER';
  const fakePrisma = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        assert.equal(where.email, OWNER_EMAIL);
        return { ...account, role };
      },
    },
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      user: {
        updateMany: async (arguments_: unknown) => {
          updateArguments = arguments_;
          role = 'ADMIN';
          return { count: 1 };
        },
      },
      auditLog: {
        create: async (arguments_: unknown) => { auditRecords.push(arguments_); },
      },
    }),
  } as unknown as PrismaClient;

  const result = await provisionOwnerAdmin(fakePrisma, true);

  assert.deepEqual(result, { status: 'promoted', userId: account.id });
  assert.deepEqual(updateArguments, {
    where: { id: account.id, email: OWNER_EMAIL, role: 'CUSTOMER' },
    data: { role: 'ADMIN' },
  });
  assert.deepEqual(auditRecords, [{
    data: {
      userId: null,
      action: 'OWNER_ADMIN_PROMOTED',
      entity: 'User',
      details: `Promoted user ${account.id} (${OWNER_EMAIL}) from CUSTOMER to ADMIN via the server-side provisioning script.`,
    },
  }]);
});

test('owner provisioning dry run does not write and refuses missing or unexpected-role accounts', async () => {
  let writes = 0;
  let account: { id: string; email: string; role: string } | null = {
    id: 'owner-account',
    email: OWNER_EMAIL,
    role: 'CUSTOMER',
  };
  const fakePrisma = {
    user: { findUnique: async () => account },
    $transaction: async () => { writes += 1; },
  } as unknown as PrismaClient;

  assert.deepEqual(await provisionOwnerAdmin(fakePrisma, false), { status: 'promoted', userId: 'owner-account' });
  assert.equal(writes, 0);

  account = null;
  assert.deepEqual(await provisionOwnerAdmin(fakePrisma, true), { status: 'not-found' });

  account = { id: 'owner-account', email: OWNER_EMAIL, role: 'STAFF' };
  await assert.rejects(() => provisionOwnerAdmin(fakePrisma, true), /unexpected role "STAFF"/);
  assert.equal(writes, 0);
});
