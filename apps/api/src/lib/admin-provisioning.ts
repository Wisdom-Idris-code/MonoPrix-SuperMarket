import type { PrismaClient } from '@prisma/client';

export const OWNER_EMAIL = 'idrissakargbo158@gmail.com';

export type OwnerProvisioningResult =
  | { status: 'not-found' }
  | { status: 'already-admin' }
  | { status: 'promoted'; userId: string };

export async function provisionOwnerAdmin(prisma: PrismaClient, apply: boolean): Promise<OwnerProvisioningResult> {
  const account = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, role: true },
  });

  if (!account) return { status: 'not-found' };
  if (account.email !== OWNER_EMAIL) throw new Error('The matched account email did not exactly match the configured owner email.');
  if (account.role === 'ADMIN') return { status: 'already-admin' };
  if (account.role !== 'CUSTOMER') {
    throw new Error(`Refusing to promote owner account from unexpected role "${account.role}".`);
  }
  if (!apply) return { status: 'promoted', userId: account.id };

  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.user.updateMany({
      where: { id: account.id, email: OWNER_EMAIL, role: 'CUSTOMER' },
      data: { role: 'ADMIN' },
    });
    if (updated.count !== 1) {
      throw new Error('The owner account changed during provisioning; no audit record or role change was committed.');
    }

    await transaction.auditLog.create({
      data: {
        userId: null,
        action: 'OWNER_ADMIN_PROMOTED',
        entity: 'User',
        details: `Promoted user ${account.id} (${OWNER_EMAIL}) from CUSTOMER to ADMIN via the server-side provisioning script.`,
      },
    });
  });

  const verified = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, role: true },
  });
  if (!verified || verified.id !== account.id || verified.email !== OWNER_EMAIL || verified.role !== 'ADMIN') {
    throw new Error('Provisioning completed, but the owner account role could not be verified as ADMIN.');
  }

  return { status: 'promoted', userId: verified.id };
}
