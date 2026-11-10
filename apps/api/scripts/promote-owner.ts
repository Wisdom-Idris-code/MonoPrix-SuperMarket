import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { OWNER_EMAIL, provisionOwnerAdmin } from '../src/lib/admin-provisioning.js';

function parseArguments(args: string[]) {
  if (args.includes('--help')) {
    console.log(`Usage:
  npm run admin:promote-owner
  npm run admin:promote-owner -- --apply --confirm-email=${OWNER_EMAIL}

Without --apply, the script only checks the exact owner account and makes no changes.`);
    return { help: true, apply: false };
  }

  const allowedArgs = new Set(['--apply', `--confirm-email=${OWNER_EMAIL}`]);
  const unexpected = args.filter((argument) => !allowedArgs.has(argument));
  if (unexpected.length) throw new Error(`Unexpected argument(s): ${unexpected.join(', ')}.`);

  const apply = args.includes('--apply');
  const confirmation = args.find((argument) => argument.startsWith('--confirm-email='))?.slice('--confirm-email='.length);
  if (apply && confirmation !== OWNER_EMAIL) {
    throw new Error(`Applying the role change requires --confirm-email=${OWNER_EMAIL}.`);
  }
  if (!apply && confirmation !== undefined && confirmation !== OWNER_EMAIL) {
    throw new Error(`Confirmation must exactly match ${OWNER_EMAIL}.`);
  }

  return { help: false, apply };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return;

  const prisma = new PrismaClient();
  try {
    const result = await provisionOwnerAdmin(prisma, options.apply);
    if (result.status === 'not-found') {
      console.error(`No account exists for the exact owner email ${OWNER_EMAIL}. Register through the website, then run this script again.`);
      process.exitCode = 2;
      return;
    }
    if (result.status === 'already-admin') {
      console.log('The exact owner account is already ADMIN. No changes were made.');
      return;
    }
    if (!options.apply) {
      console.log(`Ready to promote the exact owner account (${result.userId}) from CUSTOMER to ADMIN. Dry run only; no changes were made.`);
      console.log(`To apply, rerun with --apply --confirm-email=${OWNER_EMAIL}.`);
      return;
    }

    console.log(`Promoted and verified the exact owner account (${result.userId}) as ADMIN. An audit log entry was recorded.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Owner admin provisioning failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
