// `npm run db:seed`: idempotent reference data (logic in referenceDataRepository).
import 'dotenv/config';
import { prisma, runInTransaction } from '../apps/api/src/db';
import { seedReferenceData } from '../apps/api/src/repositories/referenceDataRepository';

runInTransaction(seedReferenceData)
  .then(async () => {
    const [seats, inventory] = await Promise.all([
      prisma.seat.count(),
      prisma.classInventory.findMany({ orderBy: { classCode: 'asc' } }),
    ]);
    const summary = inventory.map((row) => `${row.classCode}=${row.capacity}`).join(', ');
    // No logger exists yet (pino arrives in Phase 6); a CLI script writes to stdout.
    process.stdout.write(`Seed complete: ${seats} seats; capacity ${summary}\n`);
  })
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
