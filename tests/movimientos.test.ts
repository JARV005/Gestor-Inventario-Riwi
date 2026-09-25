/**
 * Las mutaciones de estado, el historial y la atomicidad. Etapa 5, más las que
 * añadieron la 5d (mantenimiento) y la 5e (préstamos y reasignar).
 *
 * El caso que da nombre a esta suite es el último: **matar la conexión entre
 * el UPDATE de `equipos` y el INSERT de `movimientos`**, de verdad y no con un
 * mock. Un mock comprueba que el mock se llamó; lo que hay que comprobar es
 * que Postgres deshace la transacción cuando el cliente desaparece a mitad, y
 * eso solo lo demuestra Postgres.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  ambito,
  arrancar,
  borrarEmpleados,
  borrarEquipos,
  Cliente,
  comprobarBaseDeTest,
  contarAuditoria,
  crearEmpleado,
  estadoDe,
  matarConexionEnMedioDeAsignar,
  matarConexionEnMedioDeConfirmar,
  marcarEquipo,
  motivosDe,
  movimientosDe,
  nombreDeSede,
  primeraSede,
  sedeDe,
  segundaSede,
  trasladoAbiertoDe,
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

/** Crea un equipo por la API y devuelve su id. */
async function crearEquipo(c: Cliente, etiqueta: string, sede: string): Promise<string> {
  const r = await c.post('/api/equipos', {
    categoria: 'Portátil',
    etiqueta,
    marca: 'Dell',
    modelo: 'Latitude 5440',
    serial: `SN-${etiqueta}`,
    estado: 'Disponible',
    sede_id: sede,
  });
  assert.equal(r.estado, 201, `no se pudo crear ${etiqueta}: ${JSON.stringify(r.cuerpo)}`);
  return (r.cuerpo as { equipo: { id: string } }).equipo.id;
}

// ---------------------------------------------------------------------------
// El ciclo completo
// ---------------------------------------------------------------------------

describe('movimientos: las seis mutaciones', () => {
  const suite = ambito('mut');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let sedeB: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    sedeB = await segundaSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  it('asignar mueve el estado y escribe su movimiento', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}CICLO`, sedeA);
    creados.push(id);

    const r = await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    assert.equal(r.estado, 200);

    const { equipo } = r.cuerpo as { equipo: { estado: string; empleado_id: string } };
    assert.equal(equipo.estado, 'Asignado');
    assert.equal(equipo.empleado_id, empleado);

    const movs = await movimientosDe(id);
    assert.equal(movs.length, 2, 'el Alta del create más la Asignación');
    assert.equal(movs[1].tipo, 'Asignación');
    assert.equal(movs[1].empleado_destino_id, empleado);
    assert.equal(movs[1].usuario_app_id, admin.id);
  });

  it('devolver lo deja Disponible y sin responsable', async () => {
    const id = creados[0];
    const r = await c.post(`/api/equipos/${id}/devolver`, {});
    assert.equal(r.estado, 200);

    const { equipo } = r.cuerpo as { equipo: { estado: string; empleado_id: string | null } };
    assert.equal(equipo.estado, 'Disponible');
    assert.equal(equipo.empleado_id, null, 'el CHECK exige que se quite el responsable');

    const movs = await movimientosDe(id);
    assert.equal(movs[movs.length - 1].tipo, 'Devolución');
    assert.equal(
      movs[movs.length - 1].empleado_origen_id,
      empleado,
      'la devolución guarda de quién venía',
    );
  });

  it('reservar y liberar hacen el viaje de ida y vuelta', async () => {
    const id = creados[0];

    assert.equal((await c.post(`/api/equipos/${id}/reservar`, {})).estado, 200);
    assert.equal(await estadoDe(id), 'Reservado');

    assert.equal((await c.post(`/api/equipos/${id}/liberar`, {})).estado, 200);
    assert.equal(await estadoDe(id), 'Disponible');

    const tipos = (await movimientosDe(id)).map((m) => m.tipo);
    assert.ok(tipos.includes('Reserva'), 'Reserva en el historial');
    assert.ok(tipos.includes('Liberación'), 'Liberación en el historial');
  });

  it('trasladar NO cambia el estado y deja el traslado abierto (D13)', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}VIAJE`, sedeA);
    creados.push(id);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    const r = await c.post(`/api/equipos/${id}/trasladar`, {
      sede_destino_id: sedeB,
      transportadora: 'Servientrega',
      guia: 'GUIA-TEST-1',
    });
    assert.equal(r.estado, 200);

    // Lo que D13 vino a arreglar: sigue asignado a su responsable mientras viaja.
    const { equipo } = r.cuerpo as { equipo: { estado: string; empleado_id: string; sede_id: string } };
    assert.equal(equipo.estado, 'Asignado', 'un equipo que viaja no deja de ser de quien es');
    assert.equal(equipo.empleado_id, empleado);
    assert.equal(equipo.sede_id, sedeA, 'la sede no se mueve hasta confirmar el traslado');

    const hist = (await c.get(`/api/equipos/${id}/historial`)).cuerpo as {
      traslado_abierto: { sede_destino_id: string } | null;
    };
    assert.ok(hist.traslado_abierto, 'el traslado queda abierto');
    assert.equal(hist.traslado_abierto.sede_destino_id, sedeB);
  });

  it('dar de baja un equipo disponible funciona', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}BAJA`, sedeA);
    creados.push(id);

    assert.equal((await c.post(`/api/equipos/${id}/baja`, {})).estado, 200);
    assert.equal(await estadoDe(id), 'De baja');
  });
});

// ---------------------------------------------------------------------------
// Las transiciones ilegales: 409 con salida, no 500
// ---------------------------------------------------------------------------

describe('movimientos: lo que no se puede hacer', () => {
  const suite = ambito('ilegal');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let sedeB: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    sedeB = await segundaSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  it('dar de baja un equipo asignado: 409, y dice qué hacer', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}ASIG`, sedeA);
    creados.push(id);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    const r = await c.post(`/api/equipos/${id}/baja`, {});
    assert.equal(r.estado, 409, 'no 500: es una regla de negocio, no un fallo');

    const cuerpo = r.cuerpo as { error: string; estado_actual: string; puedes: string[] };
    assert.equal(cuerpo.estado_actual, 'Asignado');
    assert.ok(cuerpo.error.includes('devolver'), `el mensaje no dice la salida: ${cuerpo.error}`);
    assert.ok(cuerpo.puedes.includes('devolver'), 'enumera lo que sí se puede hacer');
    // Que no cambió nada.
    assert.equal(await estadoDe(id), 'Asignado');
  });

  it('liberar un equipo que no está reservado: 409', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}LIB`, sedeA);
    creados.push(id);

    const r = await c.post(`/api/equipos/${id}/liberar`, {});
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { estado_actual: string; legal_desde: string[] };
    assert.equal(cuerpo.estado_actual, 'Disponible');
    assert.deepEqual(cuerpo.legal_desde, ['Reservado']);
  });

  it('trasladar un equipo que ya está en traslado: 409 traducido', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}DOBLE`, sedeA);
    creados.push(id);

    assert.equal((await c.post(`/api/equipos/${id}/trasladar`, { sede_destino_id: sedeB })).estado, 200);

    const r = await c.post(`/api/equipos/${id}/trasladar`, { sede_destino_id: sedeB });
    assert.equal(r.estado, 409, 'lo corta el índice único, y sale traducido');
    const cuerpo = r.cuerpo as { error: string };
    assert.ok(
      cuerpo.error.includes('traslado en curso'),
      `mensaje sin explicar la regla: ${cuerpo.error}`,
    );
    // Sin jerga de Postgres.
    assert.ok(!/constraint|unique|violat|index/i.test(cuerpo.error), cuerpo.error);
  });

  it('asignar sin decir a quién: 400', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}SINQUIEN`, sedeA);
    creados.push(id);

    const r = await c.post(`/api/equipos/${id}/asignar`, {});
    assert.equal(r.estado, 400);
    assert.equal(await estadoDe(id), 'Disponible', 'no tocó nada');
  });

  it('una transición ilegal no escribe movimiento ni auditoría', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}NADA`, sedeA);
    creados.push(id);

    const antes = (await movimientosDe(id)).length;
    assert.equal((await c.post(`/api/equipos/${id}/devolver`, {})).estado, 409);

    assert.equal((await movimientosDe(id)).length, antes, 'no dejó movimiento');
    assert.equal(await contarAuditoria(id, 'devolver'), 0, 'no dejó auditoría');
  });
});

// ---------------------------------------------------------------------------
// Confirmar la llegada: cierra el movimiento y mueve el equipo
// ---------------------------------------------------------------------------

describe('traslados: confirmar cierra el movimiento y mueve el equipo', () => {
  const suite = ambito('confirm');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let sedeB: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    sedeB = await segundaSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /** Crea un equipo en sedeA y le abre un traslado a sedeB. */
  async function conTrasladoAbierto(etiqueta: string): Promise<{ id: string; mov: string }> {
    const id = await crearEquipo(c, etiqueta, sedeA);
    creados.push(id);
    const r = await c.post(`/api/equipos/${id}/trasladar`, {
      sede_destino_id: sedeB,
      transportadora: 'Servientrega',
      guia: `G-${etiqueta}`,
    });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    const abierto = await trasladoAbiertoDe(id);
    assert.ok(abierto, 'el traslado tenía que quedar abierto');
    return { id, mov: abierto.id };
  }

  it('el equipo llega a destino y el movimiento queda cerrado', async () => {
    const { id, mov } = await conTrasladoAbierto(`${suite.prefijo}LLEGA`);
    assert.equal(await sedeDe(id), sedeA, 'antes de confirmar sigue en origen');

    const r = await c.post(`/api/movimientos/${mov}/confirmar`, {});
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    // Las dos mitades, leídas de la base y no de la respuesta.
    assert.equal(await sedeDe(id), sedeB, 'el equipo se movió a la sede destino');
    assert.equal(await trasladoAbiertoDe(id), null, 'ya no hay traslado abierto');

    const movs = await movimientosDe(id);
    const traslado = movs.find((m) => m.tipo === 'Traslado');
    assert.ok(traslado?.fecha_confirmacion, 'la fecha de confirmación quedó puesta');
    assert.equal(traslado.sede_origen_id, sedeA);
    assert.equal(traslado.sede_destino_id, sedeB);
  });

  it('confirmar deja su fila de auditoría, con el antes y el después de la sede', async () => {
    const id = creados[0];
    assert.equal(await contarAuditoria(id, 'confirmar_traslado'), 1);

    const { filas } = await import('./ayuda.js').then((m) =>
      m.auditoriaDe(id, 'confirmar_traslado'),
    );
    assert.equal((filas[0].antes as { sede_id: string }).sede_id, sedeA);
    assert.equal((filas[0].despues as { sede_id: string }).sede_id, sedeB);
    assert.equal(filas[0].usuario_app_id, admin.id);
  });

  it('confirmarlo dos veces: 409 la segunda, y nada cambia', async () => {
    const { id, mov } = await conTrasladoAbierto(`${suite.prefijo}DOBLE`);
    assert.equal((await c.post(`/api/movimientos/${mov}/confirmar`, {})).estado, 200);

    const auditAntes = await contarAuditoria(id, 'confirmar_traslado');
    const r = await c.post(`/api/movimientos/${mov}/confirmar`, {});
    assert.equal(r.estado, 409);
    assert.match((r.cuerpo as { error: string }).error, /ya estaba confirmado/i);
    assert.equal(
      await contarAuditoria(id, 'confirmar_traslado'),
      auditAntes,
      'el intento fallido no deja auditoría',
    );
  });

  it('confirmar un movimiento que no es un traslado: 409, no 500', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}ALTA`, sedeA);
    creados.push(id);
    // El `Alta` que escribe el POST. Nunca se confirma nada de eso.
    const alta = await movimientosDe(id);
    assert.equal(alta.length, 1);

    const r = await c.post(`/api/movimientos/${alta[0].id}/confirmar`, {});
    assert.equal(r.estado, 409);
    assert.match((r.cuerpo as { error: string }).error, /Alta/);
  });

  it('un movimiento que no existe: 404', async () => {
    const r = await c.post('/api/movimientos/00000000-0000-0000-0000-000000000000/confirmar', {});
    assert.equal(r.estado, 404);
  });

  it('después de confirmar, se puede abrir otro traslado', async () => {
    // El índice único es PARCIAL: bloquea dos ABIERTOS, no dos traslados. Si
    // fuera total, un equipo solo podría viajar una vez en su vida.
    const id = creados[0];
    const r = await c.post(`/api/equipos/${id}/trasladar`, { sede_destino_id: sedeA });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(await sedeDe(id), sedeB, 'el de vuelta tampoco mueve la sede hasta confirmarse');
  });

  it('la lista de traslados abiertos trae nombres, no UUIDs', async () => {
    const { id } = await conTrasladoAbierto(`${suite.prefijo}LISTA`);

    const r = await c.get('/api/traslados');
    assert.equal(r.estado, 200);
    const { traslados } = r.cuerpo as {
      traslados: {
        equipo_id: string;
        etiqueta: string | null;
        sede_origen: string | null;
        sede_destino: string | null;
        dias_en_transito: number;
        guia: string | null;
      }[];
    };

    const mio = traslados.find((t) => t.equipo_id === id);
    assert.ok(mio, 'el traslado recién abierto tiene que estar en la lista');
    // Contra el nombre que tiene la sede en la base, no contra uno escrito
    // aquí: renombrar una sede no puede poner rojo un test de traslados.
    assert.equal(mio.sede_origen, await nombreDeSede(sedeA));
    assert.equal(mio.sede_destino, await nombreDeSede(sedeB));
    assert.equal(mio.dias_en_transito, 0, 'se abrió hoy');
    assert.equal(mio.guia, `G-${suite.prefijo}LISTA`);

    // Y los confirmados NO están: la lista es de los que están en curso.
    const cerrados = traslados.filter((t) => t.guia === `G-${suite.prefijo}DOBLE`);
    assert.deepEqual(cerrados, [], 'un traslado confirmado sale de la lista');
  });

  /**
   * El corte real, en la segunda transacción de dos escrituras. Ver
   * `matarConexionEnMedioDeConfirmar`.
   */
  it('matar la conexión entre mover el equipo y cerrar el traslado no deja media confirmación', async () => {
    const { id, mov } = await conTrasladoAbierto(`${suite.prefijo}CORTE`);

    const resultado = await matarConexionEnMedioDeConfirmar(id, mov, sedeB);
    assert.equal(resultado, 'conexión terminada', 'la conexión tenía que morir de verdad');

    // Las dos mitades. Que sobreviviera una sola es el equipo en dos sedes a la
    // vez: movido y todavía viajando, o parado y ya sin traslado que lo mueva.
    assert.equal(await sedeDe(id), sedeA, 'el equipo NO se movió');
    const sigueAbierto = await trasladoAbiertoDe(id);
    assert.ok(sigueAbierto, 'el traslado sigue abierto');
    assert.equal(sigueAbierto.id, mov);
  });

  it('y el traslado que sobrevivió al corte se puede confirmar después', async () => {
    // Que la base deshaga la transacción no basta: el traslado tiene que
    // quedar utilizable, no en un limbo que haya que arreglar a mano.
    const id = creados[creados.length - 1];
    const abierto = await trasladoAbiertoDe(id);
    assert.ok(abierto);

    const r = await c.post(`/api/movimientos/${abierto.id}/confirmar`, {});
    assert.equal(r.estado, 200, 'matar una conexión no puede dejar el pool inservible');
    assert.equal(await sedeDe(id), sedeB);
  });
});

// ---------------------------------------------------------------------------
// Auditoría en la misma transacción
// ---------------------------------------------------------------------------

describe('movimientos: la auditoría va con la mutación', () => {
  const suite = ambito('audit');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  it('cada mutación deja su fila con antes y despues', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}AUD`, sedeA);
    creados.push(id);

    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    assert.equal(await contarAuditoria(id, 'asignar'), 1);

    const { filas } = await import('./ayuda.js').then((m) => m.auditoriaDe(id, 'asignar'));
    const fila = filas[0];
    assert.equal((fila.antes as { estado: string }).estado, 'Disponible');
    assert.equal((fila.despues as { estado: string }).estado, 'Asignado');
    assert.equal((fila.antes as { empleado_id: string | null }).empleado_id, null);
    assert.equal((fila.despues as { empleado_id: string }).empleado_id, empleado);
    assert.equal(fila.usuario_app_id, admin.id);
  });

  it('la auditoría NO lleva los campos cifrados', async () => {
    const id = creados[0];
    const { filas } = await import('./ayuda.js').then((m) => m.auditoriaDe(id, 'asignar'));
    const texto = JSON.stringify(filas);
    assert.ok(!texto.includes('bios'), 'la tabla que vigila la fuga no puede ser la fuga');
    assert.ok(!texto.includes('licencia_serial'), texto.slice(0, 200));
  });
});

// ---------------------------------------------------------------------------
// La entrega de un kit: la secuencia que hace OnboardingModal
// ---------------------------------------------------------------------------
//
// El modal manda una asignación por equipo, y un traslado detrás cuando el
// equipo no está en la sede de quien lo recibe. No hay transacción que abarque
// el kit entero —no existe endpoint de lote—, así que lo que hay que probar es
// justo eso: que un fallo en mitad del kit no arrastra a los demás ni deja al
// que falló a medias.

describe('entrega de un kit: asignación por equipo, y traslado si cambia de sede', () => {
  const suite = ambito('kit');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let sedeB: string;
  let receptor: string;
  let otro: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    sedeB = await segundaSede();
    receptor = await crearEmpleado(`${suite.prefijo}receptor`);
    otro = await crearEmpleado(`${suite.prefijo}otro`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([receptor, otro]);
    await suite.limpiar();
  });

  it('un equipo de otra sede se asigna Y se pone en tránsito', async () => {
    // El portátil está en A, quien lo recibe está en B.
    const id = await crearEquipo(c, `${suite.prefijo}VIAJA`, sedeA);
    creados.push(id);

    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: receptor })).estado, 200);
    assert.equal(
      (await c.post(`/api/equipos/${id}/trasladar`, {
        sede_destino_id: sedeB,
        transportadora: 'Servientrega',
      })).estado,
      200,
    );

    // Las tres cosas a la vez, que es lo que D13 permite decir: es suyo, sigue
    // en la sede de origen, y está viajando.
    assert.equal(await estadoDe(id), 'Asignado');
    assert.equal(await sedeDe(id), sedeA, 'la sede no se mueve hasta confirmar');
    const abierto = await trasladoAbiertoDe(id);
    assert.equal(abierto?.sede_destino_id, sedeB);

    const tipos = (await movimientosDe(id)).map((m) => m.tipo);
    assert.deepEqual(tipos, ['Alta', 'Asignación', 'Traslado']);
  });

  it('si un equipo del kit falla, los otros dos quedan entregados y él intacto', async () => {
    const uno = await crearEquipo(c, `${suite.prefijo}K1`, sedeA);
    const dos = await crearEquipo(c, `${suite.prefijo}K2`, sedeA);
    const tres = await crearEquipo(c, `${suite.prefijo}K3`, sedeA);
    creados.push(uno, dos, tres);

    // El del medio se lo lleva otra persona un segundo antes: cuando llegue su
    // turno ya no está disponible. Es el caso real, no uno inventado.
    await c.post(`/api/equipos/${dos}/asignar`, { empleado_id: otro });

    const kit = [uno, dos, tres];
    const resultados: number[] = [];
    for (const id of kit) {
      resultados.push((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: receptor })).estado);
    }
    assert.deepEqual(resultados, [200, 409, 200], 'el fallo del segundo no corta la secuencia');

    // Los dos que salieron bien están entregados...
    for (const id of [uno, tres]) {
      assert.equal(await estadoDe(id), 'Asignado');
      assert.equal((await movimientosDe(id)).at(-1)?.empleado_destino_id, receptor);
    }
    // ...y el que falló sigue exactamente como estaba: de la otra persona, con
    // un solo movimiento de asignación y sin auditoría de un intento fallido.
    assert.equal(await estadoDe(dos), 'Asignado');
    assert.equal((await movimientosDe(dos)).filter((m) => m.tipo === 'Asignación').length, 1);
    assert.equal(await contarAuditoria(dos, 'asignar'), 1);
  });
});

// ---------------------------------------------------------------------------
// El catálogo que pinta los botones tiene que decir la verdad
// ---------------------------------------------------------------------------
//
// `GET /api/transiciones` es lo que la interfaz usa para saber qué botones
// mostrar. Si mintiera, el fallo sería el peor de los dos posibles: un botón
// que siempre da 409, o una operación legal sin botón — invisible, porque nadie
// echa de menos lo que nunca vio.
//
// Por eso no basta con comprobar que el catálogo tiene seis entradas. Se
// contrasta contra lo que los endpoints hacen de verdad: todo lo que el
// catálogo declara ilegal desde un estado tiene que dar 409 al intentarlo.

describe('transiciones: el catálogo concuerda con lo que hacen los endpoints', () => {
  const suite = ambito('catalogo');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;
  let catalogo: {
    operaciones: {
      operacion: string;
      etiqueta: string;
      requiere: string | null;
      disparo: 'directa' | 'parte';
    }[];
    por_estado: Record<string, string[]>;
    sin_operacion: string[];
  };

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
    catalogo = (await c.get('/api/transiciones')).cuerpo as typeof catalogo;
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  it('trae las once operaciones, con etiqueta para el botón', () => {
    assert.deepEqual(
      catalogo.operaciones.map((o) => o.operacion).sort(),
      [
        'asignar',
        'baja',
        'devolver',
        'enviar_mantenimiento',
        'liberar',
        'prestar',
        'reasignar',
        'recuperar_prestamo',
        'reservar',
        'retornar_mantenimiento',
        'trasladar',
      ],
    );
    for (const o of catalogo.operaciones) {
      assert.ok(o.etiqueta && o.etiqueta.length > 2, `${o.operacion} sin etiqueta usable`);
      assert.ok(
        o.disparo === 'directa' || o.disparo === 'parte',
        `${o.operacion} sin disparo: la interfaz no sabría si pintarle botón`,
      );
    }
  });

  /**
   * El caso que faltaba, y que costó un botón que daba 404.
   *
   * `AccionesEquipo` pinta un botón por cada operación de `por_estado` y lo
   * manda a `POST /api/equipos/:id/<operacion>`. Mientras las ocho operaciones
   * y las seis rutas se escribían en sitios distintos, nada comprobaba que
   * coincidieran: el catálogo prometía «Enviar a mantenimiento» desde
   * `Disponible` y esa ruta no existía.
   *
   * Aquí se comprueban las dos direcciones. Una `directa` sin ruta da 404, y
   * una de `parte` con ruta significaría que el equipo puede irse al taller sin
   * dejar parte — el agujero que D29 cerró, abierto por el otro lado.
   */
  it('las `directa` tienen ruta y las de `parte` no la tienen', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}RUTAS`, sedeA);
    creados.push(id);

    for (const o of catalogo.operaciones) {
      const r = await c.post(`/api/equipos/${id}/${o.operacion}`, { empleado_id: empleado });
      if (o.disparo === 'directa') {
        assert.notEqual(r.estado, 404, `${o.operacion} es directa y no tiene ruta: daría 404`);
      } else {
        assert.equal(
          r.estado,
          404,
          `${o.operacion} se dispara con un parte y aun así tiene endpoint suelto`,
        );
      }
      // No hace falta devolver el equipo a Disponible entre vuelta y vuelta:
      // el 404 lo decide que la ruta exista, no el estado. Una operación
      // ilegal desde donde el equipo haya quedado responde 409, y 409 ya
      // demuestra que la ruta está registrada.
    }
  });

  it('cubre TODOS los estados del enum, y ninguno se queda sin operación', () => {
    // Un estado ausente del mapa dejaría a la interfaz sin saber qué pintar, y
    // lo que hace un `?? []` es no pintar nada: una operación legal se
    // volvería invisible sin que ningún test fallara.
    const estados = Object.keys(catalogo.por_estado).sort();
    assert.deepEqual(estados, [
      'Asignado',
      'De baja',
      'Disponible',
      'En mantenimiento',
      'Prestado',
      'Reservado',
    ]);
    assert.deepEqual(catalogo.por_estado['De baja'], [], 'de "De baja" no sale nada');

    // D29: `sin_operacion` quedó VACÍO al añadir las dos de mantenimiento, y
    // eso es el criterio de que el modelo está completo — cada estado del enum
    // tiene puerta de entrada y de salida. La constante se queda aunque esté
    // vacía, y este caso es lo que hará visible el tercer hueco: un estado
    // nuevo sin operación aparece aquí y pone el test en rojo.
    assert.deepEqual(
      catalogo.sin_operacion,
      [],
      'hay un estado al que no llega ninguna operación: se alcanza y no se puede salir',
    );
    assert.ok(
      catalogo.por_estado['En mantenimiento'].includes('retornar_mantenimiento'),
      'de "En mantenimiento" se sale cerrando el parte',
    );
    // Lo mismo para el estado que añade la 5e: entra y sale el mismo día.
    assert.ok(
      catalogo.por_estado['Disponible'].includes('prestar'),
      'a "Prestado" se entra prestando',
    );
    assert.ok(
      catalogo.por_estado['Prestado'].includes('recuperar_prestamo'),
      'de "Prestado" se sale recuperándolo',
    );
  });

  /**
   * El contraste que importa: llevar un equipo a cada estado e intentar TODAS
   * las operaciones que el catálogo declara ilegales desde ahí. Las seis menos
   * las legales, una por una, y todas tienen que dar 409.
   */
  // Sale del catálogo y no de una lista escrita aquí: una operación `directa`
  // nueva entra sola en la comprobación. Las de `parte` quedan fuera porque no
  // tienen endpoint —darían 404, no 409— y eso lo cubre el caso de arriba.
  const directas = () =>
    catalogo.operaciones.filter((o) => o.disparo === 'directa').map((o) => o.operacion);

  async function comprobarIlegalesDesde(estado: string, id: string) {
    const legales = catalogo.por_estado[estado];
    const ilegales = directas().filter((op) => !legales.includes(op));
    assert.ok(ilegales.length > 0, `${estado} no tendría nada que comprobar`);

    for (const op of ilegales) {
      const r = await c.post(`/api/equipos/${id}/${op}`, { empleado_id: empleado });
      assert.equal(r.estado, 409, `${op} desde ${estado} debería ser ilegal y dio ${r.estado}`);

      // Y el "puedes" del 409 es exactamente lo que el catálogo promete: los
      // dos salen de `operacionesDesde`, así que si divergen es que hay dos
      // fuentes de verdad donde debería haber una.
      const cuerpo = r.cuerpo as { puedes: string[]; estado_actual: string };
      assert.equal(cuerpo.estado_actual, estado);
      assert.deepEqual([...cuerpo.puedes].sort(), [...legales].sort());
    }
    // Nada de lo anterior movió el equipo.
    assert.equal(await estadoDe(id), estado);
  }

  it('desde Disponible', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}DISP`, sedeA);
    creados.push(id);
    await comprobarIlegalesDesde('Disponible', id);
  });

  it('desde Reservado', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}RES`, sedeA);
    creados.push(id);
    await c.post(`/api/equipos/${id}/reservar`, {});
    await comprobarIlegalesDesde('Reservado', id);
  });

  it('desde Asignado', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}ASG`, sedeA);
    creados.push(id);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    await comprobarIlegalesDesde('Asignado', id);
  });

  it('desde De baja no se puede hacer absolutamente nada', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}BAJA2`, sedeA);
    creados.push(id);
    await c.post(`/api/equipos/${id}/baja`, {});
    await comprobarIlegalesDesde('De baja', id);
  });
});

// ---------------------------------------------------------------------------
// Préstamos entre empresas: las dos operaciones de la 5e
// ---------------------------------------------------------------------------

describe('préstamos: prestar y recuperar, con la CHECK detrás', () => {
  const suite = ambito('prestamo');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  const equipo = async (etiqueta: string) => {
    const id = await crearEquipo(c, etiqueta, sedeA);
    creados.push(id);
    return id;
  };

  it('prestar mueve el estado, pone el prestatario y escribe su movimiento', async () => {
    const id = await equipo(`${suite.prefijo}P1`);

    const r = await c.post(`/api/equipos/${id}/prestar`, { prestado_a: 'ISF' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const { equipo: eq } = r.cuerpo as { equipo: { estado: string; prestado_a: string } };
    assert.equal(eq.estado, 'Prestado');
    assert.equal(eq.prestado_a, 'ISF');

    const movs = await movimientosDe(id);
    assert.equal(movs[movs.length - 1].tipo, 'Préstamo');
  });

  it('prestar SIN decir a quién: 400, no una fila a medias', async () => {
    // La CHECK `equipos_prestado_implica_prestatario` lo rechazaría igual, pero
    // entonces el mensaje sería el de Postgres. Quien lo lea tiene que saber
    // qué dato falta, no qué constraint rebotó.
    const id = await equipo(`${suite.prefijo}P2`);

    const r = await c.post(`/api/equipos/${id}/prestar`, {});
    assert.equal(r.estado, 400);
    assert.match((r.cuerpo as { error: string }).error, /empresa/i);
    assert.equal(await estadoDe(id), 'Disponible', 'y el equipo no se movió');
  });

  it('prestar un equipo asignado: 409 y sigue en manos de su responsable', async () => {
    const id = await equipo(`${suite.prefijo}P3`);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    const r = await c.post(`/api/equipos/${id}/prestar`, { prestado_a: 'ISF' });
    assert.equal(r.estado, 409, 'prestar lo que alguien tiene en la mano no es legal');
    assert.equal(await estadoDe(id), 'Asignado');
  });

  it('recuperar deja el equipo Disponible Y borra el prestatario', async () => {
    // Las dos mitades importan. Un `recuperar` que moviera el estado y dejara
    // `prestado_a` puesto haría que la vista de ISF siguiera contando un equipo
    // que ya devolvió — y la CHECK no dejaría ni escribirlo.
    const id = await equipo(`${suite.prefijo}P4`);
    await c.post(`/api/equipos/${id}/prestar`, { prestado_a: 'BBL Labs' });

    const r = await c.post(`/api/equipos/${id}/recuperar_prestamo`, {});
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const { equipo: eq } = r.cuerpo as { equipo: { estado: string; prestado_a: string | null } };
    assert.equal(eq.estado, 'Disponible');
    assert.equal(eq.prestado_a, null);

    const movs = await movimientosDe(id);
    assert.equal(movs[movs.length - 1].tipo, 'Retorno de préstamo');
  });

  it('recuperar algo que no está prestado: 409', async () => {
    const id = await equipo(`${suite.prefijo}P5`);
    const r = await c.post(`/api/equipos/${id}/recuperar_prestamo`, {});
    assert.equal(r.estado, 409);
    assert.equal(await estadoDe(id), 'Disponible');
  });
});

// ---------------------------------------------------------------------------
// Offboarding: devolver lo de alguien, y desactivarlo al final
// ---------------------------------------------------------------------------

describe('offboarding: recoger los equipos y cerrar la ficha', () => {
  const suite = ambito('offb');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let saliente: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    saliente = await crearEmpleado(`${suite.prefijo}saliente`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([saliente]);
    await suite.limpiar();
  });

  it('la secuencia entera: devolver, el 409 mientras quede algo, y desactivar', async () => {
    const uno = await crearEquipo(c, `${suite.prefijo}O1`, sedeA);
    const dos = await crearEquipo(c, `${suite.prefijo}O2`, sedeA);
    creados.push(uno, dos);
    for (const id of [uno, dos]) {
      assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: saliente })).estado, 200);
    }

    // `GET /api/empleados/:id/equipos` es de donde el modal saca la lista.
    const lista = (await c.get(`/api/empleados/${saliente}/equipos`)).cuerpo as {
      equipos: { id: string }[];
    };
    assert.deepEqual(lista.equipos.map((e) => e.id).sort(), [uno, dos].sort());

    // Se devuelve solo uno: la persona se queda el otro por lo que sea.
    assert.equal((await c.post(`/api/equipos/${uno}/devolver`, {})).estado, 200);
    assert.equal(await estadoDe(uno), 'Disponible');

    // Y aquí engancha el bloqueo de la etapa 3: todavía tiene uno.
    const bloqueado = await c.patch(`/api/empleados/${saliente}`, { activo: false });
    assert.equal(bloqueado.estado, 409);
    const msg = (bloqueado.cuerpo as { error: string }).error;
    assert.match(msg, /equipos a su nombre/i, `el mensaje no dice qué falta: ${msg}`);
    assert.match(msg, /devolver/i, 'ni cuál es la salida');

    // Se devuelve el segundo y ya no queda nada a su nombre.
    assert.equal((await c.post(`/api/equipos/${dos}/devolver`, {})).estado, 200);
    const vacia = (await c.get(`/api/empleados/${saliente}/equipos`)).cuerpo as {
      equipos: unknown[];
    };
    assert.deepEqual(vacia.equipos, []);

    const ok = await c.patch(`/api/empleados/${saliente}`, { activo: false });
    assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
    assert.equal((ok.cuerpo as { empleado: { activo: boolean } }).empleado.activo, false);
  });

  it('devolver algo que ya está Disponible da 409 y no toca a los demás', async () => {
    // Es el fallo real dentro de una recogida: dos personas marcan el mismo
    // equipo, o alguien lo devolvió por su cuenta hace un minuto.
    const otro = await crearEmpleado(`${suite.prefijo}segundo`);
    const a = await crearEquipo(c, `${suite.prefijo}P1`, sedeA);
    const b = await crearEquipo(c, `${suite.prefijo}P2`, sedeA);
    creados.push(a, b);
    for (const id of [a, b]) await c.post(`/api/equipos/${id}/asignar`, { empleado_id: otro });

    // Alguien devuelve `a` antes de que empiece la recogida.
    await c.post(`/api/equipos/${a}/devolver`, {});

    const estados: number[] = [];
    for (const id of [a, b]) {
      estados.push((await c.post(`/api/equipos/${id}/devolver`, {})).estado);
    }
    assert.deepEqual(estados, [409, 200], 'el 409 del primero no impide devolver el segundo');
    assert.equal(await estadoDe(b), 'Disponible');

    await borrarEquipos([a, b]);
    creados.splice(creados.indexOf(a), 1);
    creados.splice(creados.indexOf(b), 1);
    await borrarEmpleados([otro]);
  });
});

// ---------------------------------------------------------------------------
// Atomicidad: la conexión muere a mitad
// ---------------------------------------------------------------------------

describe('movimientos: si la transacción se corta, no queda media', () => {
  const suite = ambito('atomic');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /**
   * Se abre la transacción a mano, se hace el UPDATE de `equipos`, y **se mata
   * la conexión desde otra sesión** con `pg_terminate_backend` antes de
   * insertar el movimiento. Es el corte real: el proceso servidor de Postgres
   * desaparece con la transacción a medias.
   *
   * No es un mock del repositorio. Un mock demostraría que el mock se llamó en
   * el orden previsto; lo que hay que demostrar es que la base deshace lo que
   * ya se había escrito, y eso solo lo puede demostrar la base.
   */
  it('matar la conexión entre el UPDATE y el INSERT no deja nada a medias', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}CORTE`, sedeA);
    creados.push(id);

    const antesEstado = await estadoDe(id);
    const antesMovs = (await movimientosDe(id)).length;
    const antesAudit = await contarAuditoria(id, 'asignar');
    assert.equal(antesEstado, 'Disponible');

    const resultado = await matarConexionEnMedioDeAsignar(id, empleado);
    assert.equal(resultado, 'conexión terminada', 'la conexión tenía que morir de verdad');

    // Las tres mitades, cada una comprobada por separado. Que una de ellas
    // sobreviviera sería el fallo: equipo movido sin movimiento, o movimiento
    // sin equipo movido.
    assert.equal(await estadoDe(id), 'Disponible', 'el equipo NO quedó movido');
    assert.equal((await movimientosDe(id)).length, antesMovs, 'no quedó movimiento suelto');
    assert.equal(await contarAuditoria(id, 'asignar'), antesAudit, 'no quedó auditoría suelta');
  });

  it('y después de eso la API sigue viva y la asignación funciona', async () => {
    const id = creados[0];
    const r = await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });
    assert.equal(r.estado, 200, 'matar una conexión no puede dejar el pool inservible');
    assert.equal(await estadoDe(id), 'Asignado');
    assert.equal(await contarAuditoria(id, 'asignar'), 1);
  });
});

// ---------------------------------------------------------------------------
// Reasignar: la operación compuesta
// ---------------------------------------------------------------------------
//
// El caso escrito desde `docs/pendientes.md`: «Reasignar es `devolver` +
// `asignar`: dos mutaciones». Lo que se comprueba es que sean DOS movimientos,
// no uno llamado «Reasignación» — el historial es lo único que justifica el
// proyecto, y un atajo que se coma la devolución deja media respuesta a «quién
// tenía esto en marzo».

describe('reasignar: una operación, dos movimientos', () => {
  const suite = ambito('reasignar');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let ana: string;
  let beto: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    ana = await crearEmpleado(`${suite.prefijo}ana`);
    beto = await crearEmpleado(`${suite.prefijo}beto`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([ana, beto]);
    await suite.limpiar();
  });

  /** Un equipo ya asignado a Ana. */
  const asignadoAAna = async (etiqueta: string) => {
    const id = await crearEquipo(c, etiqueta, sedeA);
    creados.push(id);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana })).estado, 200);
    return id;
  };

  it('deja el equipo con la persona nueva y DOS movimientos, en orden', async () => {
    const id = await asignadoAAna(`${suite.prefijo}R1`);
    const antes = (await movimientosDe(id)).length;

    const r = await c.post(`/api/equipos/${id}/reasignar`, { empleado_id: beto });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const { equipo } = r.cuerpo as { equipo: { estado: string; empleado_id: string } };
    assert.equal(equipo.estado, 'Asignado');
    assert.equal(equipo.empleado_id, beto);

    const movs = await movimientosDe(id);
    assert.equal(movs.length, antes + 2, 'devolver + asignar son dos hechos, no uno');

    const [devolucion, asignacion] = movs.slice(-2);
    assert.equal(devolucion.tipo, 'Devolución');
    assert.equal(devolucion.empleado_origen_id, ana, 'la devolución dice de quién venía');
    assert.equal(asignacion.tipo, 'Asignación');
    assert.equal(asignacion.empleado_destino_id, beto);
  });

  it('reasignar a quien ya lo tiene: 400, y no dos movimientos vacíos', async () => {
    const id = await asignadoAAna(`${suite.prefijo}R2`);
    const antes = (await movimientosDe(id)).length;

    const r = await c.post(`/api/equipos/${id}/reasignar`, { empleado_id: ana });
    assert.equal(r.estado, 400);
    assert.equal((await movimientosDe(id)).length, antes, 'no se escribió nada');
    assert.equal(await estadoDe(id), 'Asignado');
  });

  it('sin decir a quién: 400, y el equipo no se queda devuelto a medias', async () => {
    const id = await asignadoAAna(`${suite.prefijo}R3`);
    const antes = (await movimientosDe(id)).length;

    const r = await c.post(`/api/equipos/${id}/reasignar`, {});
    assert.equal(r.estado, 400);
    assert.equal(await estadoDe(id), 'Asignado', 'sigue con su responsable');
    assert.equal((await movimientosDe(id)).length, antes);
  });

  /**
   * Lo que la transacción compra: si la segunda mitad falla, la primera se
   * deshace. Sin ella el equipo se quedaría `Disponible` —devuelto— y quien
   * pulsó «reasignar» vería un error creyendo que no pasó nada.
   */
  it('si la segunda mitad falla, la devolución se deshace', async () => {
    const id = await asignadoAAna(`${suite.prefijo}R4`);
    const antes = (await movimientosDe(id)).length;

    const inexistente = '00000000-0000-4000-8000-000000000000';
    const r = await c.post(`/api/equipos/${id}/reasignar`, { empleado_id: inexistente });
    assert.notEqual(r.estado, 200, `debería fallar y dio ${r.estado}`);

    assert.equal(await estadoDe(id), 'Asignado', 'NO se quedó devuelto');
    assert.equal((await movimientosDe(id)).length, antes, 'ni medio movimiento');
  });

  it('reasignar un equipo que no está asignado: 409 que dice la salida', async () => {
    const id = await crearEquipo(c, `${suite.prefijo}R5`, sedeA);
    creados.push(id);

    const r = await c.post(`/api/equipos/${id}/reasignar`, { empleado_id: beto });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; puedes: string[] };
    assert.equal(await estadoDe(id), 'Disponible');
    assert.ok(cuerpo.puedes.includes('asignar'), 'y dice que lo que toca es asignarlo');
  });

  it('el catálogo la declara compuesta, y por eso la interfaz sabe que son dos', async () => {
    const cat = (await c.get('/api/transiciones')).cuerpo as {
      operaciones: { operacion: string; compuesta: string[] | null; disparo: string }[];
    };
    const r = cat.operaciones.find((o) => o.operacion === 'reasignar');
    assert.ok(r, 'reasignar tiene que estar en el catálogo');
    assert.deepEqual(r.compuesta, ['devolver', 'asignar']);
    assert.equal(r.disparo, 'directa', 'tiene endpoint propio y botón');

    // Y las demás no son compuestas: si `compuesta` se colara en otra, se
    // ejecutaría una cadena que nadie decidió.
    const otras = cat.operaciones.filter((o) => o.operacion !== 'reasignar');
    assert.ok(
      otras.every((o) => o.compuesta === null),
      'ninguna otra operación es compuesta',
    );
  });
});

describe('motivos: una operación retira los que resuelve', () => {
  /**
   * El equipo 0468 quedó `Asignado`, con responsable, y con
   * `ASIGNADO_SIN_RESPONSABLE` y `RESPONSABLE_NO_PERSONA` puestos. Lo hizo la
   * interfaz —`movimientos` lo atribuye a una `Asignación`, no al importador— y
   * `verificar-datos.sql` salía en rojo por una fila que estropeó la aplicación.
   *
   * Qué motivos retira cada operación lo dice `resuelto_por` en
   * `db/motivos.ts`. Estos casos comprueban las dos mitades del arreglo: que se
   * retiran los que la operación resuelve, y que **no** se retiran los que no.
   * Sin la segunda, un `DELETE` que borrara todos los motivos del equipo pasaría
   * la primera igual de verde y perdería que falta una contraseña BIOS.
   */
  const suite = ambito('resuelve');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let ana: string;
  let beto: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    ana = await crearEmpleado(`${suite.prefijo}ana`);
    beto = await crearEmpleado(`${suite.prefijo}beto`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([ana, beto]);
    await suite.limpiar();
  });

  const marcado = async (etiqueta: string, motivos: string[]) => {
    const id = await crearEquipo(c, etiqueta, sedeA);
    creados.push(id);
    await marcarEquipo(id, motivos);
    return id;
  };

  it('asignar retira ASIGNADO_SIN_RESPONSABLE y baja la marca', async () => {
    const id = await marcado(`${suite.prefijo}M1`, ['ASIGNADO_SIN_RESPONSABLE']);
    assert.deepEqual((await motivosDe(id)).motivos, ['ASIGNADO_SIN_RESPONSABLE']);

    const r = await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const despues = await motivosDe(id);
    assert.deepEqual(despues.motivos, [], 'el motivo que la asignación resuelve se va');
    assert.equal(
      despues.requiere_revision,
      false,
      'era el último motivo: la marca baja en la misma transacción (trigger de la 0006)',
    );
  });

  it('NO retira los motivos que no resuelve, y la marca se queda', async () => {
    // El caso del 0758: quedó asignado con SECRETO_NO_ES_SECRETO puesto, y ese
    // motivo habla de una clave que falta, no de quién tiene el equipo.
    const id = await marcado(`${suite.prefijo}M2`, [
      'ASIGNADO_SIN_RESPONSABLE',
      'SECRETO_NO_ES_SECRETO',
      'SIN_SERIAL',
    ]);

    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana })).estado, 200);

    const despues = await motivosDe(id);
    assert.deepEqual(
      despues.motivos,
      ['SECRETO_NO_ES_SECRETO', 'SIN_SERIAL'],
      'asignar no resuelve una clave que falta ni un serial que falta',
    );
    assert.equal(despues.requiere_revision, true, 'quedan motivos: sigue en la bandeja');
  });

  it('deja su propia fila de auditoría, distinta de la de la operación', async () => {
    const id = await marcado(`${suite.prefijo}M3`, ['RESPONSABLE_NO_PERSONA']);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana })).estado, 200);

    assert.equal(await contarAuditoria(id, 'asignar'), 1);
    assert.equal(
      await contarAuditoria(id, 'retirar_motivos_resueltos'),
      1,
      'quien audite «por qué dejó de estar marcado» busca el motivo, no la operación',
    );
  });

  it('no escribe auditoría cuando no había nada que retirar', async () => {
    // Si registrara igualmente, la tabla se llenaría de filas que dicen que no
    // pasó nada y dejaría de servir para distinguir lo que sí pasó.
    const id = await marcado(`${suite.prefijo}M4`, ['SIN_SERIAL']);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana })).estado, 200);

    assert.equal(await contarAuditoria(id, 'retirar_motivos_resueltos'), 0);
    assert.deepEqual((await motivosDe(id)).motivos, ['SIN_SERIAL']);
  });

  it('el estado del 0468 ya no es alcanzable: la base lo rechaza', async () => {
    /**
     * Este caso salió de un test mal escrito.
     *
     * Intentaba comprobar que `reasignar` retira los motivos, así: asignar a
     * Ana, volver a marcar, reasignar a Beto. La base rechazó el «volver a
     * marcar» y el test falló — y tenía razón la base. Un equipo `Asignado` no
     * puede llevar un motivo que diga que no se sabe quién lo tiene, venga de
     * donde venga (trigger de la 0018, acotado por la 0020).
     *
     * Lo que significa es más fuerte que lo que el test quería probar: el estado
     * en que quedó el 0468 **no se puede volver a construir**, ni desde la
     * aplicación ni con un INSERT a mano. La entrada `reasignar` de
     * `resuelto_por` se queda porque es cierta —reasignar resuelve esos
     * motivos—, pero su trabajo real lo hace el `asignar` de su cadena, y por
     * ahí ya está probado arriba.
     */
    const id = await marcado(`${suite.prefijo}M5`, ['ASIGNADO_SIN_RESPONSABLE']);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: ana })).estado, 200);
    assert.deepEqual((await motivosDe(id)).motivos, []);

    await assert.rejects(
      () => marcarEquipo(id, ['RESPONSABLE_EN_CONFLICTO']),
      'marcar un equipo asignado con un motivo de responsable tiene que fallar',
    );

    // Y no quedó a medias: el rechazo es al COMMIT y deshace la transacción.
    assert.deepEqual((await motivosDe(id)).motivos, []);
    assert.equal(await estadoDe(id), 'Asignado');
  });

  it('una operación que no resuelve nada no toca los motivos', async () => {
    // Trasladar no dice quién tiene el equipo. Si retirara algo, estaría
    // borrando marcas sin haber contestado su pregunta.
    const id = await marcado(`${suite.prefijo}M6`, ['ASIGNADO_SIN_RESPONSABLE']);
    const r = await c.post(`/api/equipos/${id}/trasladar`, { sede_destino_id: await segundaSede() });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.deepEqual((await motivosDe(id)).motivos, ['ASIGNADO_SIN_RESPONSABLE']);
  });

  it('si la asignación falla, el motivo NO se retira', async () => {
    // Las dos cosas van en la misma transacción. Retirar el motivo de una
    // operación que no llegó a pasar dejaría el equipo sin marca y sin
    // responsable: la fila del 0468 al revés.
    const id = await marcado(`${suite.prefijo}M7`, ['ASIGNADO_SIN_RESPONSABLE']);
    const r = await c.post(`/api/equipos/${id}/asignar`, {
      empleado_id: '00000000-0000-0000-0000-000000000000',
    });
    assert.notEqual(r.estado, 200, 'un empleado que no existe no se puede asignar');
    assert.deepEqual((await motivosDe(id)).motivos, ['ASIGNADO_SIN_RESPONSABLE']);
    assert.equal((await motivosDe(id)).requiere_revision, true);
  });
});
