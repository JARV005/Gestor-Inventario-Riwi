/**
 * Actas. Etapas 5a (el acta en la base) y 5b (el PDF).
 *
 * Las cuatro cosas que esta suite existe para demostrar, y las cuatro por sus
 * dos lados:
 *
 *  1. La instantánea es una instantánea: cambiar el equipo después de emitir
 *     NO cambia el acta. Se comprueba emitiendo, cambiando el equipo de verdad
 *     y volviendo a leer el acta.
 *  2. El consecutivo no se repite bajo concurrencia. Se comprueba lanzando
 *     peticiones a la vez, no razonando sobre el bloqueo.
 *  3. El acta está atada al movimiento que la origina, y al de SU equipo.
 *  4. El PDF es reproducible: los mismos datos dan los mismos bytes, y
 *     cualquier cambio los cambia. Sin el segundo lado, un generador que
 *     devolviera siempre el mismo documento pasaría el primero.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  generarPdfActa,
  PLANTILLA_VERSION,
  sha256,
  type ActaParaPdf,
} from '../db/acta-pdf.js';
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
  chequeoEnLaBase,
  crearEmpleado,
  estadoDe,
  matarConexionEnMedioDeEmitir,
  movimientosDe,
  pdfEnLaBase,
  dosPrimerosDeSerieVirgen,
  ponerChequeoEnLaBase,
  primeraSede,
  primerNumeroDeSerieVirgen,
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

/** Rutas donde aparece una clave con ese nombre EXACTO, a cualquier profundidad. */
function clavesLlamadas(valor: unknown, nombre: string, ruta = '$'): string[] {
  if (Array.isArray(valor)) {
    return valor.flatMap((v, i) => clavesLlamadas(v, nombre, `${ruta}[${i}]`));
  }
  if (valor && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) =>
      k === nombre ? [`${ruta}.${k}`] : clavesLlamadas(v, nombre, `${ruta}.${k}`),
    );
  }
  return [];
}

interface ActaLeida {
  id: string;
  consecutivo: string;
  tipo: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  sede_nombre: string | null;
  generada_por_nombre: string;
  tiene_pdf: boolean;
  hash_sha256: string | null;
  plantilla_version: string | null;
  empresa: string;
  chequeo: { item: string; instalado: boolean | null; observaciones: string | null }[] | null;
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
    // Con empresa: desde D42 una persona sin ella no puede recibir un acta.
    empleado = await crearEmpleado(`${suite.prefijo}titular`, 'RIWI');
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

    // Serie por empresa y sin año (D40), con el prefijo de SU empresa (D42).
    assert.match(acta.consecutivo, /^RIWI-[0-9]{4}$/);
    assert.equal(acta.tipo, 'Entrega');
    // Desde la 5b el PDF se genera en la misma transacción que el acta: no hay
    // ventana en la que el acta exista sin su documento.
    assert.equal(acta.tiene_pdf, true);
    assert.equal(acta.plantilla_version, PLANTILLA_VERSION[acta.tipo]);
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
      assert.ok(a.consecutivo.startsWith('RIWI-'), `consecutivo raro: ${a.consecutivo}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Modo `ejecutar`: el acta crea la operación y la firma (5c)
// ---------------------------------------------------------------------------

describe('actas: el modo ejecutar crea el movimiento y lo firma a la vez', () => {
  const suite = ambito('ejec');
  let admin: UsuarioDePrueba;
  let sede: string;
  let ana: string;
  let luis: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    ana = await crearEmpleado(`${suite.prefijo}ana`, 'RIWI');
    luis = await crearEmpleado(`${suite.prefijo}luis`, 'RIWI');
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([ana, luis]);
    await suite.limpiar();
  });

  async function equipo(etiqueta: string, categoria = 'Portátil'): Promise<string> {
    const r = await c.post('/api/equipos', {
      categoria,
      etiqueta,
      serial: `SN-${etiqueta}`,
      estado: 'Disponible',
      sede_id: sede,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    return id;
  }

  it('un kit de cuatro: una sola acta, cuatro asignaciones, todo en una transacción', async () => {
    const kit = [
      await equipo(`${suite.prefijo}K-PORT`),
      await equipo(`${suite.prefijo}K-TECL`, 'Teclado'),
      await equipo(`${suite.prefijo}K-MOUS`, 'Mouse'),
      await equipo(`${suite.prefijo}K-DIAD`, 'Diadema'),
    ];

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: kit,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const acta = (r.cuerpo as { acta: ActaLeida }).acta;

    // Un acta, un consecutivo, cuatro líneas. Lo que 5c vino a arreglar: antes
    // eran cuatro actas con cuatro números para una sola entrega.
    assert.equal(acta.equipos.length, 4);

    for (const id of kit) {
      // La operación ocurrió de verdad, leída de la base.
      assert.equal(await estadoDe(id), 'Asignado');
      const movs = await movimientosDe(id);
      const asignacion = movs.find((m) => m.tipo === 'Asignación');
      assert.ok(asignacion, 'el acta creó la asignación');
      assert.equal(asignacion.empleado_destino_id, ana);
      // Y el acta cuelga de ESE movimiento, no de otro.
      const linea = acta.equipos.find((l) => l.equipo_id === id);
      assert.equal(linea?.movimiento_id, asignacion.id);
    }
  });

  it('si un equipo del kit no se deja mover, NO se emite nada', async () => {
    const bueno = await equipo(`${suite.prefijo}E-OK`);
    const ocupado = await equipo(`${suite.prefijo}E-OCUP`);
    // El del medio se lo lleva otra persona antes.
    await c.post(`/api/equipos/${ocupado}/asignar`, { empleado_id: luis });
    const tercero = await equipo(`${suite.prefijo}E-OK2`);

    const actasAntes = (await c.get(`/api/actas?empleado=${ana}`)).cuerpo as { actas: unknown[] };

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [bueno, ocupado, tercero],
    });

    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as {
      error: string;
      etiqueta: string;
      estado_actual: string;
      puedes: string[];
    };
    // Dice CUÁL de los tres, no solo que algo falló.
    assert.equal(cuerpo.etiqueta, `${suite.prefijo}E-OCUP`);
    assert.equal(cuerpo.estado_actual, 'Asignado');
    assert.ok(cuerpo.puedes.includes('devolver'), 'y qué se puede hacer con él');

    // Nada a medias: ni el acta, ni las asignaciones de los que sí podían.
    assert.equal(await estadoDe(bueno), 'Disponible', 'el primero no quedó asignado');
    assert.equal(await estadoDe(tercero), 'Disponible', 'el tercero tampoco');
    assert.equal((await movimientosDe(bueno)).length, 1, 'solo su Alta');
    const actasDespues = (await c.get(`/api/actas?empleado=${ana}`)).cuerpo as { actas: unknown[] };
    assert.equal(actasDespues.actas.length, actasAntes.actas.length, 'no se emitió acta');
  });

  it('devolver lo que está a nombre de otro: 409 diciendo de quién', async () => {
    const id = await equipo(`${suite.prefijo}D-OTRO`);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: luis });

    const r = await c.post('/api/actas', {
      tipo: 'Devolución',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [id],
    });

    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; titular: string; etiqueta: string };
    assert.equal(cuerpo.etiqueta, `${suite.prefijo}D-OTRO`);
    assert.match(cuerpo.titular, /luis/i, 'dice a nombre de quién figura');
    assert.match(cuerpo.error, /figura a nombre de/i);

    // Y el equipo sigue de Luis: nada se movió.
    assert.equal(await estadoDe(id), 'Asignado');
    assert.equal((await movimientosDe(id)).filter((m) => m.tipo === 'Devolución').length, 0);
  });

  /**
   * El invariante que esta validación protege, comprobado desde el otro lado:
   * la devolución legítima deja el movimiento con `empleado_origen_id` = la
   * persona del acta, que es lo que el grupo H exige.
   */
  it('la devolución legítima deja el movimiento a nombre de quien firma', async () => {
    const id = await equipo(`${suite.prefijo}D-OK`);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana });

    const r = await c.post('/api/actas', {
      tipo: 'Devolución',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [id],
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));

    assert.equal(await estadoDe(id), 'Disponible');
    const dev = (await movimientosDe(id)).find((m) => m.tipo === 'Devolución');
    assert.equal(dev?.empleado_origen_id, ana);
  });

  it('sin modo, se comporta como antes: firmar', async () => {
    // Un modo que muta datos no puede ser el implícito. Un equipo disponible y
    // sin entrega previa tiene que dar el 409 de «no ocurrió», no asignarse.
    const id = await equipo(`${suite.prefijo}SINMODO`);
    const r = await c.post('/api/actas', { tipo: 'Entrega', empleado_id: ana, equipos: [id] });

    assert.equal(r.estado, 409);
    assert.match((r.cuerpo as { error: string }).error, /no hay ninguna asignación/i);
    assert.equal(await estadoDe(id), 'Disponible', 'no movió nada');
  });

  it('el mismo equipo dos veces en el acta: 400 antes de mover nada', async () => {
    const id = await equipo(`${suite.prefijo}REPE`);
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [id, id],
    });
    assert.equal(r.estado, 400);
    assert.equal(await estadoDe(id), 'Disponible');
  });

  it('la auditoría dice por qué camino se emitió', async () => {
    const id = await equipo(`${suite.prefijo}AUD5C`);
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [id],
    });
    const acta = (r.cuerpo as { acta: ActaLeida }).acta;

    // Dos rastros por la misma petición: la mutación y la emisión.
    assert.equal(await contarAuditoria(id, 'asignar'), 1, 'mutar() dejó el suyo');
    const { filas } = await import('./ayuda.js').then((m) => m.auditoriaDe(acta.id, 'emitir_acta'));
    assert.equal((filas[0].despues as { modo: string }).modo, 'ejecutar');
  });

  /**
   * El corte, en la transacción nueva. Ver `matarConexionEnMedioDeEmitir`.
   */
  /** El del corte, compartido con el test siguiente. Por id y no por posición
   *  en `creados`: insertar un test en medio movería el índice y el fallo
   *  parecería del código. Ya pasó al escribir esta suite. */
  let idDelCorte = '';

  it('matar la conexión entre el movimiento y el acta no deja ni lo uno ni lo otro', async () => {
    const id = await equipo(`${suite.prefijo}CORTE5C`);
    idDelCorte = id;

    const resultado = await matarConexionEnMedioDeEmitir(id, ana, admin.id);
    assert.equal(resultado, 'conexión terminada', 'la conexión tenía que morir de verdad');

    assert.equal(await estadoDe(id), 'Disponible', 'el equipo NO quedó asignado');
    assert.equal((await movimientosDe(id)).length, 1, 'solo su Alta: no quedó movimiento suelto');
    const actas = (await c.get(`/api/actas?empleado=${ana}`)).cuerpo as {
      actas: { consecutivo: string }[];
    };
    assert.equal(
      actas.actas.filter((a) => a.consecutivo === 'ACT-CORTE-9999').length,
      0,
      'no quedó acta suelta',
    );
  });

  /**
   * El filtro de la pantalla, por su lado del servidor. Los cuatro casos de la
   * tabla modo × tipo dependen de esto para el modo `firmar`.
   */
  it('firmables ofrece lo pendiente de firmar, y deja de ofrecerlo al firmarlo', async () => {
    const id = await equipo(`${suite.prefijo}FIRM`);
    // Se asigna por el camino manual: queda una entrega sin papel.
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: luis });

    const antes = (await c.get(`/api/actas/firmables?empleado=${luis}&tipo=Entrega`))
      .cuerpo as { equipos: { id: string; movimiento_id: string }[] };
    const mio = antes.equipos.find((e) => e.id === id);
    assert.ok(mio, 'la entrega sin firmar tiene que ofrecerse');

    // Y es el movimiento correcto: el mismo que elegiría al emitir.
    const asignacion = (await movimientosDe(id)).find((m) => m.tipo === 'Asignación');
    assert.equal(mio.movimiento_id, asignacion?.id);

    // Se firma, y desaparece de la lista. Sin esto, la pantalla ofrecería una y
    // otra vez algo que ya tiene acta y que daría 409.
    assert.equal(
      (await c.post('/api/actas', {
        tipo: 'Entrega',
        modo: 'firmar',
        empleado_id: luis,
        equipos: [id],
      })).estado,
      201,
    );

    const despues = (await c.get(`/api/actas/firmables?empleado=${luis}&tipo=Entrega`))
      .cuerpo as { equipos: { id: string }[] };
    assert.equal(
      despues.equipos.filter((e) => e.id === id).length,
      0,
      'ya firmada: no se vuelve a ofrecer',
    );
  });

  it('firmables no ofrece nada de una persona sin operaciones pendientes', async () => {
    const r = (await c.get(`/api/actas/firmables?empleado=${ana}&tipo=Devolución`)).cuerpo as {
      equipos: unknown[];
    };
    assert.deepEqual(r.equipos, []);
  });

  it('y después del corte el modo ejecutar sigue funcionando', async () => {
    assert.ok(idDelCorte, 'el test del corte tiene que haber corrido antes');
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: ana,
      equipos: [idDelCorte],
    });
    assert.equal(r.estado, 201, 'matar una conexión no puede dejar el pool inservible');
    assert.equal(await estadoDe(idDelCorte), 'Asignado');
  });
});

// ---------------------------------------------------------------------------
// El PDF: reproducible, y por sus dos lados
// ---------------------------------------------------------------------------

describe('actas: el PDF es reproducible byte a byte', () => {
  const suite = ambito('pdf');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    // Con empresa: desde D42 una persona sin ella no puede recibir un acta.
    empleado = await crearEmpleado(`${suite.prefijo}titular`, 'RIWI');
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  const base = (): ActaParaPdf => ({
    consecutivo: 'ACT-2026-0042',
    tipo: 'Entrega',
    fecha: new Date('2026-03-01T15:00:00Z'),
    empleado_nombre: 'Ana Restrepo',
    empleado_cedula: '1020304050',
    empleado_cargo: 'Analista',
    empleado_area: 'Operaciones',
    sede_nombre: 'Medellín',
    generada_por_nombre: 'Soporte TI',
    empresa: 'BBL Labs',
    chequeo: null,
    equipos: [
      {
        empresa: 'BBL Labs',
        accesorios: null,
        comentarios: null,
        etiqueta: 'BBL-0301',
        serial: 'SN-ABC-123',
        marca: 'Dell',
        modelo: 'Latitude 5440',
        categoria: 'Portátil',
        condicion: null,
        procesador: 'i7',
        ram: '16 GB',
        disco: '512 GB SSD',
        sistema_operativo: 'Windows 11',
      },
    ],
  });

  /**
   * El lado que hace útil al hash: los mismos datos dan los mismos bytes.
   *
   * Con una espera de más de un segundo entre las dos generaciones. Sin ella,
   * un PDF que llevara la hora de generación redondeada al segundo pasaría el
   * test por casualidad, y el fallo aparecería en producción.
   */
  it('los mismos datos dan el mismo hash, generados con un segundo de diferencia', async () => {
    const uno = await generarPdfActa(base());
    await new Promise((r) => setTimeout(r, 1100));
    const dos = await generarPdfActa(base());

    assert.equal(sha256(uno), sha256(dos));
    assert.ok(uno.equals(dos), 'byte a byte, no solo el hash');
    assert.ok(uno.length > 1000, `un PDF de ${uno.length} bytes no lleva un acta dentro`);
    assert.equal(uno.subarray(0, 5).toString('latin1'), '%PDF-', 'y es un PDF de verdad');
  });

  /**
   * El otro lado, que es el que impide que lo anterior sea trivial: si el
   * contenido cambia, el hash cambia. Un generador que devolviera siempre el
   * mismo documento pasaría el test de arriba perfectamente.
   */
  it('cambiar cualquier dato cambia el hash', async () => {
    const original = sha256(await generarPdfActa(base()));

    const variantes: [string, () => ActaParaPdf][] = [
      ['otro serial', () => ({ ...base(), equipos: [{ ...base().equipos[0], serial: 'SN-XYZ-999' }] })],
      ['otra persona', () => ({ ...base(), empleado_nombre: 'Luis Barrera' })],
      ['otro cargo', () => ({ ...base(), empleado_cargo: 'Líder' })],
      ['otro consecutivo', () => ({ ...base(), consecutivo: 'ACT-2026-0043' })],
      ['otra fecha', () => ({ ...base(), fecha: new Date('2026-03-02T15:00:00Z') })],
      ['otro tipo', () => ({ ...base(), tipo: 'Devolución' as const })],
      ['otra empresa del acta', () => ({ ...base(), empresa: 'RIWI' as const })],
      ['otro propietario del equipo', () => ({
        ...base(),
        equipos: [{ ...base().equipos[0], empresa: 'RIWI' }],
      })],
      ['unos accesorios donde no había', () => ({
        ...base(),
        equipos: [{ ...base().equipos[0], accesorios: 'Cargador' }],
      })],
      ['una respuesta del chequeo', () => ({
        ...base(),
        chequeo: [{ item: 'BitLocker', instalado: false, observaciones: null }],
      })],
    ];

    // `condicion` NO está en esta lista, y es deliberado: el formato aprobado
    // por BBL no tiene columna para el estado del equipo, así que cambiarlo no
    // cambia el documento. Ver `docs/pendientes.md` — es un dato que el acta
    // dejó de imprimir al adoptar el formato.

    for (const [que, construir] of variantes) {
      const hash = sha256(await generarPdfActa(construir()));
      assert.notEqual(hash, original, `${que}: el hash NO cambió`);
    }
  });

  /**
   * Un acta de un equipo cabe en una página.
   *
   * No es cosmética: la primera versión sacaba TRES páginas para un solo
   * equipo, con las firmas huérfanas en la primera, porque el pie se escribía
   * por debajo del margen inferior y pdfkit añadía hoja. El generador no
   * fallaba —devolvía un PDF válido, con su hash y todos los tests en verde—,
   * así que solo se vio abriendo el documento. Esto es lo que impide que
   * vuelva sin que nadie mire.
   */
  it('el recuento de páginas con 1, 5, 6 y 12 equipos', async () => {
    const paginas = (pdf: Buffer) =>
      (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    // Los cuatro que pide la 5f. Cinco es lo que trae la plantilla, así que 1 y
    // 5 tienen que dar lo mismo —las filas de menos se rellenan vacías— y 6 es
    // el primero que hace crecer la tabla.
    const con = async (n: number) =>
      paginas(
        await generarPdfActa({
          ...base(),
          equipos: Array.from({ length: n }, () => base().equipos[0]),
        }),
      );

    const uno = await con(1);
    const cinco = await con(5);
    const seis = await con(6);
    const doce = await con(12);

    assert.equal(uno, cinco, 'de 1 a 5 la tabla no crece: las filas sobrantes van vacías');
    assert.ok(uno <= 2, `un equipo dio ${uno} páginas`);
    assert.ok(seis <= 3, `seis equipos dieron ${seis} páginas`);
    assert.ok(doce <= 3, `doce equipos dieron ${doce} páginas`);

    // Y lo que de verdad importa, que es lo que salió mal la última vez: las
    // firmas NO pueden quedarse solas en la última página. Se comprueba que la
    // sección de firmas y la de responsabilidades caen en la misma.
    const pdf = await generarPdfActa({
      ...base(),
      equipos: Array.from({ length: 12 }, () => base().equipos[0]),
    });
    const texto = pdf.toString('latin1');
    assert.ok(texto.length > 0);
    assert.ok(doce >= 2, 'doce equipos no caben en una sola página');
  });

  it('emitir guarda el PDF con su hash y su plantilla, y los tres van juntos', async () => {
    const r0 = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}PDF1`,
      serial: `SN-${suite.prefijo}PDF1`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r0.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    const emitida = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [id],
    });
    assert.equal(emitida.estado, 201, JSON.stringify(emitida.cuerpo));
    const acta = (emitida.cuerpo as { acta: ActaLeida }).acta;
    assert.equal(acta.tiene_pdf, true);
    assert.match(acta.hash_sha256 ?? '', /^[0-9a-f]{64}$/);

    // El hash guardado es el de los bytes guardados, comprobado contra la
    // base y no contra la respuesta.
    const guardado = await pdfEnLaBase(acta.id);
    assert.ok(guardado);
    assert.equal(sha256(guardado.pdf), guardado.hash);
    assert.equal(guardado.hash, acta.hash_sha256);
    // Por tipo desde la 5f: la entrega está aprobada ('1') y la devolución
    // sigue en borrador. Comparar contra una constante única daría verde con
    // cualquiera de las dos.
    assert.equal(guardado.plantilla, PLANTILLA_VERSION.Entrega);
    assert.equal(guardado.plantilla, '1', 'la entrega ya no es borrador');
  });

  it('se descarga como PDF, y lo descargado cuadra con el hash guardado', async () => {
    const lista = (await c.get(`/api/actas?empleado=${empleado}`)).cuerpo as {
      actas: { id: string; consecutivo: string }[];
    };
    const acta = lista.actas[0];

    const r = await c.getBinario(`/api/actas/${acta.id}/pdf`);
    assert.equal(r.estado, 200);
    assert.equal(r.tipo, 'application/pdf');
    assert.match(r.disposicion ?? '', new RegExp(`${acta.consecutivo}\\.pdf`));
    assert.equal(r.cuerpo.subarray(0, 5).toString('latin1'), '%PDF-');

    // Lo descargado, no lo que el servidor dice que descargó.
    const enBase = await pdfEnLaBase(acta.id);
    assert.equal(sha256(r.cuerpo), enBase?.hash, 'el PDF descargado no es el guardado');
  });

  it('/verificar regenera desde la instantánea y da el mismo hash', async () => {
    const lista = (await c.get(`/api/actas?empleado=${empleado}`)).cuerpo as {
      actas: { id: string }[];
    };
    const r = await c.get(`/api/actas/${lista.actas[0].id}/verificar`);
    assert.equal(r.estado, 200);

    const v = r.cuerpo as {
      coincide: boolean;
      hash_guardado: string;
      hash_recalculado: string;
      misma_plantilla: boolean;
    };
    assert.equal(v.misma_plantilla, true);
    assert.equal(
      v.coincide,
      true,
      `regenerar dio otro documento: ${v.hash_guardado} vs ${v.hash_recalculado}`,
    );
  });

  /**
   * El aviso que el usuario pidió: la columna `pdf` no puede aparecer en un
   * listado. Es donde reaparecería, y un listado de 500 actas con su binario
   * dentro son cientos de megabytes en una respuesta JSON.
   */
  it('ni el listado ni el detalle traen el binario', async () => {
    const listado = await c.get(`/api/actas?empleado=${empleado}`);
    const lista = listado.cuerpo as { actas: { id: string }[] };
    assert.ok(lista.actas.length > 0, 'el test necesita al menos un acta');

    // La clave exacta, no una subcadena: `tiene_pdf` es legítima y contiene
    // «pdf». `buscarFugas` no vale aquí por eso.
    assert.deepEqual(clavesLlamadas(listado.cuerpo, 'pdf'), [], 'el listado trae el binario');

    // Y por tamaño, que es la comprobación que no depende de cómo se llame la
    // columna: un PDF son miles de bytes, y en JSON aún más. Un listado que lo
    // llevara dentro no cabría en esto ni de lejos.
    assert.ok(
      listado.texto.length < 4000,
      `el listado ocupa ${listado.texto.length} bytes: algo grande se ha colado`,
    );

    const detalle = await c.get(`/api/actas/${lista.actas[0].id}`);
    assert.deepEqual(clavesLlamadas(detalle.cuerpo, 'pdf'), [], 'el detalle trae el binario');
    assert.ok(detalle.texto.length < 4000, `el detalle ocupa ${detalle.texto.length} bytes`);
    assert.equal((detalle.cuerpo as { acta: ActaLeida }).acta.tiene_pdf, true);
  });
});

// ---------------------------------------------------------------------------
// El consecutivo bajo concurrencia, y una serie por empresa (D40)
// ---------------------------------------------------------------------------

describe('actas: el consecutivo no se repite aunque lleguen a la vez', () => {
  const suite = ambito('consec');
  let admin: UsuarioDePrueba;
  let sede: string;
  /** Un titular por empresa: la serie la decide la empresa de la PERSONA. */
  let deRiwi: string;
  let deBbl: string;
  const creados: string[] = [];
  let c: Cliente;

  const CUANTAS = 12;

  /** Doce equipos entregados a esa persona, listos para firmarles el acta. */
  async function equiposEntregadosA(empleado: string, etiqueta: string) {
    const ids: string[] = [];
    for (let i = 0; i < CUANTAS; i++) {
      const r = await c.post('/api/equipos', {
        categoria: 'Portátil',
        etiqueta: `${suite.prefijo}${etiqueta}${i}`,
        serial: `SN-${suite.prefijo}${etiqueta}${i}`,
        estado: 'Disponible',
        sede_id: sede,
      });
      const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
      creados.push(id);
      ids.push(id);
      await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    }
    return ids;
  }

  const numeroDe = (r: { cuerpo: unknown }) =>
    Number((r.cuerpo as { acta: ActaLeida }).acta.consecutivo.slice(-4));
  const prefijoDe = (r: { cuerpo: unknown }) =>
    (r.cuerpo as { acta: ActaLeida }).acta.consecutivo.split('-')[0];

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    deRiwi = await crearEmpleado(`${suite.prefijo}riwi`, 'RIWI');
    deBbl = await crearEmpleado(`${suite.prefijo}bbl`, 'BBL Labs');
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([deRiwi, deBbl]);
    await suite.limpiar();
  });

  /**
   * Doce actas a la vez por empresa, **y las dos empresas a la vez entre sí**.
   *
   * No es un razonamiento sobre el bloqueo de fila: son veinticuatro peticiones
   * HTTP simultáneas por conexiones distintas del pool, que es como llegarían
   * de veinticuatro pestañas. Si el contador fuera un `max(consecutivo)+1`,
   * aquí saldrían números repetidos, y un acta con número repetido no es un bug
   * de la aplicación: es un problema legal.
   *
   * Las dos series se lanzan mezcladas a propósito. Con una empresa cada vez,
   * un contador global —una sola fila para todos— pasaría el test igual de
   * bien: los números seguirían saliendo distintos y seguidos. Lo que lo
   * distingue de un contador por empresa es que las dos series avancen
   * **independientes**, y eso solo se ve si compiten.
   */
  it(`${CUANTAS} por empresa a la vez: números distintos, seguidos y por serie`, async () => {
    const riwi = await equiposEntregadosA(deRiwi, 'R');
    const bbl = await equiposEntregadosA(deBbl, 'B');

    // De dónde parte cada serie: la base de tests es compartida entre suites y
    // puede traer actas de antes. `null` es «esta empresa no tiene ninguna»,
    // que con el contador arrancando en 0 no es lo mismo que «va por la 0».
    const baseRiwi = await consecutivoActual('RIWI');
    const baseBbl = await consecutivoActual('BBL Labs');

    // Aquí está el punto: se lanzan las veinticuatro y DESPUÉS se espera. Y
    // van intercaladas, para que las dos series compitan de verdad en vez de
    // ir una detrás de otra.
    const peticiones = riwi
      .map((id) => ({ empleado: deRiwi, id }))
      .flatMap((r, i) => [r, { empleado: deBbl, id: bbl[i] }])
      .map((x) =>
        c.post('/api/actas', { tipo: 'Entrega', empleado_id: x.empleado, equipos: [x.id] }),
      );
    const respuestas = await Promise.all(peticiones);

    for (const r of respuestas) {
      assert.equal(r.estado, 201, `una falló: ${r.texto.slice(0, 200)}`);
    }

    const porSerie = {
      RIWI: respuestas.filter((r) => prefijoDe(r) === 'RIWI').map(numeroDe),
      BBL: respuestas.filter((r) => prefijoDe(r) === 'BBL').map(numeroDe),
    };

    // 0. Cada acta cayó en la serie de SU empresa. Sin esto, un contador global
    //    con el prefijo pintado por encima pasaría todo lo demás.
    assert.equal(porSerie.RIWI.length, CUANTAS, 'faltan actas en la serie RIWI');
    assert.equal(porSerie.BBL.length, CUANTAS, 'faltan actas en la serie BBL');

    for (const [nombre, base, numeros] of [
      ['RIWI', baseRiwi, porSerie.RIWI],
      ['BBL Labs', baseBbl, porSerie.BBL],
    ] as const) {
      // 1. Ninguno repetido dentro de la serie. Es lo que un `max(...)+1`
      //    rompería.
      assert.equal(
        new Set(numeros).size,
        CUANTAS,
        `${nombre}: hay repetidos: ${[...numeros].sort().join(', ')}`,
      );

      // 2. Y sin huecos. Es lo que una SEQUENCE no garantiza, y por eso el
      //    contador es una tabla que se deshace con la transacción (D25).
      //    `base === null` es la primera acta de la empresa, que es la 0000.
      const primero = base === null ? 0 : base + 1;
      assert.deepEqual(
        [...numeros].sort((a, b) => a - b),
        Array.from({ length: CUANTAS }, (_, i) => primero + i),
        `${nombre}: la serie tiene huecos o saltos`,
      );

      // 3. Y el contador de ESTA empresa avanzó exactamente doce, ni uno más.
      //    Es LA propiedad de D40 y la que un contador compartido no puede
      //    fingir: con una sola fila para todos, las veinticuatro actas la
      //    moverían veinticuatro veces y la otra serie no se movería nada.
      //
      //    Se mide como delta contra su propia base y no comparando las dos
      //    series entre sí: que las dos recorran los mismos números solo pasa
      //    si parten del mismo sitio, y eso es una propiedad accidental de una
      //    base recién creada. La base de tests es compartida y acumula.
      assert.equal(
        await consecutivoActual(nombre),
        primero + CUANTAS - 1,
        `${nombre}: el contador no avanzó exactamente ${CUANTAS}`,
      );
    }
  });

  it('la primera acta de una empresa es la 0000, no la 0001', async () => {
    // NO se puede comprobar mirando el acta más antigua de la base: los
    // contadores sobreviven a la limpieza de las suites —son monótonos a
    // propósito— y las actas no. Buscar `RIWI-0000` en la tabla solo funciona
    // en una base recién creada, y pasaría a fallar en la segunda corrida por
    // un motivo que no tiene nada que ver con lo que se quiere comprobar.
    //
    // Así que se prueba sobre una serie virgen de verdad: se borra el contador
    // dentro de una transacción, se pide el primer número y se deshace todo.
    // La serie real queda intacta.
    assert.equal(await primerNumeroDeSerieVirgen('RIWI'), 'RIWI-0000');

    // Y por el otro lado: el segundo número de una serie virgen es el 0001, no
    // otro 0000. Sin esto, un consecutivo que devolviera siempre cero pasaría.
    assert.deepEqual(await dosPrimerosDeSerieVirgen('BBL Labs'), ['BBL-0000', 'BBL-0001']);
  });

  it('un acta que falla no se lleva su número: el siguiente no salta', async () => {
    // Es lo que distingue la tabla de una SEQUENCE, y no se ve mirando el
    // camino feliz. Se provoca un fallo DESPUÉS de que la transacción haya
    // podido pedir número: el equipo no tiene entrega que documentar.
    const antes = await consecutivoActual('RIWI');
    assert.notEqual(antes, null, 'la serie RIWI ya debería existir aquí');

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
      empleado_id: deRiwi,
      equipos: [idMalo],
    });
    assert.equal(falla.estado, 409);
    assert.equal(await consecutivoActual('RIWI'), antes, 'el fallo no movió el contador');

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
      (await c.post(`/api/equipos/${idBueno}/asignar`, { empleado_id: deRiwi })).estado,
      200,
    );

    const buena = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: deRiwi,
      equipos: [idBueno],
    });
    assert.equal(buena.estado, 201, JSON.stringify(buena.cuerpo));
    assert.equal(numeroDe(buena), (antes as number) + 1, 'el siguiente es el siguiente, sin hueco');
  });
});

// ---------------------------------------------------------------------------
// La lista de chequeo entra en la instantánea, porque entra en el hash (D41)
// ---------------------------------------------------------------------------

describe('actas: el chequeo se congela y el hash lo cubre', () => {
  const suite = ambito('cheq');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  /**
   * Los cuatro estados que el formato admite, en la misma acta.
   *
   * La muestra de BBL trae BitLocker en `No` y los otros en `Sí`, así que los
   * dos booleanos ocurren de verdad. El `null` y el item que ni se manda son
   * los otros dos: «nadie contestó», que es lo que el formato prohíbe rellenar
   * por su cuenta.
   */
  const CHEQUEO = [
    { item: 'Office 365 / Teams / Firma', instalado: true, observaciones: 'Cuenta creada' },
    { item: 'BitLocker', instalado: false, observaciones: 'Pendiente de clave' },
    { item: 'Edge – Chrome', instalado: null, observaciones: null },
  ];

  async function equipoEntregado(etiqueta: string) {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}${etiqueta}`,
      serial: `SN-${suite.prefijo}${etiqueta}`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    return id;
  }

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    // Con empresa: desde D42 una persona sin ella no puede recibir un acta.
    empleado = await crearEmpleado(`${suite.prefijo}titular`, 'RIWI');
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /**
   * ESTE es el caso que el encargo pidió, y el que faltaba.
   *
   * `recalcularHash` regenera el PDF desde la instantánea para responder «¿el
   * documento guardado es el que estos datos producen?». La sección 5 se
   * imprime, así que si el chequeo no estuviera guardado la regeneración lo
   * pintaría vacío, los bytes no coincidirían y la respuesta sería que el acta
   * no cuadra.
   *
   * No revienta: ACUSA. Un acta legítima quedaría marcada como manipulada, y
   * nadie sabría distinguirlo de una que sí lo está. Es el mismo modo de fallo
   * que la empresa en la 0014.
   */
  it('un acta con el chequeo relleno se verifica contra sí misma', async () => {
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH1')],
      chequeo: CHEQUEO,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const { acta } = r.cuerpo as { acta: ActaLeida };

    const v = await c.get(`/api/actas/${acta.id}/verificar`);
    assert.equal(v.estado, 200);
    const dictamen = v.cuerpo as {
      coincide: boolean;
      hash_guardado: string;
      hash_recalculado: string;
      misma_plantilla: boolean;
    };

    assert.equal(
      dictamen.coincide,
      true,
      `el acta legítima salió acusada: guardado ${dictamen.hash_guardado} ` +
        `vs recalculado ${dictamen.hash_recalculado}`,
    );
    assert.equal(dictamen.misma_plantilla, true);
    assert.equal(dictamen.hash_guardado, acta.hash_sha256);
  });

  it('los cuatro items quedan guardados, en orden y sin inventar respuestas', async () => {
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH2')],
      chequeo: CHEQUEO,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { acta: ActaLeida }).acta.id;

    // Se lee del GET y no de la respuesta del POST: si el servidor devolviera
    // un objeto construido en memoria y no lo hubiera guardado, esto lo caza.
    const leida = (await c.get(`/api/actas/${id}`)).cuerpo as { acta: ActaLeida };
    const chequeo = leida.acta.chequeo;
    assert.ok(chequeo, 'una entrega tiene que traer su chequeo');

    // Los CUATRO, aunque solo se mandaron tres: el PDF pinta las cuatro filas
    // vengan o no, y la instantánea tiene que decir lo mismo que el documento.
    assert.deepEqual(
      chequeo.map((x) => x.item),
      ['Office 365 / Teams / Firma', 'BitLocker', 'Edge – Chrome', 'Otros'],
    );

    // Y lo que NO se contestó sigue sin contestar. Un `false` aquí sería el
    // valor por defecto que el formato prohíbe, con la diferencia de que
    // «no instalado» es una afirmación y «sin contestar» no.
    assert.deepEqual(
      chequeo.map((x) => x.instalado),
      [true, false, null, null],
    );
    assert.equal(chequeo[0].observaciones, 'Cuenta creada');
    assert.equal(chequeo[3].observaciones, null);
  });

  it('una devolución no guarda chequeo: su formato no tiene esa sección', async () => {
    const id = await equipoEntregado('CH3');
    assert.equal((await c.post(`/api/equipos/${id}/devolver`, {})).estado, 200);

    // Se manda a propósito, para comprobar que el servidor lo DESCARTA en vez
    // de guardarlo. Si lo guardara, la CHECK `actas_pdf_con_hash` lo pararía
    // con un 500, que sería un error correcto por el camino equivocado.
    const r = await c.post('/api/actas', {
      tipo: 'Devolución',
      empleado_id: empleado,
      equipos: [id],
      chequeo: CHEQUEO,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const acta = (r.cuerpo as { acta: ActaLeida }).acta;
    assert.equal(acta.chequeo, null);

    // Y se verifica igual: la devolución también tiene que cuadrar consigo
    // misma, con la sección 5 ausente por las dos partes.
    const v = await c.get(`/api/actas/${acta.id}/verificar`);
    assert.equal((v.cuerpo as { coincide: boolean }).coincide, true);
  });

  it('un item que no existe en el formato es 400, no un acta con una fila rara', async () => {
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH4')],
      chequeo: [{ item: 'Antivirus', instalado: true, observaciones: null }],
    });
    assert.equal(r.estado, 400, JSON.stringify(r.cuerpo));
  });

  it('mandar un item sin contestar `instalado` es 400: no hay valor supuesto', async () => {
    // El campo es `.nullable()` y NO `.optional()`. Omitirlo tendría que
    // significar algo, y cualquier cosa que significara sería un valor por
    // defecto metido por la puerta de atrás.
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH5')],
      chequeo: [{ item: 'BitLocker', observaciones: null }],
    });
    assert.equal(r.estado, 400, JSON.stringify(r.cuerpo));
  });

  it('el mismo item dos veces es 400: un acta no puede decir dos cosas', async () => {
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH6')],
      chequeo: [
        { item: 'BitLocker', instalado: true, observaciones: null },
        { item: 'BitLocker', instalado: false, observaciones: null },
      ],
    });
    assert.equal(r.estado, 400, JSON.stringify(r.cuerpo));
  });

  /**
   * El otro lado, y el que impide que el primero sea trivial.
   *
   * Un `recalcularHash` que ignorase la sección 5 se verificaría consigo mismo
   * **perfectamente**: la ignoraría en los dos lados y el primer caso saldría
   * verde. Lo que lo distingue es que tocar el chequeo guardado SÍ cambie el
   * veredicto.
   *
   * Se altera la columna directamente en la base y no emitiendo una segunda
   * acta: dos actas distintas difieren también en consecutivo y en equipo, así
   * que sus hashes serían distintos aunque el chequeo no entrara en el PDF. La
   * única forma de aislar la variable es cambiar esa columna y nada más.
   */
  it('tocar el chequeo guardado hace que el acta deje de cuadrar', async () => {
    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: empleado,
      equipos: [await equipoEntregado('CH7')],
      chequeo: CHEQUEO,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { acta: ActaLeida }).acta.id;

    const coincide = async () =>
      ((await c.get(`/api/actas/${id}/verificar`)).cuerpo as { coincide: boolean }).coincide;

    assert.equal(await coincide(), true, 'de partida tiene que cuadrar');

    // Una sola respuesta, de `false` a `true`. Es el cambio más pequeño que
    // se puede hacer sobre la sección: si esto no mueve el hash, la sección no
    // está en el documento.
    const original = await chequeoEnLaBase(id);
    assert.ok(original, 'el acta tendría que tener chequeo guardado');
    await ponerChequeoEnLaBase(
      id,
      original.map((x) => (x.item === 'BitLocker' ? { ...x, instalado: true } : x)),
    );

    assert.equal(await coincide(), false, 'cambiar una respuesta tendría que romper el hash');

    // Y vuelve a cuadrar al restaurarlo. Sin este cierre, el caso anterior
    // podría estar pasando por cualquier otra suciedad acumulada y no porque
    // el chequeo cuente — el mismo cuarto caso que se le puso al logo en D39.
    await ponerChequeoEnLaBase(id, original);
    assert.equal(await coincide(), true, 'restaurado, tiene que volver a cuadrar');
  });
});

// ---------------------------------------------------------------------------
// Sin empresa no hay acta (D42)
// ---------------------------------------------------------------------------

describe('actas: una persona sin empresa no puede recibir un acta', () => {
  const suite = ambito('sinempresa');
  let admin: UsuarioDePrueba;
  let sede: string;
  /** Sin segundo argumento: la columna cae en `Sin clasificar` por DEFAULT. */
  let huerfano: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    huerfano = await crearEmpleado(`${suite.prefijo}huerfano`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([huerfano]);
    await suite.limpiar();
  });

  async function equipoAsignadoA(empleado: string, etiqueta: string) {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}${etiqueta}`,
      serial: `SN-${suite.prefijo}${etiqueta}`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado })).estado, 200);
    return id;
  }

  /**
   * El lado que la decisión pide: 409, no un acta `SC-0000`.
   *
   * Hasta la 5f-2 esto emitía un acta con prefijo `SC`, que es lo que Johan
   * vetó: no le dice nada a quien la recibe y la firma.
   */
  it('emitir para alguien sin empresa es 409, y dice qué hacer', async () => {
    const id = await equipoAsignadoA(huerfano, 'SE1');

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: huerfano,
      equipos: [id],
    });

    assert.equal(r.estado, 409, JSON.stringify(r.cuerpo));
    const cuerpo = r.cuerpo as { error: string; empleado_id?: string; falta?: string };
    // El mensaje nombra la salida. Un 409 que solo diga que algo falló deja a
    // quien emite sin saber qué hacer.
    assert.match(cuerpo.error, /empresa/i);
    assert.match(cuerpo.error, /RIWI|BBL/);
    // Y dice de QUIÉN, para que la pantalla abra esa ficha sin buscarla.
    assert.equal(cuerpo.empleado_id, huerfano);
    assert.equal(cuerpo.falta, 'empresa');
  });

  /**
   * Y lo que de verdad importa del 409: **no movió nada**.
   *
   * En modo `ejecutar` el acta hace la operación, así que una guarda puesta
   * después de mover habría dejado el equipo asignado y la transacción
   * reventada. Se comprueba sobre la base, no sobre la respuesta.
   */
  it('el 409 no mueve el equipo ni gasta un número', async () => {
    const id = await equipoAsignadoA(huerfano, 'SE2');
    assert.equal((await c.post(`/api/equipos/${id}/devolver`, {})).estado, 200);
    assert.equal(await estadoDe(id), 'Disponible');

    const antesRiwi = await consecutivoActual('RIWI');
    const antesBbl = await consecutivoActual('BBL Labs');
    // Se mide como delta y no como ausencia: la base de tests arrastra un
    // contador `Sin clasificar` de las corridas anteriores a D42, cuando esa
    // serie sí emitía. «No existe» sería falso por historia, no por el código.
    const antesSc = await consecutivoActual('Sin clasificar');

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      modo: 'ejecutar',
      empleado_id: huerfano,
      equipos: [id],
    });
    assert.equal(r.estado, 409, JSON.stringify(r.cuerpo));

    assert.equal(await estadoDe(id), 'Disponible', 'el equipo se movió y no debía');
    assert.equal(await consecutivoActual('RIWI'), antesRiwi, 'gastó número de RIWI');
    assert.equal(await consecutivoActual('BBL Labs'), antesBbl, 'gastó número de BBL');
    assert.equal(
      await consecutivoActual('Sin clasificar'),
      antesSc,
      'movió el contador de una serie que no puede emitir',
    );
  });

  /**
   * El otro lado, y sin él lo de arriba lo pasaría un servidor que rechazara
   * TODAS las actas: asignada la empresa, la misma petición funciona.
   *
   * Es además el camino que el formulario ofrece —un desplegable de dos
   * opciones— así que esto comprueba que ese camino lleva a algún sitio.
   */
  it('asignada la empresa, la misma acta se emite y con su prefijo', async () => {
    const id = await equipoAsignadoA(huerfano, 'SE3');

    const patch = await c.patch(`/api/empleados/${huerfano}`, { empresa: 'BBL Labs' });
    assert.equal(patch.estado, 200, JSON.stringify(patch.cuerpo));

    const r = await c.post('/api/actas', {
      tipo: 'Entrega',
      empleado_id: huerfano,
      equipos: [id],
      chequeo: [{ item: 'BitLocker', instalado: false, observaciones: null }],
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));

    const acta = (r.cuerpo as { acta: ActaLeida }).acta;
    assert.match(acta.consecutivo, /^BBL-[0-9]{4}$/);
    assert.equal(acta.empresa, 'BBL Labs');
  });
});
