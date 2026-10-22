import { parseArgs } from 'node:util';

import { createDb } from '@mandate/db';
import { seedFreshCart } from '@mandate/db/catalog/seed-freshcart';

async function main() {
  const { values } = parseArgs({ options: {
    'merchant-user-id': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: pnpm run seed:freshcart --merchant-user-id <existing-user-id>');
    return;
  }
  const merchantUserId = values['merchant-user-id'];
  if (!merchantUserId || !/^[a-f\d]{24}$/i.test(merchantUserId)) {
    throw new Error('--merchant-user-id must be an existing user ID (24 hexadecimal characters)');
  }
  const { ENV } = await import('./env.server');
  const db = await createDb(ENV);
  try {
    console.log(JSON.stringify(await seedFreshCart(merchantUserId)));
  } finally {
    await db.client.close();
  }
}

main().catch((error: unknown) => {
  console.error('FreshCart seeding failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
