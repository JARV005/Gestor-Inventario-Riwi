/**
 * Actas. Etapa 5a — el acta en la base, sin PDF.
 *
 * Las tres cosas que esta suite existe para demostrar, y las tres se prueban
 * por sus dos lados:
 *
 *  1. La instantánea es una instantánea: cambiar el equipo después de emitir
 *     NO cambia el acta. Se comprueba emitiendo, cambiando el equipo de verdad
 *     y volviendo a leer el acta.
 *  2. El consecutivo no se repite bajo concurrencia. Se comprueba lanzando
 *     peticiones a la vez, no razonando sobre el bloqueo.
 *  3. El acta está atada al movimiento que la origina, y al de SU equipo.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  actaEnLaBase,
  ambito,
  arrancar,
  borrarEmpleados,
  borrarEquipos,
  Cliente,
  comprobarBaseDeTest,
  consecutivoActual,
  contarAuditoria,
  crearEmpleado,
  movimientosDe,
  primeraSede,
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
const ANIO = new Date().getUTCFullYear();

interface ActaLeida {
  id: string;
  consecutivo: string;
  tipo: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  sede_nombre: string | null;
  generada_por_nombre: string;
  tiene_pdf: boolean;
  equipos: {
    equipo_id: string;
    movimiento_id: string;
    etiqueta: string | null;
    serial: string | null;
    marca: string | null;
    ram: string | null;
    categoria: string;
  }[];
}

// ---------------------------------------------------------------------------

describe('actas: emitir sobre lo que ya ocurrió', () => {
  const suite = ambito('actas');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}titular`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  async function equipoAsignado(etiqueta: string): Promise<string> {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta,
      marca: 'Dell',
      modelo: 'Latitude 5440',
      serial: `SN-${etiqueta}`,
      ram: '16 GB',
      estado: 'Disponible',
      sede_id: sede,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado })).estado, 200);
    return id;
  }

  it('el acta queda atada al movimiento de la entrega, con su instantánea', async () => {
    const id = await equipoAsignado(`${suite.prefijo}A1`);

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const { acta } = r.cuerpo as { acta: ActaLeida };

    assert.match(acta.consecutivo, new RegExp(`^ACT-${ANIO}-\\d{4}$`));
    assert.equal(acta.tipo, 'Entrega');
    assert.equal(acta.tiene_pdf, false, 'el PDF es 5b');
    assert.ok(acta.generada_por_nombre.length > 0, 'quién la emitió queda congelado también');

    // Y lo mismo leído de la base, no de la respuesta: si el servidor
    // devolviera un objeto construido en memoria, esto lo cazaría.
    const enBase = await actaEnLaBase(acta.id);
    assert.equal(enBase?.consecutivo, acta.consecutivo);
    assert.equal(enBase?.empleado_nombre, acta.empleado_nombre);

    // La instantánea del equipo, copiada.
    assert.equal(acta.equipos.length, 1);
    const linea = acta.equipos[0];
    assert.equal(linea.equipo_id, id);
    assert.equal(linea.serial, `SN-${suite.prefijo}A1`);
    assert.equal(linea.ram, '16 GB');
    assert.equal(linea.categoria, 'Portátil');

    // Y la atadura: el movimiento es LA Asignación de ese equipo, no otro.
    const asignacion = (await movimientosDe(id)).find((m) => m.tipo === 'Asignación');
    assert.ok(asignacion);
    assert.equal(linea.movimiento_id, asignacion.id, 'el acta cuelga de su movimiento');

    assert.equal(await contarAuditoria(acta.id, 'emitir_acta'), 1);
  });

  /**
   * El otro lado de la instantánea, que es el que la justifica: se corrige el
   * equipo DESPUÉS de emitir, y el acta tiene que seguir diciendo lo de antes.
   *
   * Sin esta comprobación, un acta que leyera las FK al pintarse pasaría el
   * test anterior igual de bien.
   */
  it('corregir el equipo después NO cambia el acta ya emitida', async () => {
    const id = await equipoAsignado(`${suite.prefijo}A2`);
    const emitida = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    const actaId = (emitida.cuerpo as { acta: ActaLeida }).acta.id;

    // Se corrige el serial y la RAM del equipo, como pasaría en la vida real.
    const patch = await c.patch(`/api/equipos/${id}`, {
      serial: 'SERIAL-CORREGIDO',
      ram: '32 GB',
    });
    assert.equal(patch.estado, 200, JSON.stringify(patch.cuerpo));

    const releida = (await c.get(`/api/actas/${actaId}`)).cuerpo as { acta: ActaLeida };
    assert.equal(
      releida.acta.equipos[0].serial,
      `SN-${suite.prefijo}A2`,
      'el acta emitida no puede cambiar porque se corrija el equipo',
    );
    assert.equal(releida.acta.equipos[0].ram, '16 GB');

    // Y el equipo sí cambió: si no, este test pasaría sin probar nada.
    const equipo = (await c.get(`/api/equipos/${id}`)).cuerpo as {
      equipo: { serial: string; ram: string };
    };
    assert.equal(equipo.equipo.serial, 'SERIAL-CORREGIDO');
    assert.equal(equipo.equipo.ram, '32 GB');
  });

  it('la instantánea de la persona también se congela', async () => {
    const id = await equipoAsignado(`${suite.prefijo}A3`);
    await c.patch(`/api/empleados/${empleado}`, { cargo: 'Analista' });

    const emitida = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    const acta = (emitida.cuerpo as { acta: ActaLeida }).acta;
    assert.equal(acta.empleado_cargo, 'Analista');

    // Ascendido después de firmar.
    await c.patch(`/api/empleados/${empleado}`, { cargo: 'Líder de área' });

    const releida = (await c.get(`/api/actas/${acta.id}`)).cuerpo as { acta: ActaLeida };
    assert.equal(releida.acta.empleado_cargo, 'Analista', 'el acta dice el cargo de aquel día');
  });

  it('un acta sobre algo que no ocurrió: 409, y dice por qué', async () => {
    // Equipo disponible, nunca entregado a nadie.
    const r0 = await c.post('/api/equipos', {
      categoria: 'Monitor',
      etiqueta: `${suite.prefijo}NUNCA`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r0.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    assert.equal(r.estado, 409);
    const msg = (r.cuerpo as { error: string }).error;
    assert.match(msg, /no hay ninguna asignación/i, msg);
    assert.match(msg, /primero la operación/i, 'el mensaje dice el orden correcto');
  });

  it('dos actas sobre la misma entrega: la segunda es 409 traducido', async () => {
    const id = await equipoAsignado(`${suite.prefijo}A4`);
    const cuerpo = { tipo: 'Entrega', empleado_id: empleado, equipos: [id] };

    assert.equal((await c.post('/api/actas', cuerpo)).estado, 201);
    const segunda = await c.post('/api/actas', cuerpo);

    assert.equal(segunda.estado, 409);
    const msg = (segunda.cuerpo as { error: string }).error;
    assert.match(msg, /ya hay un acta emitida/i, msg);
    // Sin jerga de Postgres.
    assert.ok(!/constraint|unique|violat|index/i.test(msg), msg);
  });

  it('un acta de Devolución cuelga de la Devolución, no de la Asignación', async () => {
    const id = await equipoAsignado(`${suite.prefijo}A5`);
    assert.equal((await c.post(`/api/equipos/${id}/devolver`, {})).estado, 200);

    const r = await c.post('/api/actas', {
      tipo: 'Devolución',
      empleado_id: empleado,
      equipos: [id],
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));

    const acta = (r.cuerpo as { acta: ActaLeida }).acta;
    const devolucion = (await movimientosDe(id)).find((m) => m.tipo === 'Devolución');
    assert.equal(acta.equipos[0].movimiento_id, devolucion?.id);

    // Y la de entrega del mismo equipo sigue siendo emitible: son dos
    // operaciones distintas y cada una tiene su papel.
    const entrega = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    assert.equal(entrega.estado, 201);
  });

  it('el acta aparece en el listado, con su número de equipos', async () => {
    const r = await c.get(`/api/actas?empleado=${empleado}`);
    assert.equal(r.estado, 200);
    const { actas } = r.cuerpo as {
      actas: { consecutivo: string; equipos: number; empleado_nombre: string }[];
    };
    assert.ok(actas.length >= 5, `esperaba las emitidas arriba, hay ${actas.length}`);
    for (const a of actas) {
      assert.equal(a.equipos, 1);
      assert.ok(a.consecutivo.startsWith(`ACT-${ANIO}-`));
    }
  });
});

// ---------------------------------------------------------------------------
// El consecutivo bajo concurrencia
// ---------------------------------------------------------------------------

describe('actas: el consecutivo no se repite aunque lleguen a la vez', () => {
  const suite = ambito('consec');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  const CUANTAS = 12;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}titular`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /**
   * Doce actas a la vez, cada una sobre su equipo.
   *
   * No es un razonamiento sobre el bloqueo de fila: son doce peticiones HTTP
   * simultáneas por doce conexiones distintas del pool, que es como llegarían
   * de doce pestañas. Si el contador fuera un `max(consecutivo)+1`, aquí
   * saldrían números repetidos, y un acta con número repetido no es un bug de
   * la aplicación: es un problema legal.
   */
  it(`${CUANTAS} peticiones simultáneas dan ${CUANTAS} números distintos y seguidos`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < CUANTAS; i++) {
      const r = await c.post('/api/equipos', {
        categoria: 'Portátil',
        etiqueta: `${suite.prefijo}C${i}`,
        serial: `SN-${suite.prefijo}C${i}`,
        estado: 'Disponible',
        sede_id: sede,
      });
      const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
      creados.push(id);
      ids.push(id);
      await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
      await c.post(`/api/equipos/${id}/devolver`, {});
      await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    }

    // De dónde parte el contador: la base de tests es compartida entre suites
    // y puede traer actas de antes. Sin esta línea, «empieza en 1» sería una
    // suposición que rompe en cuanto otra suite emita un acta primero.
    const base = await consecutivoActual(ANIO);

    // Aquí está el punto: se lanzan todas y DESPUÉS se espera.
    const respuestas = await Promise.all(
      ids.map((id) =>
        c.post('/api/actas', { tipo: 'Entrega', empleado_id: empleado, equipos: [id] }),
      ),
    );

    for (const r of respuestas) {
      assert.equal(r.estado, 201, `una falló: ${r.texto.slice(0, 200)}`);
    }

    const numeros = respuestas
      .map((r) => (r.cuerpo as { acta: ActaLeida }).acta.consecutivo)
      .map((s) => Number(s.slice(-4)));

    // 1. Ninguno repetido. Es lo que un `max(...)+1` rompería.
    assert.equal(new Set(numeros).size, CUANTAS, `hay repetidos: ${numeros.sort().join(', ')}`);

    // 2. Y sin huecos. Es lo que una SEQUENCE no garantiza, y por eso el
    //    contador es una tabla que se deshace con la transacción (D25).
    const esperados = Array.from({ length: CUANTAS }, (_, i) => base + 1 + i);
    assert.deepEqual([...numeros].sort((a, b) => a - b), esperados);

    // 3. El contador quedó donde debe: nada se adelantó ni se quedó atrás.
    assert.equal(await consecutivoActual(ANIO), base + CUANTAS);
  });

  it('un acta que falla no se lleva su número: el siguiente no salta', async () => {
    // Es lo que distingue la tabla de una SEQUENCE, y no se ve mirando el
    // camino feliz. Se provoca un fallo DESPUÉS de que la transacción haya
    // podido pedir número: el equipo del medio no tiene entrega que documentar.
    const antes = await consecutivoActual(ANIO);

    const sinEntrega = await c.post('/api/equipos', {
      categoria: 'Teclado',
      etiqueta: `${suite.prefijo}FALLA`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const idMalo = (sinEntrega.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(idMalo);

    const falla = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [idMalo],
    });
    assert.equal(falla.estado, 409);
    assert.equal(await consecutivoActual(ANIO), antes, 'el fallo no movió el contador');

    // Y la siguiente buena toma el número que le tocaba: sin hueco. Con una
    // SEQUENCE, el acta fallida se habría llevado el suyo y esta saltaría a
    // `antes + 2`.
    const bueno = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}TRASFALLO`,
      serial: `SN-${suite.prefijo}TRASFALLO`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const idBueno = (bueno.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(idBueno);
    assert.equal(
      (await c.post(`/api/equipos/${idBueno}/asignar`, { empleado_id: empleado })).estado,
      200,
    );

    const buena = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [idBueno],
    });
    assert.equal(buena.estado, 201, JSON.stringify(buena.cuerpo));
    const n = Number((buena.cuerpo as { acta: ActaLeida }).acta.consecutivo.slice(-4));
    assert.equal(n, antes + 1, 'el número siguiente es el siguiente, sin hueco');
  });
});
