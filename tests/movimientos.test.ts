/**
 * Las seis mutaciones de estado, el historial y la atomicidad. Etapa 5.
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
