/**
 * Datos base sin los que la aplicación no arranca. `npm run seed`.
 *
 * Idempotente: correrlo dos veces no duplica nada ni pisa cambios hechos a mano
 * sobre las filas sembradas. Se apoya en las restricciones UNIQUE de
 * `sedes.nombre` y `usuarios_app.email`.
 */

import { sql } from 'drizzle-orm';

import { db, pool } from './cliente.js';
import { sedes, usuariosApp } from './esquema.js';

/** Semilla del §2. `Remoto` no es un lugar, por eso no lleva ciudad. */
const SEDES = [
  { nombre: 'Medellín', ciudad: 'Medellín' },
  { nombre: 'Barranquilla', ciudad: 'Barranquilla' },
  { nombre: 'Cartagena', ciudad: 'Cartagena' },
  { nombre: 'Bogotá', ciudad: 'Bogotá' },
  { nombre: 'Remoto', ciudad: null },
];

/**
 * Usuario de sistema de D4. Existe solo para que el importador de la etapa 2
 * tenga a quién atribuir sus movimientos: `movimientos.usuario_app_id` es NOT
 * NULL y el login no llega hasta la etapa 3.
 *
 * No es una cuenta. `activo = false` y `password_hash = NULL` son dos barreras
 * separadas, y el endpoint de login debe comprobarlas por separado — que una
 * falle no puede depender de que la otra siga puesta.
 *
 * Su efecto secundario es permanente y deliberado: todo movimiento migrado
 * desde el Excel queda distinguible para siempre de uno hecho por una persona.
 */
const USUARIO_SISTEMA = {
  email: 'sistema@bbl.local',
  nombre: 'Importación automática',
  rol: 'admin' as const,
  activo: false,
  password_hash: null,
};

async function main() {
  const sedesInsertadas = await db
    .insert(sedes)
    .values(SEDES)
    .onConflictDoNothing({ target: sedes.nombre })
    .returning({ nombre: sedes.nombre });

  const usuarioInsertado = await db
    .insert(usuariosApp)
    .values(USUARIO_SISTEMA)
    .onConflictDoNothing({ target: usuariosApp.email })
    .returning({ email: usuariosApp.email });

  console.log(
    sedesInsertadas.length
      ? `Sedes creadas: ${sedesInsertadas.map((s) => s.nombre).join(', ')}`
      : 'Sedes: ya estaban las 5.',
  );
  console.log(
    usuarioInsertado.length
      ? `Usuario de sistema creado: ${USUARIO_SISTEMA.email}`
      : 'Usuario de sistema: ya existía.',
  );

  // Comprobación, no suposición: si alguien editó la fila después de sembrarla
  // y le puso una contraseña, el importador dejaría de ser atribuible y el
  // login tendría una cuenta admin utilizable que nadie recuerda haber creado.
  const [sistema] = await db
    .select({
      activo: usuariosApp.activo,
      tiene_password: sql<boolean>`${usuariosApp.password_hash} IS NOT NULL`,
    })
    .from(usuariosApp)
    .where(sql`${usuariosApp.email} = ${USUARIO_SISTEMA.email}`);

  if (!sistema || sistema.activo || sistema.tiene_password) {
    throw new Error(
      `El usuario ${USUARIO_SISTEMA.email} debe existir con activo=false y ` +
        `password_hash NULL. Estado actual: ${JSON.stringify(sistema ?? null)}`,
    );
  }
}

main()
  .catch((error) => {
    console.error('La siembra falló.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
