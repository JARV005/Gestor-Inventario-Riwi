/**
 * Datos base sin los que la aplicación no arranca. `npm run seed`.
 *
 * Idempotente: correrlo dos veces no duplica nada ni pisa cambios hechos a mano
 * sobre las filas sembradas. Se apoya en las restricciones UNIQUE de
 * `sedes.nombre` y `usuarios_app.email`.
 */

import bcrypt from 'bcryptjs';
import { eq, isNotNull, sql } from 'drizzle-orm';

import { db, pool } from './cliente.js';
import { motivosRevision, sedes, usuariosApp } from './esquema.js';
import { MOTIVOS, type CodigoMotivo } from './motivos.js';

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

/** Coste de bcrypt. El mismo que usa `db/crear-usuario.ts`. */
const COSTE = 12;

/**
 * El admin inicial, desde el entorno.
 *
 * §2 dice «sin registro público; se siembran con un script». El script existía
 * (`npm run usuario`) pero pide la contraseña por stdin, así que no sirve
 * cuando la base se acaba de recrear sin un humano delante — y `npm run
 * db:reset` borra el volumen entero, usuarios incluidos. Ya dejó a alguien
 * fuera de su propia aplicación una vez.
 *
 * **Sin valor por defecto, y sin inventar nada.** Si las tres variables no
 * están, la siembra lo dice y sigue sin crear la cuenta: un admin con
 * contraseña adivinable sembrado «por comodidad» es una puerta trasera que
 * nadie recuerda haber abierto. Es el mismo criterio que `POSTGRES_PASSWORD`.
 *
 * Las tres o ninguna: media configuración es un error de quien despliega, no
 * una petición de valores por defecto para el resto.
 */
async function sembrarAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const nombre = process.env.ADMIN_NOMBRE?.trim();
  const password = process.env.ADMIN_PASSWORD;

  const puestas = [email, nombre, password].filter(Boolean).length;

  if (puestas === 0) {
    console.log(
      'Admin inicial: no se crea. Sin ADMIN_EMAIL, ADMIN_NOMBRE y ADMIN_PASSWORD\n' +
        '  no hay cuenta con la que entrar. Rellenarlas y repetir `npm run seed`,\n' +
        '  o crearla a mano con `npm run usuario -- <email> "<nombre>" admin`.',
    );
    return;
  }

  if (puestas < 3) {
    throw new Error(
      'Admin inicial: hay que poner las tres variables o ninguna. ' +
        `Faltan: ${[
          !email && 'ADMIN_EMAIL',
          !nombre && 'ADMIN_NOMBRE',
          !password && 'ADMIN_PASSWORD',
        ]
          .filter(Boolean)
          .join(', ')}.`,
    );
  }

  // El mismo mínimo que `crear-usuario.ts`. Si diverge, una de las dos vías
  // acepta lo que la otra rechaza.
  if (password!.length < 12) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }
  if (email === USUARIO_SISTEMA.email) {
    throw new Error(
      `ADMIN_EMAIL no puede ser ${USUARIO_SISTEMA.email}: esa cuenta es del importador ` +
        'y existe precisamente para no poder iniciar sesión (D4).',
    );
  }

  const hash = await bcrypt.hash(password!, COSTE);

  // `onConflictDoNothing` y no `DoUpdate`: si la cuenta ya existe, la
  // contraseña que valga es la que tenga puesta su dueño, no la que quedó en
  // un `.env` de hace meses. Sembrar dos veces no debe revertir un cambio de
  // contraseña ni reactivar una cuenta desactivada a propósito.
  const [creado] = await db
    .insert(usuariosApp)
    .values({ email: email!, nombre: nombre!, rol: 'admin', activo: true, password_hash: hash })
    .onConflictDoNothing({ target: usuariosApp.email })
    .returning({ email: usuariosApp.email });

  console.log(
    creado
      ? `Admin inicial creado: ${creado.email}`
      : `Admin inicial: ${email} ya existía, no se toca (ni su contraseña ni su estado).`,
  );
}

async function main() {
  // El catálogo de motivos se siembra desde `db/motivos.ts` y no desde una
  // migración: añadir un código debe costar una línea y `npm run seed`, no una
  // migración versionada. Ese fue el argumento para hacerlo tabla y no CHECK.
  //
  // `onConflictDoUpdate` y no `DoNothing`: si se corrige la redacción de una
  // descripción, la corrida siguiente la propaga. El código es la identidad;
  // el texto, no.
  const motivos = (Object.keys(MOTIVOS) as CodigoMotivo[]).map((codigo) => ({
    codigo,
    descripcion: MOTIVOS[codigo].descripcion,
  }));
  await db
    .insert(motivosRevision)
    .values(motivos)
    .onConflictDoUpdate({
      target: motivosRevision.codigo,
      set: { descripcion: sql`excluded.descripcion` },
    });
  console.log(`Motivos de revisión: ${motivos.length} códigos al día.`);

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
      tiene_password: isNotNull(usuariosApp.password_hash),
    })
    .from(usuariosApp)
    .where(eq(usuariosApp.email, USUARIO_SISTEMA.email));

  if (!sistema || sistema.activo || sistema.tiene_password) {
    throw new Error(
      `El usuario ${USUARIO_SISTEMA.email} debe existir con activo=false y ` +
        `password_hash NULL. Estado actual: ${JSON.stringify(sistema ?? null)}`,
    );
  }

  // Al final: si algo de arriba falla, no se crea una cuenta contra una base a
  // medio sembrar.
  await sembrarAdmin();
}

main()
  .catch((error) => {
    console.error('La siembra falló.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
