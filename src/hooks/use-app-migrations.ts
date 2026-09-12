import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { useMigrations } from '@/db/use-live-query';

/**
 * Applies pending SQLite migrations on boot. Wraps the seam's `useMigrations`
 * with the app's `db` handle and migration bundle so the root layout stays
 * free of the database module.
 */
export function useAppMigrations() {
  return useMigrations(db, migrations);
}
