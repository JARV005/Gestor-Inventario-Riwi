/**
 * API núcleo: campos cifrados, roles y la desactivación de empleados.
 *
 * La regla que más fácil se rompe sola es la de los campos cifrados, así que se
 * comprueba en dos capas: sobre las respuestas —de éxito **y de error**— y
 * sobre el código de los repositorios.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ambito,
  arrancar,
  BIOS_EN_CLARO,
  borrarEmpleados,
  borrarEquipos,
  buscarFugas,
  Cliente,
  comprobarBaseDeTest,
  contarAuditoria,
  crearEmpleado,
  crearEquipoConSecretos,
  LICENCIA_EN_CLARO,
  PROHIBIDO_EN_RESPUESTAS,
  type Servidor,
  type UsuarioDePrueba,
} from './ayuda.js';

let servidor: Servidor;

before(async () => {
  comprobarBaseDeTest();
  servidor = await arrancar();
});

after(async () => {
  await servidor.cerrar();
});

const nuevo = () => new Cliente(servidor.url);

// ---------------------------------------------------------------------------

describe('campos cifrados: no salen por ningún listado', () => {
  const suite = ambito('cifrados');
  let admin: UsuarioDePrueba;
  let tecnico: UsuarioDePrueba;
  let equipoId: string;
  let empleadoId: string;
  let cAdmin: Cliente;
  let cTecnico: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    tecnico = await suite.crearUsuario({ sufijo: 'tecnico', rol: 'tecnico' });
    empleadoId = await crearEmpleado(`${suite.prefijo}titular`);
    equipoId = await crearEquipoConSecretos(`${suite.prefijo}EQ1`, empleadoId);
    cAdmin = nuevo();
    cTecnico = nuevo();
    await cAdmin.entrar(admin.email, admin.password);
    await cTecnico.entrar(tecnico.email, tecnico.password);
  });

  after(async () => {
    await borrarEquipos([equipoId]);
    await borrarEmpleados([empleadoId]);
    await suite.limpiar();
  });

  const caminos = () => [
    '/api/equipos',
    '/api/equipos?q=EQ1',
    '/api/equipos/revision',
    `/api/equipos/${equipoId}`,
    `/api/equipos/${equipoId}/historial`,
    `/api/empleados/${empleadoId}/equipos`,
    '/api/empleados',
    '/api/sedes',
    // Devuelve marca, modelo y etiqueta del equipo que viaja: es un listado de
    // equipos con otro nombre, y los listados son de donde se escapan.
    '/api/traslados',
  ];

  it('ningún GET los devuelve, tampoco para admin', async () => {
    for (const cliente of [cAdmin, cTecnico]) {
      for (const camino of caminos()) {
        const r = await cliente.get(camino);
        assert.ok(r.estado < 400, `${camino} devolvió ${r.estado}`);
        const fugas = buscarFugas(r.cuerpo, PROHIBIDO_EN_RESPUESTAS);
        assert.deepEqual(fugas, [], `${camino}: ${fugas.join(' | ')}`);
        // Y sobre el texto crudo, por si algo se colara fuera del JSON.
        assert.ok(!r.texto.includes(BIOS_EN_CLARO), `${camino} filtra la clave BIOS`);
        assert.ok(!r.texto.includes(LICENCIA_EN_CLARO), `${camino} filtra el serial de licencia`);
      }
    }
  });

  it('tampoco salen en respuestas de ERROR', async () => {
    // Es donde nadie mira: un 500 que serializa el objeto filtra lo mismo que
    // un listado descuidado. Se provocan errores de verdad, no simulados.

    // 400: entrada inválida. Los `issues` de zod incluyen el valor recibido,
    // así que el manejador solo debe devolver campo y problema.
    const malo = await cAdmin.patch(`/api/equipos/${equipoId}`, {
      categoria: 'NoExiste',
      bios_password_cifrado: 'intento-de-inyectar',
    });
    assert.equal(malo.estado, 400);
    assert.deepEqual(buscarFugas(malo.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);

    // 404 sobre un id que no existe.
    const noHay = await cAdmin.get('/api/equipos/00000000-0000-0000-0000-000000000000');
    assert.equal(noHay.estado, 404);
    assert.deepEqual(buscarFugas(noHay.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);

    // 409: una FK inexistente. Desde que existe el traductor de errores de
    // Postgres esto ya no es un 500 — es un error que la persona puede
    // corregir— pero sigue siendo una respuesta de error y no puede filtrar.
    //
    // Va por el POST y no por el PATCH: desde la etapa 5 el PATCH rechaza
    // `sede_id` antes de llegar a la base (se traslada, no se edita), así que
    // por ahí ya no se puede provocar una violación de FK.
    const fk = await cAdmin.post('/api/equipos', {
      categoria: 'Portátil',
      estado: 'Disponible',
      etiqueta: `${suite.prefijo}FK`,
      sede_id: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(fk.estado, 409);
    assert.deepEqual(buscarFugas(fk.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);

    // 500 de verdad: una fecha imposible es un fallo nuestro, no de la persona,
    // así que no se traduce. El error de pg lleva dentro la consulta y a veces
    // los valores.
    const revienta = await cAdmin.patch(`/api/equipos/${equipoId}`, {
      fecha_compra: '9999-99-99',
    });
    assert.equal(revienta.estado, 500);
    assert.deepEqual(buscarFugas(revienta.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);
    // El cuerpo es exactamente esto y nada más: si el manejador serializara el
    // error, aquí aparecerían la consulta, los parámetros y la pila.
    assert.equal(revienta.texto, JSON.stringify({ error: 'Error interno' }));
  });

  it('el endpoint de BIOS sí los devuelve, solo para admin y con auditoría', async () => {
    const antes = await contarAuditoria(equipoId, 'descifrar_bios');

    const negado = await cTecnico.get(`/api/equipos/${equipoId}/bios`);
    assert.equal(negado.estado, 403);
    assert.deepEqual(buscarFugas(negado.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);

    const ok = await cAdmin.get(`/api/equipos/${equipoId}/bios`);
    assert.equal(ok.estado, 200);
    const cuerpo = ok.cuerpo as { bios_password: string; licencia_serial: string };
    assert.equal(cuerpo.bios_password, BIOS_EN_CLARO);
    assert.equal(cuerpo.licencia_serial, LICENCIA_EN_CLARO);

    // El contrapunto: probar solo el rechazo dejaría pasar un endpoint que no
    // descifra nada. Y el acceso queda registrado.
    const despues = await contarAuditoria(equipoId, 'descifrar_bios');
    assert.equal(despues, antes + 1, 'el desciframiento no dejó fila en auditoria');

    // El intento denegado no debe registrarse como acceso concedido.
    assert.equal(despues - antes, 1);
  });
});

describe('campos cifrados: la capa sobre el código', () => {
  it('ningún repositorio usa .select() sin argumentos', () => {
    // En Drizzle, `.select()` sin argumentos es SELECT *. Basta con que alguien
    // lo escriba una vez —o copie un endpoint— para que los dos campos
    // cifrados salgan en todas las respuestas de ese endpoint, sin hacer ruido.
    // El comentario de equipos.ts avisa; esto es lo que lo impide.
    const dir = join(process.cwd(), 'db', 'repositorios');
    const ficheros = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    assert.ok(ficheros.length > 0, 'no se encontraron repositorios; revisar la ruta');

    const culpables: string[] = [];
    for (const f of ficheros) {
      const texto = readFileSync(join(dir, f), 'utf8');
      // Los comentarios se vacían conservando los saltos de línea, para que el
      // número de línea del informe siga siendo el real.
      //
      // Sin esto, el test se marcaba a sí mismo: el comentario de `equipos.ts`
      // que explica por qué no se usa `.select()` contiene, necesariamente, la
      // cadena `.select()`. Un test que no distingue código de prosa da rojos
      // que no significan nada.
      const codigo = texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes: string) => antes + ' '.repeat(m.length - antes.length));

      codigo.split('\n').forEach((linea, i) => {
        if (/\.select\(\s*\)/.test(linea)) culpables.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(culpables, [], `SELECT * en: ${culpables.join(', ')}`);
  });

  /**
   * Toda función que ESCRIBA en `equipos` tiene que auditar.
   *
   * ==========================================================================
   * ES LO PRIMERO QUE SE OLVIDÓ DOS VECES. NO SE CONFÍA EN ACORDARSE.
   * ==========================================================================
   *
   * El §5 exige que toda escritura sobre `equipos` deje fila en `auditoria`.
   * `repoMovimientos.mutar` lo hace desde la etapa 5; `db/repositorios/equipos.ts`
   * no lo hacía en NINGUNA de sus cuatro funciones que escriben —`crear`,
   * `actualizar`, `cerrarMotivo` y `fijarTenedor`— y nadie lo notó durante dos
   * etapas.
   *
   * Cómo salió a la luz: dos filas del corpus perdieron su marca de revisión,
   * los verificadores se pusieron en rojo, y al preguntarle a `auditoria` quién
   * las había tocado **la tabla estaba vacía**. Ese vacío no era «nadie las
   * tocó»: era «nadie escribe aquí». Un registro de auditoría que nunca se
   * llena no se distingue de uno que dice que no pasó nada, y esa es
   * exactamente la forma de fallo que este proyecto ya conoce.
   *
   * Esto es estático a propósito. Un caso que ejercite los cuatro endpoints
   * comprobaría los cuatro que existen hoy; este se pone rojo con el quinto que
   * alguien escriba, que es cuando hace falta.
   */
  it('toda función que escribe en equipos deja fila en auditoria', () => {
    const ruta = join(process.cwd(), 'db', 'repositorios', 'equipos.ts');
    const texto = readFileSync(ruta, 'utf8');

    // Comentarios fuera, conservando los saltos de línea para que el número de
    // línea del informe siga siendo el real. Mismo motivo que arriba: este
    // fichero habla de `auditoria` en su prosa.
    const codigo = texto
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));

    // Se parte por `export async function`: cada trozo es una función entera,
    // con su cuerpo, hasta la siguiente.
    const trozos = codigo.split(/^export (?:async )?function /m).slice(1);
    assert.ok(trozos.length > 0, 'no se encontró ninguna función exportada; revisar el corte');

    const escriben: string[] = [];
    const sinAuditar: string[] = [];
    for (const trozo of trozos) {
      const nombre = trozo.slice(0, trozo.indexOf('(')).trim();
      // Las tres formas de escribir en la tabla con drizzle.
      const escribe =
        /\.update\(equipos\)/.test(trozo) ||
        /\.insert\(equipos\)/.test(trozo) ||
        /\.delete\(equipos\)/.test(trozo);
      if (!escribe) continue;
      escriben.push(nombre);
      if (!/repoAuditoria\.registrar/.test(trozo)) sinAuditar.push(nombre);
    }

    // Que el detector encuentre algo. Sin esto, renombrar `equipos` o cambiar
    // de ORM dejaría el caso en verde sin comprobar nada — el modo de fallo de
    // un test que busca un patrón que ya no existe.
    assert.ok(
      escriben.length >= 4,
      `solo se detectaron ${escriben.length} funciones que escriben (${escriben.join(', ')}); ` +
        `eran cuatro, así que el detector está mirando mal`,
    );

    assert.deepEqual(
      sinAuditar,
      [],
      `escriben en equipos sin registrar en auditoria: ${sinAuditar.join(', ')}`,
    );
  });
});

/**
 * La marca de la aplicación no puede llegar al PDF de un acta (5g).
 *
 * ==========================================================================
 * SI ESTE CASO SE PONE ROJO, HAY ACTAS FIRMADAS QUE DEJAN DE VERIFICAR.
 * ==========================================================================
 *
 * El logo de un acta es el de la empresa que la emite y sus bytes están dentro
 * del hash (D39). El logo de RiwiStock es otra cosa: es la marca del programa,
 * vive en `src/components/LogoRiwiStock.tsx` y no debe aparecer en ningún
 * documento.
 *
 * La forma de que se colara no sería que alguien lo dibujara en el acta a
 * propósito, sino que el generador acabara importando algo del cliente —una
 * constante de color, un componente— y arrastrara la marca con ello. Por eso
 * lo que se comprueba es la DIRECCIÓN de las dependencias: nada de `db/` ni de
 * `server/` importa de `src/`.
 *
 * Es estático porque el daño no se ve al generar: el PDF sale bien, y lo que
 * falla es la comparación contra las actas emitidas antes del cambio.
 */
/**
 * Ningún componente llama a un hook después de un `return` temprano.
 *
 * ==========================================================================
 * ESTE CASO EXISTE PORQUE PASÓ, Y DEJÓ UNA PANTALLA INACCESIBLE.
 * ==========================================================================
 *
 * En la 5g, el `useEffect` que limpia los filtros del buscador quedó por
 * debajo de `if (cargando) return`. Durante la carga React ejecutaba 31 hooks
 * y salía; cuando llegaban los datos ejecutaba 32. React aborta el render con
 * «Rendered more hooks than during the previous render» y el navegador se
 * queda colgado — ni «no carga» ni un error: la pestaña deja de responder.
 *
 * **No lo vio nada.** `tsc` pasa, porque es JavaScript válido. La batería
 * entera pasa, porque ningún caso renderiza componentes. Solo se ve abriendo
 * la pantalla, y eso no lo hace ningún test de este proyecto.
 *
 * Es estático y aproximado a propósito: la herramienta buena para esto es
 * `eslint-plugin-react-hooks`, que no está instalado —añadir una dependencia
 * se propone antes—. Mientras tanto, esto cubre el caso concreto que ocurrió.
 */
describe('componentes: ningún hook después de un return temprano', () => {
  it('los hooks van todos antes del primer return condicional', () => {
    const dir = join(process.cwd(), 'src', 'components');
    const culpables: string[] = [];

    for (const nombre of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const texto = readFileSync(join(dir, nombre), 'utf8');

      // Comentarios fuera, conservando los saltos: los números de línea del
      // informe tienen que ser los reales, y esta prosa habla de `useEffect`.
      const codigo = texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));

      const lineas = codigo.split('\n');

      /**
       * Cada componente por separado.
       *
       * Un fichero puede tener varios —`EmployeesView` lleva dentro
       * `FormularioEmpleado`— y los hooks del segundo van legítimamente
       * después del `return` del primero. Sin trocear, eso sería un falso
       * positivo que obligaría a desactivar el caso entero.
       */
      const inicios: number[] = [];
      lineas.forEach((l, i) => {
        if (/^(export )?const \w+: React\.FC/.test(l)) inicios.push(i);
      });

      for (const [n, desde] of inicios.entries()) {
        const hasta = inicios[n + 1] ?? lineas.length;
        const cuerpo = lineas.slice(desde, hasta);

        // El primer `return` de guarda: dos espacios de sangría, dentro del
        // componente y no de una función anidada.
        const iReturn = cuerpo.findIndex((l) => /^  if \(.*\)\s*return /.test(l));
        if (iReturn < 0) continue;

        cuerpo.slice(iReturn + 1).forEach((l, k) => {
          if (/^  (const .*= )?use(State|Effect|Callback|Memo|Ref|Reducer|Context)\(/.test(l)) {
            culpables.push(
              `${nombre}:${desde + iReturn + k + 2} — hook después del return de la línea ` +
                `${desde + iReturn + 1}`,
            );
          }
        });
      }
    }

    assert.deepEqual(
      culpables,
      [],
      `hooks después de un return temprano:\n  ${culpables.join('\n  ')}\n` +
        `React exige que sean los mismos y en el mismo orden en cada render: la ` +
        `pantalla se cuelga al llegar los datos.`,
    );
  });
});

describe('marca: el logo de la aplicación no entra en las actas', () => {
  it('nada del servidor importa del cliente', () => {
    const raices = ['db', 'server'];
    const culpables: string[] = [];

    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) {
          if (entrada.name === 'migraciones' || entrada.name === 'node_modules') continue;
          recorrer(ruta);
          continue;
        }
        if (!entrada.name.endsWith('.ts') && !entrada.name.endsWith('.tsx')) continue;

        const texto = readFileSync(ruta, 'utf8');
        // `from '../src/…'` en cualquiera de sus formas, y también los import()
        // dinámicos. No vale con buscar la cadena "src": aparece en prosa.
        if (/from\s+['"][^'"]*\/src\/|import\(['"][^'"]*\/src\//.test(texto)) {
          culpables.push(ruta.replace(/\\/g, '/'));
        }
      }
    };

    for (const r of raices) recorrer(join(process.cwd(), r));

    assert.deepEqual(
      culpables,
      [],
      `el servidor importa del cliente en: ${culpables.join(', ')}. ` +
        `Si arrastra la marca de la aplicación hasta pdfkit, las actas ya emitidas dejan de verificar.`,
    );
  });

  /**
   * Y el otro lado: que el logo del acta siga saliendo de donde debe.
   *
   * Sin esto, alguien podría mover los logos de empresa a `src/` «para tenerlos
   * juntos» y el caso anterior seguiría en verde mientras el acta pierde el
   * suyo.
   */
  it('los logos de las actas siguen en assets/, fuera del cliente', () => {
    for (const fichero of ['assets/logos/logo-riwi.png', 'assets/logos/logo-bbl.png']) {
      assert.ok(
        existsSync(join(process.cwd(), fichero)),
        `falta ${fichero}: los bytes del logo están dentro del hash de cada acta (D39)`,
      );
    }
  });
});

describe('roles: lo que tecnico no puede', () => {
  const suite = ambito('roles');
  let tecnico: UsuarioDePrueba;
  let admin: UsuarioDePrueba;
  let equipoId: string;

  before(async () => {
    tecnico = await suite.crearUsuario({ sufijo: 'tecnico', rol: 'tecnico' });
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    equipoId = await crearEquipoConSecretos(`${suite.prefijo}EQ2`);
  });

  after(async () => {
    await borrarEquipos([equipoId]);
    await suite.limpiar();
  });

  it('tecnico recibe 403 en los endpoints de admin, admin no', async () => {
    const cT = nuevo();
    const cA = nuevo();
    await cT.entrar(tecnico.email, tecnico.password);
    await cA.entrar(admin.email, admin.password);

    // El recorrido sale de la tabla de permisos: los endpoints admin que se
    // añadan quedan cubiertos sin tocar este test.
    const { rutasRegistradas } = await import('../server/permisos.js');
    const soloAdmin = rutasRegistradas().filter((r) => r.permiso === 'admin');
    assert.ok(soloAdmin.length > 0, 'no hay ninguna ruta de admin registrada');

    for (const r of soloAdmin) {
      const camino = r.ruta.replace(/:[^/]+/g, equipoId);
      const negado = await cT.pedir(
        r.metodo.toUpperCase(),
        camino,
        r.metodo === 'get' ? {} : { cuerpo: {} },
      );
      assert.equal(negado.estado, 403, `tecnico entró en ${camino}`);

      const permitido = await cA.pedir(
        r.metodo.toUpperCase(),
        camino,
        r.metodo === 'get' ? {} : { cuerpo: {} },
      );
      assert.notEqual(permitido.estado, 403, `admin no pudo entrar en ${camino}`);
    }
  });

  it('tecnico sí puede con el resto del CRUD', async () => {
    const c = nuevo();
    await c.entrar(tecnico.email, tecnico.password);
    assert.equal((await c.get('/api/equipos')).estado, 200);
    assert.equal((await c.get('/api/empleados')).estado, 200);
    assert.equal((await c.get('/api/sedes')).estado, 200);
  });
});

describe('violaciones de integridad: 409 con qué corregir, no 500', () => {
  // Teclear un serial repetido es uso normal, y crear un equipo Asignado sin
  // responsable choca contra la constraint que el proyecto lleva cuatro etapas
  // protegiendo. Las dos respondían "Error interno": la constraint funcionaba,
  // el traductor no existía.
  const suite = ambito('integridad');
  let admin: UsuarioDePrueba;
  let c: Cliente;
  let equipoId: string;
  const creados: string[] = [];

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    equipoId = await crearEquipoConSecretos(`${suite.prefijo}EQ-INT`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos([...creados, equipoId]);
    await suite.limpiar();
  });

  it('control: un alta válida devuelve 201', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      estado: 'Disponible',
      serial: `${suite.prefijo}SERIAL-LIBRE`,
    });
    assert.equal(r.estado, 201);
    creados.push((r.cuerpo as { equipo: { id: string } }).equipo.id);
  });

  it('UNIQUE: dice qué campo y qué valor colisiona', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      estado: 'Disponible',
      serial: `SN-${suite.prefijo}EQ-INT`, // el que creó crearEquipoConSecretos
    });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; campo?: string; valor?: string };
    assert.equal(cuerpo.campo, 'serial');
    assert.ok(cuerpo.error.includes('serial'), `mensaje sin el campo: ${cuerpo.error}`);
    assert.ok(cuerpo.error.includes(`SN-${suite.prefijo}EQ-INT`), 'el mensaje no dice qué valor');
    // Dice qué corregir, no qué falló.
    assert.ok(!/constraint|unique|violat/i.test(cuerpo.error), `jerga en: ${cuerpo.error}`);
  });

  it('CHECK: explica la regla en lengua humana', async () => {
    const r = await c.post('/api/equipos', { categoria: 'Portátil', estado: 'Asignado' });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; regla?: string };
    assert.equal(cuerpo.regla, 'equipos_asignado_implica_empleado');
    assert.ok(cuerpo.error.includes('Asignado'), cuerpo.error);
    assert.ok(cuerpo.error.includes('responsable'), cuerpo.error);
    assert.ok(!/constraint|check|violat/i.test(cuerpo.error), `jerga en: ${cuerpo.error}`);
  });

  it('FK: dice qué referencia no existe', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      estado: 'Disponible',
      sede_id: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; campo?: string };
    assert.equal(cuerpo.campo, 'sede_id');
    assert.ok(cuerpo.error.includes('sede'), cuerpo.error);
    assert.ok(!/foreign|key|constraint/i.test(cuerpo.error), `jerga en: ${cuerpo.error}`);
  });

  it('lo que no sabemos explicar sigue siendo 500, no un 409 inventado', async () => {
    // Un tipo de dato imposible no es una violación de integridad: es un fallo
    // nuestro, y disfrazarlo de error de la persona sería mentir.
    const r = await c.patch(`/api/equipos/${equipoId}`, { fecha_compra: 'no-es-una-fecha' });
    assert.ok(r.estado === 400 || r.estado === 500, `devolvió ${r.estado}`);
    assert.notEqual(r.estado, 409);
  });

  it('ningún 409 filtra los campos cifrados', async () => {
    for (const cuerpo of [
      { categoria: 'Portátil', estado: 'Disponible', serial: `SN-${suite.prefijo}EQ-INT` },
      { categoria: 'Portátil', estado: 'Asignado' },
      { categoria: 'Portátil', estado: 'Disponible', sede_id: '11111111-1111-1111-1111-111111111111' },
    ]) {
      const r = await c.post('/api/equipos', cuerpo);
      assert.deepEqual(buscarFugas(r.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);
    }
  });
});

describe('empleados: desactivar con equipos a su nombre', () => {
  const suite = ambito('desactivar');
  let admin: UsuarioDePrueba;
  let conEquipo: string;
  let sinEquipo: string;
  let equipoId: string;
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    conEquipo = await crearEmpleado(`${suite.prefijo}con-equipo`);
    sinEquipo = await crearEmpleado(`${suite.prefijo}sin-equipo`);
    equipoId = await crearEquipoConSecretos(`${suite.prefijo}EQ3`, conEquipo);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos([equipoId]);
    await borrarEmpleados([conEquipo, sinEquipo]);
    await suite.limpiar();
  });

  it('se bloquea con 409 y dice cuáles', async () => {
    const r = await c.patch(`/api/empleados/${conEquipo}`, { activo: false });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; equipos: Array<{ id: string; etiqueta: string }> };
    assert.equal(cuerpo.equipos.length, 1);
    assert.equal(cuerpo.equipos[0].id, equipoId);
    assert.ok(cuerpo.error.includes('Devolverlos primero'));
    // Ni siquiera aquí, que es una respuesta de error con filas de equipos.
    assert.deepEqual(buscarFugas(r.cuerpo, PROHIBIDO_EN_RESPUESTAS), []);
  });

  it('sigue activo después del intento fallido', async () => {
    const r = await c.get(`/api/empleados/${conEquipo}`);
    const cuerpo = r.cuerpo as { empleado: { activo: boolean } };
    assert.equal(cuerpo.empleado.activo, true);
  });

  it('sin equipos a su nombre, se desactiva', async () => {
    const r = await c.patch(`/api/empleados/${sinEquipo}`, { activo: false });
    assert.equal(r.estado, 200);
    const cuerpo = r.cuerpo as { empleado: { activo: boolean } };
    assert.equal(cuerpo.empleado.activo, false);
  });

  it('un PATCH que no toca activo no exige nada', async () => {
    const r = await c.patch(`/api/empleados/${conEquipo}`, { cargo: 'Analista' });
    assert.equal(r.estado, 200);
  });
});
