/**
 * Arnés de los tests. HTTP real contra el servidor real.
 *
 * Nada de `supertest` ni de inyectar objetos de sesión: lo que hay que
 * comprobar es la cookie y el store en Postgres. Un arnés que permita fabricar
 * una sesión prueba el arnés.
 */

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { eq, like, sql } from 'drizzle-orm';

import { cifrar } from '../db/cifrado.js';
import { db, pool } from '../db/cliente.js';
import { empleados, equipos, usuariosApp } from '../db/esquema.js';
import { crearApp } from '../server/app.js';

/** Prefijo de todo lo que los tests crean, para poder barrerlo después. */
export const PREFIJO = 'test-';

export function comprobarBaseDeTest(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.endsWith('_test')) {
    throw new Error(
      `Los tests crean y destruyen usuarios: DATABASE_URL debe apuntar a la base de test.\n` +
        `Apunta a: ${url || '(vacía)'}\n` +
        `Correr con: npm test  (que la fija desde DATABASE_URL_TEST)`,
    );
  }
}

export interface Servidor {
  url: string;
  /** Para el test que recorre el router buscando rutas sin permiso declarado. */
  app: ReturnType<typeof crearApp>;
  cerrar: () => Promise<void>;
}

export async function arrancar(): Promise<Servidor> {
  const app = crearApp();
  const servidor: Server = createServer(app);
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    app,
    cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}

export interface Respuesta {
  estado: number;
  cuerpo: unknown;
  texto: string;
  cabeceras: Headers;
}

/**
 * Cliente HTTP con tarro de cookies propio. Cada instancia es un "navegador"
 * distinto, que es lo que permite probar la sesión de otro usuario.
 */
export class Cliente {
  private cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  /** La cookie tal cual se enviaría. Los tests la manipulan a propósito. */
  get cookieCruda(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  fijarCookie(nombre: string, valor: string): void {
    this.cookies.set(nombre, valor);
  }

  olvidarCookies(): void {
    this.cookies.clear();
  }

  async pedir(
    metodo: string,
    camino: string,
    opciones: { cuerpo?: unknown; cookie?: string; cabeceras?: Record<string, string> } = {},
  ): Promise<Respuesta> {
    const cabeceras: Record<string, string> = { ...opciones.cabeceras };
    const cookie = opciones.cookie ?? this.cookieCruda;
    if (cookie) cabeceras.Cookie = cookie;
    if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    const r = await fetch(`${this.base}${camino}`, {
      method: metodo,
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      redirect: 'manual',
    });

    for (const linea of r.headers.getSetCookie()) {
      const [par] = linea.split(';');
      const idx = par.indexOf('=');
      if (idx > 0) this.cookies.set(par.slice(0, idx).trim(), par.slice(idx + 1).trim());
    }

    const texto = await r.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = texto;
    }
    return { estado: r.status, cuerpo, texto, cabeceras: r.headers };
  }

  get = (c: string, o?: { cookie?: string }) => this.pedir('GET', c, o);
  post = (c: string, cuerpo?: unknown, o?: { cookie?: string }) =>
    this.pedir('POST', c, { cuerpo, ...o });
  patch = (c: string, cuerpo?: unknown, o?: { cookie?: string }) =>
    this.pedir('PATCH', c, { cuerpo, ...o });

  async entrar(email: string, password: string): Promise<Respuesta> {
    return this.post('/api/auth/login', { email, password });
  }
}

// ---------------------------------------------------------------------------
// Usuarios de prueba
// ---------------------------------------------------------------------------

export interface UsuarioDePrueba {
  id: string;
  email: string;
  password: string;
  rol: 'admin' | 'tecnico';
}

/**
 * Ámbito de una suite: su propio prefijo de correo y su propia limpieza.
 *
 * Sin esto, las suites comparten los usuarios que crea un `before` de fichero y
 * el orden de ejecución empieza a importar — que es exactamente cómo se rompió
 * la primera versión de esta batería. `node:test` ejecuta los `describe` de un
 * mismo fichero en serie, así que hoy es determinista, pero paraleliza
 * ficheros: en cuanto haya un segundo, un `DELETE ... LIKE 'test-%'` de una
 * suite se lleva por delante los usuarios de otra.
 *
 * Cada suite pide el suyo, crea lo que necesita y borra solo lo suyo.
 */
export function ambito(nombre: string) {
  const prefijo = `${PREFIJO}${nombre}-`;
  return {
    prefijo,
    crearUsuario: (opciones: OpcionesUsuario & { sufijo: string }) =>
      crearUsuario({ ...opciones, sufijo: `${nombre}-${opciones.sufijo}` }),
    /**
     * Borra los usuarios de la suite, y antes lo que los referencia.
     *
     * `auditoria.usuario_app_id` es `ON DELETE RESTRICT`, así que en cuanto una
     * suite lee una clave BIOS —que deja fila en `auditoria` por diseño— su
     * usuario deja de poder borrarse. Este `DELETE` llevaba fallando desde la
     * etapa 3 en las suites de cifrados y de roles, **sin que nadie lo viera**:
     * node:test cuenta el fallo de un `after` como `hookFailed` y lo deja fuera
     * del `# fail`, así que el resumen decía «48 pass, 0 fail» mientras `npm
     * test` salía con código 1 y la base de tests acumulaba basura corrida a
     * corrida. La corrida siguiente fallaba por el choque de UNIQUE, que es un
     * síntoma dos pasos por delante de la causa.
     *
     * Se borra la auditoría de la suite y no toda: las filas son suyas, las
     * escribió su usuario, y una limpieza que arrase la tabla entera taparía a
     * la suite de al lado.
     */
    limpiar: async () => {
      await db.execute(
        sql`DELETE FROM auditoria
             WHERE auditoria.usuario_app_id IN (
               SELECT usuarios_app.id FROM usuarios_app
                WHERE usuarios_app.email LIKE ${`${prefijo}%`}
             )`,
      );
      await db.delete(usuariosApp).where(like(usuariosApp.email, `${prefijo}%`));
    },
  };
}

export interface OpcionesUsuario {
  password?: string;
  rol?: 'admin' | 'tecnico';
  activo?: boolean;
  /** `true` deja `password_hash` en NULL, como el usuario de sistema. */
  sinHash?: boolean;
}

export async function crearUsuario(
  opciones: OpcionesUsuario & { sufijo: string },
): Promise<UsuarioDePrueba> {
  const email = `${PREFIJO}${opciones.sufijo}@bbl.local`;
  const password = opciones.password ?? 'contrasena-de-prueba-9876';
  const hash = opciones.sinHash ? null : await bcrypt.hash(password, 12);

  const [fila] = await db
    .insert(usuariosApp)
    .values({
      email,
      nombre: `Prueba ${opciones.sufijo}`,
      rol: opciones.rol ?? 'tecnico',
      activo: opciones.activo ?? true,
      password_hash: hash,
    })
    .onConflictDoUpdate({
      target: usuariosApp.email,
      set: {
        password_hash: hash,
        activo: opciones.activo ?? true,
        rol: opciones.rol ?? 'tecnico',
      },
    })
    .returning({ id: usuariosApp.id });

  return { id: fila.id, email, password, rol: opciones.rol ?? 'tecnico' };
}

export async function cambiarPassword(id: string, nueva: string): Promise<void> {
  await db
    .update(usuariosApp)
    .set({ password_hash: await bcrypt.hash(nueva, 12) })
    .where(eq(usuariosApp.id, id));
}

export async function desactivar(id: string): Promise<void> {
  await db.update(usuariosApp).set({ activo: false }).where(eq(usuariosApp.id, id));
}

/**
 * Envejece las sesiones **de un usuario concreto**, no todas.
 *
 * `sess` guarda el JSON de la sesión, así que se puede filtrar por quién es sin
 * tocar las de las demás suites.
 */
export async function caducarSesionesDe(usuarioId: string): Promise<void> {
  await db.execute(
    sql`UPDATE session SET expire = now() - interval '1 day'
        WHERE sess->'usuario'->>'id' = ${usuarioId}`,
  );
}

export async function contarSesionesDe(usuarioId: string): Promise<number> {
  const r = await db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM session WHERE sess->'usuario'->>'id' = ${usuarioId}`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function cerrarPool(): Promise<void> {
  await pool.end();
}

// ---------------------------------------------------------------------------
// Equipos y empleados de prueba
// ---------------------------------------------------------------------------

/** Los valores en claro que se cifran. Los tests buscan estas cadenas en las
 *  respuestas: si aparecen, algo las descifró donde no debía. */
export const BIOS_EN_CLARO = 'CLAVE-BIOS-QUE-NO-DEBE-SALIR-8891';
export const LICENCIA_EN_CLARO = 'WIN-LICENCIA-QUE-NO-DEBE-SALIR-4432';

export async function crearEquipoConSecretos(etiqueta: string, empleadoId?: string) {
  const [fila] = await db
    .insert(equipos)
    .values({
      categoria: 'Portátil',
      etiqueta,
      marca: 'Dell',
      modelo: 'Latitude 5420',
      serial: `SN-${etiqueta}`,
      estado: empleadoId ? 'Asignado' : 'Disponible',
      empleado_id: empleadoId ?? null,
      bios_password_cifrado: cifrar(BIOS_EN_CLARO),
      licencia_serial_cifrado: cifrar(LICENCIA_EN_CLARO),
    })
    .returning({ id: equipos.id });
  return fila.id;
}

export async function crearEmpleado(nombre: string) {
  const [fila] = await db.insert(empleados).values({ nombre }).returning({ id: empleados.id });
  return fila.id;
}

/**
 * Borra equipos **con sus movimientos**.
 *
 * Antes era un `DELETE FROM equipos` a secas, y bastaba: nada escribía en
 * `movimientos`. Desde que `POST /api/equipos` escribe la fila y su `Alta` en
 * la misma transacción, un equipo creado por un test ya no se puede borrar —la
 * FK es `ON DELETE RESTRICT`— y `movimientos` no admite `DELETE` por trigger.
 *
 * Lo interesante es cómo se manifestó: los tests **seguían pasando**
 * (`# pass 48, # fail 0`) y lo que fallaba era el `after` de tres suites, que
 * node:test cuenta como `hookFailed` y no como test roto. El resumen decía cero
 * fallos y `npm test` salía con código 1. Si el criterio hubiera sido leer el
 * resumen, esto se cierra en verde con la limpieza rota.
 *
 * `session_replication_role = replica` desactiva triggers y FKs para esta
 * sesión, y va con `SET LOCAL`: muere con la transacción. Es aceptable aquí
 * porque `comprobarBaseDeTest()` ya garantizó que la base es la de tests.
 */
export async function borrarEquipos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    for (const id of ids) {
      await tx.execute(sql`DELETE FROM movimientos WHERE movimientos.equipo_id = ${id}`);
      await tx.execute(sql`DELETE FROM equipos WHERE equipos.id = ${id}`);
    }
  });
}

export async function borrarEmpleados(ids: string[]): Promise<void> {
  for (const id of ids) await db.delete(empleados).where(eq(empleados.id, id));
}

/** El estado actual de un equipo, leído de la base y no de la respuesta. */
export async function estadoDe(equipoId: string): Promise<string | null> {
  const r = await db.execute<{ estado: string }>(
    sql`SELECT equipos.estado FROM equipos WHERE equipos.id = ${equipoId}`,
  );
  return r.rows[0]?.estado ?? null;
}

export async function auditoriaDe(
  registroId: string,
  accion: string,
): Promise<{ filas: { antes: unknown; despues: unknown; usuario_app_id: string | null }[] }> {
  const r = await db.execute<{ antes: unknown; despues: unknown; usuario_app_id: string | null }>(
    sql`SELECT auditoria.antes, auditoria.despues, auditoria.usuario_app_id
          FROM auditoria
         WHERE auditoria.registro_id = ${registroId} AND auditoria.accion = ${accion}
         ORDER BY auditoria.fecha`,
  );
  return { filas: r.rows };
}

/**
 * Abre una transacción, hace el `UPDATE` de `equipos` y **mata la conexión**
 * antes de insertar el movimiento.
 *
 * Es el fallo a mitad de transacción, provocado de verdad: se termina el
 * proceso servidor de Postgres desde otra sesión con `pg_terminate_backend`.
 * No hay mock por medio — un mock demostraría que el mock se llamó en el orden
 * previsto, y lo que hay que demostrar es que la base deshace lo ya escrito.
 *
 * El `on('error')` del cliente no es decorativo: `pg` emite un evento `error`
 * cuando la conexión se cae, y un `error` de EventEmitter sin escuchar es una
 * excepción no capturada que mata el proceso de Node. Es exactamente lo que le
 * pasó al pool en la etapa 4a.
 */
export async function matarConexionEnMedioDeAsignar(
  equipoId: string,
  empleadoId: string,
): Promise<string> {
  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  cliente.on('error', () => {
    /* la vamos a matar a propósito: su muerte no es un fallo del proceso */
  });
  await cliente.connect();

  try {
    const { rows } = await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = rows[0].pid;

    await cliente.query('BEGIN');
    await cliente.query(
      `UPDATE equipos SET estado = 'Asignado', empleado_id = $1 WHERE id = $2`,
      [empleadoId, equipoId],
    );

    // La fila ya está cambiada DENTRO de la transacción. Comprobarlo desde
    // aquí es lo que hace que el test no pase por vacío: si el UPDATE no
    // hubiera hecho nada, matar la conexión no demostraría nada.
    const dentro = await cliente.query<{ estado: string }>(
      'SELECT estado FROM equipos WHERE id = $1',
      [equipoId],
    );
    if (dentro.rows[0]?.estado !== 'Asignado') {
      throw new Error('el UPDATE no llegó a aplicarse dentro de la transacción');
    }

    // Desde OTRA conexión —la del pool—, matar esta.
    await db.execute(sql`SELECT pg_terminate_backend(${pid})`);

    // Y ahora el INSERT que nunca llegará. Tiene que fallar.
    try {
      await cliente.query(
        `INSERT INTO movimientos (equipo_id, tipo, usuario_app_id)
         VALUES ($1, 'Asignación', (SELECT id FROM usuarios_app LIMIT 1))`,
        [equipoId],
      );
      return 'el INSERT pasó: la conexión no murió';
    } catch {
      return 'conexión terminada';
    }
  } finally {
    // `end()` sobre una conexión ya muerta puede rechazar; no importa.
    await cliente.end().catch(() => {});
  }
}

/** La segunda sede sembrada. Para probar traslados de A a B. */
export async function segundaSede(): Promise<string> {
  const r = await db.execute<{ id: string }>(
    sql`SELECT sedes.id FROM sedes ORDER BY sedes.nombre OFFSET 1 LIMIT 1`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("Hacen falta al menos dos sedes. Correr: npm run test:preparar");
  return id;
}

/** La primera sede sembrada. Las altas necesitan una que exista de verdad. */
export async function primeraSede(): Promise<string> {
  const r = await db.execute<{ id: string }>(
    sql`SELECT sedes.id FROM sedes ORDER BY sedes.nombre LIMIT 1`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('No hay sedes en la base de test. Correr: npm run test:preparar');
  return id;
}

export async function contarEquiposConEtiqueta(etiqueta: string): Promise<number> {
  const r = await db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM equipos WHERE equipos.etiqueta = ${etiqueta}`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Los movimientos de un equipo, del más antiguo al más nuevo. */
/** `drizzle.execute<T>` exige que `T` tenga índice de cadena. */
export type MovimientoDePrueba = {
  tipo: string;
  sede_origen_id: string | null;
  sede_destino_id: string | null;
  empleado_origen_id: string | null;
  empleado_destino_id: string | null;
  usuario_app_id: string;
  fecha_confirmacion: Date | null;
} & Record<string, unknown>;

export async function movimientosDe(equipoId: string): Promise<MovimientoDePrueba[]> {
  const r = await db.execute<MovimientoDePrueba>(
    sql`SELECT movimientos.tipo,
               movimientos.sede_origen_id,
               movimientos.sede_destino_id,
               movimientos.empleado_origen_id,
               movimientos.empleado_destino_id,
               movimientos.usuario_app_id,
               movimientos.fecha_confirmacion
          FROM movimientos
         WHERE movimientos.equipo_id = ${equipoId}
         ORDER BY movimientos.fecha, movimientos.created_at`,
  );
  return r.rows;
}

export async function contarAuditoria(registroId: string, accion: string): Promise<number> {
  const r = await db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM auditoria
        WHERE registro_id = ${registroId} AND accion = ${accion}`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Recorre un valor JSON entero buscando claves prohibidas o cadenas que no
 * deberían aparecer. Devuelve las rutas donde las encontró.
 *
 * A cualquier profundidad y a través de arrays: un endpoint que devuelva
 * `{ equipos: [ { ... } ] }` esconde los campos dos niveles adentro, y una
 * comprobación de primer nivel no los vería.
 */
export function buscarFugas(
  valor: unknown,
  prohibidas: string[],
  ruta = '$',
  encontradas: string[] = [],
): string[] {
  if (typeof valor === 'string') {
    for (const p of prohibidas) {
      if (valor.includes(p)) encontradas.push(`${ruta} contiene "${p}"`);
    }
    return encontradas;
  }
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => buscarFugas(v, prohibidas, `${ruta}[${i}]`, encontradas));
    return encontradas;
  }
  if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      for (const p of prohibidas) {
        if (k.includes(p)) encontradas.push(`${ruta}.${k} es una clave prohibida`);
      }
      buscarFugas(v, prohibidas, `${ruta}.${k}`, encontradas);
    }
  }
  return encontradas;
}

/** Claves y valores que no pueden salir por la API, en ninguna respuesta. */
export const PROHIBIDO_EN_RESPUESTAS = [
  'bios_password',
  'licencia_serial',
  BIOS_EN_CLARO,
  LICENCIA_EN_CLARO,
];
