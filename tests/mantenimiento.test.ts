/**
 * Partes de mantenimiento. Etapa 5d.
 *
 * Lo que esta suite existe para demostrar:
 *
 *  1. Abrir un parte **manda el equipo al taller**, y las dos cosas van en la
 *     misma transacción. Si el equipo no se deja mover, no queda parte.
 *  2. Cerrar es **un solo gesto**: cierra el parte y saca el equipo del taller.
 *     Un equipo que vuelve y se queda en «En mantenimiento» porque alguien
 *     cerró el parte sin devolverlo es un equipo perdido con pasos extra.
 *  3. `En mantenimiento` deja de ser un estado sin salida: era el último hueco
 *     del enum.
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

describe('mantenimiento: el parte y el movimiento van juntos', () => {
  const suite = ambito('mant');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}titular`);
    c = new Cliente(servidor.url);
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  async function equipo(etiqueta: string): Promise<string> {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
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

  it('abrir un parte manda el equipo al taller y deja su movimiento', async () => {
    const id = await equipo(`${suite.prefijo}M1`);

    const r = await c.post('/api/mantenimientos', {
      equipo_id: id,
      tipo: 'Pantalla rota',
      descripcion: 'Se cayó de la mesa',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const parte = (r.cuerpo as { parte: { id: string; estado: string } }).parte;
    assert.equal(parte.estado, 'Pendiente');

    // Las dos mitades, leídas de la base.
    assert.equal(await estadoDe(id), 'En mantenimiento');
    const movs = await movimientosDe(id);
    assert.equal(movs.at(-1)?.tipo, 'Envío a mantenimiento');
    assert.equal(await contarAuditoria(id, 'enviar_mantenimiento'), 1);
    assert.equal(await contarAuditoria(parte.id, 'abrir_parte'), 1);
  });

  it('un equipo asignado no se manda al taller: 409 y NO queda parte', async () => {
    const id = await equipo(`${suite.prefijo}M2`);
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    const partesAntes = (await c.get(`/api/mantenimientos?equipo=${id}`)).cuerpo as {
      total: number;
    };

    const r = await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Revisión' });
    assert.equal(r.estado, 409);
    const cuerpo = r.cuerpo as { error: string; estado_actual: string; puedes: string[] };
    assert.equal(cuerpo.estado_actual, 'Asignado');
    assert.ok(cuerpo.puedes.includes('devolver'), 'dice la salida');
    assert.match(cuerpo.error, /No se abrió el parte/);

    // Nada a medias.
    assert.equal(await estadoDe(id), 'Asignado');
    const partesDespues = (await c.get(`/api/mantenimientos?equipo=${id}`)).cuerpo as {
      total: number;
    };
    assert.equal(partesDespues.total, partesAntes.total, 'no se abrió el parte');
  });

  it('dos partes abiertos del mismo equipo: el segundo choca', async () => {
    const id = await equipo(`${suite.prefijo}M3`);
    assert.equal((await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'A' })).estado, 201);

    // El segundo ni siquiera llega al índice: el equipo ya está «En
    // mantenimiento» y de ahí no sale `enviar_mantenimiento`.
    const r = await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'B' });
    assert.equal(r.estado, 409);
    assert.equal((r.cuerpo as { estado_actual: string }).estado_actual, 'En mantenimiento');
  });

  it('mover el parte entre estados abiertos NO toca el equipo', async () => {
    const id = await equipo(`${suite.prefijo}M4`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Teclado' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;

    for (const estado of ['En taller', 'Completado'] as const) {
      const r = await c.patch(`/api/mantenimientos/${parte.id}`, { estado });
      assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
      // `Completado` es «el taller terminó», no «el equipo volvió». Es la
      // distinción que hace que cerrar sea un solo gesto y no dos.
      assert.equal(await estadoDe(id), 'En mantenimiento', `${estado} no puede mover el equipo`);
    }

    const movs = await movimientosDe(id);
    assert.equal(
      movs.filter((m) => m.tipo === 'Retorno de mantenimiento').length,
      0,
      'ningún retorno todavía',
    );
  });

  it('cerrar por Devuelto en el PATCH: 409 que dice por dónde va', async () => {
    // Cerrar mueve el equipo, así que no puede entrar por un PATCH cuyo nombre
    // no lo dice. Es la misma regla que cerró el PATCH de equipos (D19).
    const id = await equipo(`${suite.prefijo}M5`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'X' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;

    // Los DOS estados de cierre, no solo uno. `Baja tras revisión` cierra
    // igual y mueve el equipo igual, y quedaba fuera: caía en el 400 de zod,
    // que dice «Entrada inválida» y no dice por dónde se cierra un parte.
    for (const estado of ['Devuelto', 'Baja tras revisión']) {
      const r = await c.patch(`/api/mantenimientos/${parte.id}`, { estado });
      assert.equal(r.estado, 409, `${estado} debería dar 409 y dio ${r.estado}`);
      assert.match((r.cuerpo as { error: string }).error, /cerrar/i);
      assert.equal(await estadoDe(id), 'En mantenimiento');
    }

    // Y el otro lado: un estado que no existe sigue siendo un 400 de entrada
    // inválida, no un 409. El 409 es «esto se hace en otro sitio», no «esto no
    // se entiende», y confundirlos mandaría a quien lo lea a una ruta que no
    // le sirve.
    const basura = await c.patch(`/api/mantenimientos/${parte.id}`, { estado: 'Inventado' });
    assert.equal(basura.estado, 400);
  });

  it('cerrar con retorno: un gesto que cierra el parte Y devuelve el equipo', async () => {
    const id = await equipo(`${suite.prefijo}M6`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Batería' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;

    const r = await c.post(`/api/mantenimientos/${parte.id}/cerrar`, { desenlace: 'retorno' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal((r.cuerpo as { parte: { estado: string } }).parte.estado, 'Devuelto');

    // Lo que la decisión promete: el equipo NO se queda en el taller.
    assert.equal(await estadoDe(id), 'Disponible');
    assert.equal((await movimientosDe(id)).at(-1)?.tipo, 'Retorno de mantenimiento');
    assert.equal(await contarAuditoria(id, 'retornar_mantenimiento'), 1);
  });

  it('cerrar sin arreglo: el equipo va a De baja, no a Disponible', async () => {
    // Sin este desenlace habría que cerrar como Devuelto —dejando un portátil
    // muerto en «Disponible»— y darlo de baja después. El inventario se puede
    // leer en ese minuto.
    const id = await equipo(`${suite.prefijo}M7`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Placa' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;

    const r = await c.post(`/api/mantenimientos/${parte.id}/cerrar`, { desenlace: 'baja' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal((r.cuerpo as { parte: { estado: string } }).parte.estado, 'Baja tras revisión');
    assert.equal(await estadoDe(id), 'De baja');
    assert.equal((await movimientosDe(id)).at(-1)?.tipo, 'Baja');
  });

  it('cerrar dos veces: 409, y el equipo no se mueve otra vez', async () => {
    const id = await equipo(`${suite.prefijo}M8`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Y' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;
    await c.post(`/api/mantenimientos/${parte.id}/cerrar`, { desenlace: 'retorno' });
    const movsAntes = (await movimientosDe(id)).length;

    const r = await c.post(`/api/mantenimientos/${parte.id}/cerrar`, { desenlace: 'retorno' });
    assert.equal(r.estado, 409);
    assert.match((r.cuerpo as { error: string }).error, /ya está cerrado/i);
    assert.equal((await movimientosDe(id)).length, movsAntes, 'no escribió otro movimiento');
  });

  it('el ciclo entero deja el historial completo, en orden', async () => {
    const id = await equipo(`${suite.prefijo}M9`);
    const parte = (
      (await c.post('/api/mantenimientos', { equipo_id: id, tipo: 'Ventilador' })).cuerpo as {
        parte: { id: string };
      }
    ).parte;
    await c.patch(`/api/mantenimientos/${parte.id}`, { estado: 'En taller' });
    await c.post(`/api/mantenimientos/${parte.id}/cerrar`, { desenlace: 'retorno' });
    await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado });

    assert.deepEqual(
      (await movimientosDe(id)).map((m) => m.tipo),
      ['Alta', 'Envío a mantenimiento', 'Retorno de mantenimiento', 'Asignación'],
    );
  });
});

// ---------------------------------------------------------------------------

describe('transiciones: ya no queda ningún estado sin salida', () => {
  const suite = ambito('sinhueco');
  let admin: UsuarioDePrueba;
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    c = new Cliente(servidor.url);
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await suite.limpiar();
  });

  /**
   * El criterio de que el modelo está completo. Hubo dos huecos —`Reservado`
   * desde la 0000 hasta la etapa 5, `En mantenimiento` hasta la 5d— y los dos
   * se descubrieron tarde. Esto los pone en rojo el día que aparezca un
   * tercero.
   */
  it('el catálogo no declara ningún estado sin operación, salvo De baja', async () => {
    const cat = (await c.get('/api/transiciones')).cuerpo as {
      operaciones: { operacion: string }[];
      por_estado: Record<string, string[]>;
      sin_operacion: string[];
    };

    assert.deepEqual(cat.sin_operacion, [], 'ESTADOS_SIN_OPERACION tiene que estar vacío');
    assert.equal(
      cat.operaciones.length,
      11,
      'seis mutaciones, envío y retorno de taller, prestar y recuperar, y reasignar',
    );

    // Todos los estados tienen salida menos «De baja», que es terminal a
    // propósito: un equipo destruido no vuelve.
    for (const [estado, ops] of Object.entries(cat.por_estado)) {
      if (estado === 'De baja') {
        assert.deepEqual(ops, [], 'De baja es terminal');
      } else {
        assert.ok(ops.length > 0, `${estado} se quedó sin ninguna operación`);
      }
    }

    // Y todos tienen ENTRADA: alguna operación lleva a ellos. `Disponible` la
    // tiene por el alta, que no es una transición.
    const destinos = new Set(
      cat.operaciones
        .map((o) => (o as { hacia?: string | null }).hacia)
        .filter((h): h is string => Boolean(h)),
    );
    for (const estado of Object.keys(cat.por_estado)) {
      if (estado === 'Disponible') continue; // entra por el alta
      assert.ok(destinos.has(estado), `a ${estado} no llega ninguna operación`);
    }
  });
});
