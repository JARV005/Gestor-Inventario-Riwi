/**
 * Crea o actualiza un usuario de la aplicación.
 * `npm run usuario -- <email> <nombre> <admin|tecnico>`
 *
 * Existe porque §2 dice «sin registro público; se siembran con un script», y
 * porque hay un problema de arranque: crear usuarios es una operación de admin,
 * y hasta que exista el primer admin no hay nadie que pueda hacerla. El único
 * usuario que siembra `npm run seed` es `sistema@bbl.local`, que no puede
 * iniciar sesión por diseño (D4).
 *
 * La contraseña se pide por stdin y no se pasa como argumento: los argumentos
 * quedan en el historial del shell y en la lista de procesos.
 */

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db, pool } from './cliente.js';
import { usuariosApp } from './esquema.js';

const COSTE = 12;

async function main() {
  const [email, nombre, rol] = process.argv.slice(2);
  if (!email || !nombre || (rol !== 'admin' && rol !== 'tecnico')) {
    throw new Error('Uso: npm run usuario -- <email> "<nombre>" <admin|tecnico>');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question(`Contraseña para ${email}: `);
  rl.close();

  if (password.length < 12) {
    throw new Error('La contraseña debe tener al menos 12 caracteres.');
  }

  const password_hash = await bcrypt.hash(password, COSTE);

  const [fila] = await db
    .insert(usuariosApp)
    .values({ email, nombre, rol, activo: true, password_hash })
    .onConflictDoUpdate({
      target: usuariosApp.email,
      // Cambiar la contraseña aquí invalida las sesiones abiertas de esa
      // persona: el guardián compara una huella del hash en cada petición.
      set: { nombre, rol, activo: true, password_hash },
    })
    .returning({ id: usuariosApp.id, email: usuariosApp.email, rol: usuariosApp.rol });

  console.log(`Usuario listo: ${fila.email} (${fila.rol})`);

  const [sistema] = await db
    .select({ activo: usuariosApp.activo })
    .from(usuariosApp)
    .where(eq(usuariosApp.email, 'sistema@bbl.local'));
  if (sistema?.activo) {
    throw new Error('sistema@bbl.local ha quedado activo. Revisar: no debe poder iniciar sesión.');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
