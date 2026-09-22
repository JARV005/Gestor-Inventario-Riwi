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
import type { EmpresaQueEmite } from '../db/acta-formato.js';
import { siguienteConsecutivo } from '../db/repositorios/actas.js';
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

  /**
   * Un GET que NO intenta interpretar la respuesta como texto.
   *
   * `pedir()` hace `r.text()`, y sobre un PDF eso destruye los bytes: el
   * decodificador UTF-8 sustituye cada secuencia inválida por U+FFFD, así que
   * el hash de lo «descargado» no coincidiría nunca y el fallo parecería del
   * generador.
   */
  async getBinario(
    camino: string,
  ): Promise<{ estado: number; cuerpo: Buffer; tipo: string | null; disposicion: string | null }> {
    const cabeceras: Record<string, string> = {};
    if (this.cookieCruda) cabeceras.Cookie = this.cookieCruda;

    const r = await fetch(`${this.base}${camino}`, { headers: cabeceras, redirect: 'manual' });
    return {
      estado: r.status,
      cuerpo: Buffer.from(await r.arrayBuffer()),
      tipo: r.headers.get('content-type'),
      disposicion: r.headers.get('content-disposition'),
    };
  }

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

/**
 * Marca un equipo con los motivos que se le pasen, por la base.
 *
 * Por la base y no por la API a propósito: no hay endpoint que ponga motivos
 * —los pone el importador— y lo que estos tests prueban es el camino de
 * SALIDA. Fabricar el estado de partida con la herramienta que se está
 * probando dejaría el caso comprobándose a sí mismo.
 *
 * Las dos escrituras van juntas porque son el mismo hecho: el CONSTRAINT
 * TRIGGER de la 0006 exige marca <=> motivos, y está deferido al COMMIT justo
 * para permitir el estado intermedio.
 */
export async function marcarEquipo(id: string, motivos: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE equipos SET requiere_revision = true WHERE equipos.id = ${id}`,
    );
    for (const m of motivos) {
      await tx.execute(
        sql`INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
             VALUES (${id}, ${m})`,
      );
    }
  });
}

export async function crearEmpleado(nombre: string, empresa?: 'RIWI' | 'BBL Labs' | 'Sin clasificar') {
  const [fila] = await db
    .insert(empleados)
    .values(empresa ? { nombre, empresa } : { nombre })
    .returning({ id: empleados.id });
  return fila.id;
}

/**
 * Las tablas que referencian `equipos` sin `ON DELETE CASCADE`, **leídas del
 * catálogo de Postgres**, no de una lista escrita aquí.
 *
 * Es lo que convierte «se me olvidó una tabla» en un error con nombre. Una
 * lista a mano sería la cuarta copia del mismo hecho, y las tres anteriores
 * —movimientos, actas_equipos, mantenimientos— se olvidaron una por una.
 */
async function tablasQueApuntanAEquipos(
  ejecutor: typeof db,
): Promise<{ tabla: string; columna: string }[]> {
  const r = await ejecutor.execute<{ tabla: string; columna: string }>(
    sql`SELECT c.conrelid::regclass::text AS tabla, a.attname AS columna
          FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.contype = 'f'
           AND c.confrelid = 'equipos'::regclass
           AND c.confdeltype <> 'c'`,
  );
  return r.rows;
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
 * **Las FK quedan activas.** Antes esto corría con
 * `SET LOCAL session_replication_role = replica`, que apaga triggers **y** FK a
 * la vez, y por eso borrar un equipo no fallaba aunque algo lo referenciara: se
 * quedaba huérfano y envenenaba la corrida siguiente. Tres tablas se olvidaron
 * una por una —movimientos, actas_equipos y mantenimientos— y ninguna de las
 * tres dio error al olvidarse: eso es la definición de una red que no sujeta.
 *
 * Ahora se borra en orden de dependencia con las FK puestas, y lo único que se
 * desactiva es **un trigger concreto de una tabla concreta**:
 * `trg_movimientos_append_only`, que existe para que un movimiento no se borre
 * nunca (0001). Es la única razón real por la que hacía falta `replica`.
 * `ALTER TABLE ... DISABLE TRIGGER` es transaccional en Postgres y se vuelve a
 * activar antes del COMMIT, así que fuera de esta transacción el append-only
 * sigue en pie.
 *
 * Todo esto es aceptable aquí porque `comprobarBaseDeTest()` ya garantizó que
 * la base es la de tests.
 */
export async function borrarEquipos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    // Interpolar el array dentro de ANY(...) NO vale: drizzle lo expande como
    // lista de parámetros y emite `ANY(($1, $2, $3))`, un constructor de fila,
    // que es un error de sintaxis. Comprobado leyendo el SQL emitido, no
    // supuesto — es la regla de CLAUDE.md sobre interpolar en `sql` crudo, esta
    // vez con un array. `IN (...)` emite `IN ($1, $2, $3)` y además no depende
    // de que el driver acierte el tipo del array.
    const enIds = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

    // Lo mínimo imprescindible, y nada más. Ver el bloque de arriba.
    await tx.execute(sql`ALTER TABLE movimientos DISABLE TRIGGER trg_movimientos_append_only`);

    {
      // Orden de dependencia, de las hojas a la raíz. `actas_equipos` antes que
      // `movimientos` porque su FK es compuesta contra (id, equipo_id), y
      // `movimientos` antes que `actas` porque `movimientos.acta_id` las
      // referencia. `equipos_motivos_revision` no está: es la única con
      // ON DELETE CASCADE, y se va sola con el equipo.
      await tx.execute(sql`DELETE FROM actas_equipos WHERE actas_equipos.equipo_id IN (${enIds})`);
      await tx.execute(sql`DELETE FROM mantenimientos WHERE mantenimientos.equipo_id IN (${enIds})`);
      await tx.execute(sql`DELETE FROM movimientos WHERE movimientos.equipo_id IN (${enIds})`);

      // Las actas que se quedaron sin ninguna línea. Referencian al usuario de
      // la suite con RESTRICT, así que si sobreviven, `limpiar()` no puede
      // borrarlo. Van antes del equipo: ya no hay movimientos que las aten.
      await tx.execute(
        sql`DELETE FROM actas
             WHERE NOT EXISTS (
               SELECT 1 FROM actas_equipos WHERE actas_equipos.acta_id = actas.id
             )`,
      );

      // Antes de borrar el equipo: ¿queda algo apuntándole? La FK lo diría
      // igual —ese es el punto de dejarlas puestas—, pero lo diría con el
      // nombre de la constraint. Esto lo dice con el nombre de la tabla y el
      // número de filas, que es lo que hace falta para arreglarlo.
      for (const { tabla, columna } of await tablasQueApuntanAEquipos(tx as unknown as typeof db)) {
        if (tabla === 'equipos') continue;
        const r = await tx.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM ${sql.identifier(tabla)}
               WHERE ${sql.identifier(tabla)}.${sql.identifier(columna)} IN (${enIds})`,
        );
        const n = Number(r.rows[0]?.n ?? 0);
        if (n > 0) {
          throw new Error(
            `borrarEquipos: ${tabla}.${columna} todavía tiene ${n} fila(s) apuntando a los ` +
              `equipos que se iban a borrar. Añádela a la limpieza, en orden de dependencia. ` +
              `Es la cuarta tabla: movimientos, actas_equipos y mantenimientos ya pasaron por aquí.`,
          );
        }
      }

      await tx.execute(sql`DELETE FROM equipos WHERE equipos.id IN (${enIds})`);
    }

    // Se reactiva en el camino bueno y no en un `finally`: si algo de arriba
    // falló, la transacción ya está abortada y este `ALTER` daría un segundo
    // error que taparía el primero. El ROLLBACK deshace el DISABLE por su
    // cuenta —el DDL es transaccional—, así que el trigger vuelve igual.
    await tx.execute(sql`ALTER TABLE movimientos ENABLE TRIGGER trg_movimientos_append_only`);
  });
}

/** Los datos de un acta leídos de la base, no de la API. */
export async function actaEnLaBase(
  id: string,
): Promise<{ consecutivo: string; empleado_nombre: string } | null> {
  const r = await db.execute<{ consecutivo: string; empleado_nombre: string }>(
    sql`SELECT actas.consecutivo, actas.empleado_nombre FROM actas WHERE actas.id = ${id}`,
  );
  return r.rows[0] ?? null;
}

/**
 * El PDF de un acta leído de la base. Es el único helper que trae el binario, y
 * lo trae de uno en uno a propósito.
 */
export async function pdfEnLaBase(
  id: string,
): Promise<{ pdf: Buffer; hash: string; plantilla: string } | null> {
  const r = await db.execute<{ pdf: Buffer; hash: string; plantilla: string }>(
    sql`SELECT actas.pdf, actas.hash_sha256 AS hash, actas.plantilla_version AS plantilla
          FROM actas WHERE actas.id = ${id}`,
  );
  const f = r.rows[0];
  return f?.pdf ? { pdf: f.pdf, hash: f.hash, plantilla: f.plantilla } : null;
}

/** El valor actual del contador del año, o 0 si todavía no existe. */
/**
 * Dónde va la serie de una empresa, leído de la base (D40).
 *
 * Devuelve `null` y no `0` cuando la empresa no tiene fila todavía, porque
 * ahora esas dos cosas son distintas: con el contador arrancando en cero, un
 * `0` es «ya se emitió la primera acta» y la ausencia de fila es «ninguna».
 * Colapsarlas haría que el test de la primera acta pasara sin comprobar nada.
 */
export async function consecutivoActual(empresa: string): Promise<number | null> {
  const r = await db.execute<{ valor: number }>(
    sql`SELECT actas_consecutivo.valor FROM actas_consecutivo
         WHERE actas_consecutivo.empresa = ${empresa}::empresa`,
  );
  return r.rows[0]?.valor ?? null;
}

/**
 * Los `cuantos` primeros números que daría una serie **virgen**, sin tocar la
 * de verdad.
 *
 * El contador es monótono y sobrevive a la limpieza de las suites: eso es lo
 * correcto para una numeración legal, y hace imposible comprobar «la primera
 * acta es la 0000» mirando la tabla más allá de la primera corrida. Aquí se
 * borra el contador dentro de una transacción, se piden los números y se
 * deshace todo con un ROLLBACK, así que la serie real queda donde estaba.
 */
export async function primerosDeSerieVirgen(
  empresa: EmpresaQueEmite,
  cuantos: number,
): Promise<string[]> {
  const numeros: string[] = [];
  const CORTE = 'rollback a propósito';
  const antes = await consecutivoActual(empresa);
  await db
    .transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM actas_consecutivo WHERE actas_consecutivo.empresa = ${empresa}::empresa`,
      );
      for (let i = 0; i < cuantos; i++) {
        numeros.push(
          await siguienteConsecutivo(tx, empresa),
        );
      }
      throw new Error(CORTE);
    })
    .catch((e) => {
      if (!(e instanceof Error) || e.message !== CORTE) throw e;
    });

  // Que el ROLLBACK haya ocurrido de verdad. Sin esta comprobación, un cambio
  // que hiciera confirmar la transacción reiniciaría el contador real y este
  // helper seguiría en verde mientras corrompe la numeración de las demás
  // suites — un test que rompe la base que usa el resto.
  const despues = await consecutivoActual(empresa);
  if (despues !== antes) {
    throw new Error(
      `el rollback no ocurrió: la serie ${empresa} pasó de ${antes} a ${despues}`,
    );
  }
  return numeros;
}

export async function primerNumeroDeSerieVirgen(empresa: EmpresaQueEmite): Promise<string> {
  return (await primerosDeSerieVirgen(empresa, 1))[0];
}

export async function dosPrimerosDeSerieVirgen(empresa: EmpresaQueEmite): Promise<string[]> {
  return primerosDeSerieVirgen(empresa, 2);
}

/** La sección 5 tal y como está GUARDADA, no como la devuelve la API. */
export async function chequeoEnLaBase(
  id: string,
): Promise<{ item: string; instalado: boolean | null; observaciones: string | null }[] | null> {
  const r = await db.execute<{ chequeo: unknown }>(
    sql`SELECT actas.chequeo FROM actas WHERE actas.id = ${id}`,
  );
  return (r.rows[0]?.chequeo ?? null) as never;
}

/**
 * Cambia la sección 5 guardada sin pasar por la aplicación.
 *
 * Es deliberadamente algo que la API no deja hacer: sirve para simular que
 * alguien tocó la instantánea por debajo y comprobar que `recalcularHash` se
 * da cuenta. Un acta emitida no se edita por ningún camino legítimo.
 */
export async function ponerChequeoEnLaBase(id: string, chequeo: unknown): Promise<void> {
  await db.execute(
    sql`UPDATE actas SET chequeo = ${JSON.stringify(chequeo)}::jsonb WHERE actas.id = ${id}`,
  );
}

/**
 * El tipo de licencia guardado, leído de la base.
 *
 * Existe para poder afirmar que cerrar un motivo **no rellena** el dato que el
 * motivo señalaba. Sin esto, un cierre en bloque que se inventara un
 * `licencia_tipo` plausible pasaría todos los demás casos.
 */
export async function licenciaTipoDe(id: string): Promise<string | null> {
  const r = await db.execute<{ t: string | null }>(
    sql`SELECT equipos.licencia_tipo AS t FROM equipos WHERE equipos.id = ${id}`,
  );
  return r.rows[0]?.t ?? null;
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

/**
 * El mismo corte, en la otra transacción de dos escrituras: **entre mover el
 * equipo y cerrar el traslado**.
 *
 * Si solo cuajara una de las dos, el equipo estaría en dos sedes a la vez según
 * a qué tabla se pregunte — y el trigger append-only impide reabrir un traslado
 * cerrado, así que la contradicción no se podría deshacer.
 */
export async function matarConexionEnMedioDeConfirmar(
  equipoId: string,
  movimientoId: string,
  sedeDestinoId: string,
): Promise<string> {
  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  cliente.on('error', () => {
    /* la vamos a matar a propósito */
  });
  await cliente.connect();

  try {
    const { rows } = await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = rows[0].pid;

    await cliente.query('BEGIN');
    await cliente.query('UPDATE equipos SET sede_id = $1 WHERE id = $2', [
      sedeDestinoId,
      equipoId,
    ]);

    // Igual que en el de asignar: comprobar DENTRO que la primera escritura se
    // aplicó. Sin esto, el test pasaría igual si el UPDATE no tocara nada.
    const dentro = await cliente.query<{ sede_id: string }>(
      'SELECT sede_id FROM equipos WHERE id = $1',
      [equipoId],
    );
    if (dentro.rows[0]?.sede_id !== sedeDestinoId) {
      throw new Error('el UPDATE de la sede no llegó a aplicarse dentro de la transacción');
    }

    await db.execute(sql`SELECT pg_terminate_backend(${pid})`);

    try {
      await cliente.query('UPDATE movimientos SET fecha_confirmacion = now() WHERE id = $1', [
        movimientoId,
      ]);
      return 'el UPDATE pasó: la conexión no murió';
    } catch {
      return 'conexión terminada';
    }
  } finally {
    await cliente.end().catch(() => {});
  }
}

/**
 * El corte de la 5c: **entre crear el movimiento y firmar el acta**.
 *
 * Es la tercera transacción de dos escrituras del proyecto, y la que más se
 * nota si se parte por la mitad: quedaría el equipo asignado y sin papel, o —al
 * revés— un acta con número consecutivo gastado y sin operación detrás.
 *
 * Se reproduce a mano el modo `ejecutar`: UPDATE del equipo, INSERT del
 * movimiento, y la conexión muere antes del INSERT del acta.
 */
export async function matarConexionEnMedioDeEmitir(
  equipoId: string,
  empleadoId: string,
  usuarioId: string,
): Promise<string> {
  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  cliente.on('error', () => {
    /* la vamos a matar a propósito */
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
    const { rows: movRows } = await cliente.query<{ id: string }>(
      `INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, empleado_destino_id)
       VALUES ($1, 'Asignación', $2, $3) RETURNING id`,
      [equipoId, usuarioId, empleadoId],
    );

    // Las dos primeras escrituras están hechas DENTRO de la transacción. Sin
    // comprobarlo, el test pasaría igual si no hubieran hecho nada.
    const dentro = await cliente.query<{ estado: string }>(
      'SELECT estado FROM equipos WHERE id = $1',
      [equipoId],
    );
    if (dentro.rows[0]?.estado !== 'Asignado' || !movRows[0]?.id) {
      throw new Error('la operación no llegó a aplicarse dentro de la transacción');
    }

    await db.execute(sql`SELECT pg_terminate_backend(${pid})`);

    // Y el acta que nunca llegará.
    try {
      await cliente.query(
        `INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                            empleado_nombre, generada_por_nombre)
         VALUES ('ACT-CORTE-9999', 'Entrega', $1, $2, 'x', 'y')`,
        [empleadoId, usuarioId],
      );
      return 'el INSERT pasó: la conexión no murió';
    } catch {
      return 'conexión terminada';
    }
  } finally {
    await cliente.end().catch(() => {});
  }
}

/** La sede en la que la base dice que está el equipo. */
export async function sedeDe(equipoId: string): Promise<string | null> {
  const r = await db.execute<{ sede_id: string | null }>(
    sql`SELECT equipos.sede_id FROM equipos WHERE equipos.id = ${equipoId}`,
  );
  return r.rows[0]?.sede_id ?? null;
}

/** El traslado abierto de un equipo leído de la base, no de la API. */
export async function trasladoAbiertoDe(
  equipoId: string,
): Promise<{ id: string; sede_destino_id: string | null } | null> {
  const r = await db.execute<{ id: string; sede_destino_id: string | null }>(
    sql`SELECT movimientos.id, movimientos.sede_destino_id
          FROM movimientos
         WHERE movimientos.equipo_id = ${equipoId}
           AND movimientos.tipo = 'Traslado'
           AND movimientos.fecha_confirmacion IS NULL`,
  );
  return r.rows[0] ?? null;
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

/** El nombre que la base le da a una sede. Para no escribirlo en los tests. */
export async function nombreDeSede(id: string): Promise<string | null> {
  const r = await db.execute<{ nombre: string }>(
    sql`SELECT sedes.nombre FROM sedes WHERE sedes.id = ${id}`,
  );
  return r.rows[0]?.nombre ?? null;
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
  id: string;
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
    sql`SELECT movimientos.id,
               movimientos.tipo,
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
