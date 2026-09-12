import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
