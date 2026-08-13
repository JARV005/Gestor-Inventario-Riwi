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
  crearEmpleado,
  estadoDe,
  matarConexionEnMedioDeEmitir,
  movimientosDe,
  pdfEnLaBase,
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
    // Desde la 5b el PDF se genera en la misma transacción que el acta: no hay
    // ventana en la que el acta exista sin su documento.
    assert.equal(acta.tiene_pdf, true);
    assert.equal(acta.plantilla_version, PLANTILLA_VERSION);
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
    ana = await crearEmpleado(`${suite.prefijo}ana`);
    luis = await crearEmpleado(`${suite.prefijo}luis`);
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
    empleado = await crearEmpleado(`${suite.prefijo}titular`);
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
    equipos: [
      {
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
      ['una condición donde no había', () => ({
        ...base(),
        equipos: [{ ...base().equipos[0], condicion: 'Usado' }],
      })],
    ];

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
  it('un acta de un equipo cabe en una página, y ocho no la revientan', async () => {
    const paginas = (pdf: Buffer) =>
      (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    assert.equal(paginas(await generarPdfActa(base())), 1, 'un equipo, una página');

    const cuatro = { ...base(), equipos: Array.from({ length: 4 }, () => base().equipos[0]) };
    assert.equal(paginas(await generarPdfActa(cuatro)), 1, 'cuatro equipos siguen cabiendo');

    const ocho = { ...base(), equipos: Array.from({ length: 8 }, () => base().equipos[0]) };
    const n = paginas(await generarPdfActa(ocho));
    assert.ok(n >= 2 && n <= 3, `ocho equipos dieron ${n} páginas`);
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
    assert.equal(guardado.plantilla, PLANTILLA_VERSION);
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
