import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL. Copiar .env.example a .env y rellenarla.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/esquema.ts',
  out: './db/migraciones',
  dbCredentials: { url: process.env.DATABASE_URL },
  // El SQL generado se revisa a mano antes de aplicarlo (regla 7 de CLAUDE.md:
  // nunca ALTER TABLE suelto, siempre migración versionada y leída).
  strict: true,
  verbose: true,
});
