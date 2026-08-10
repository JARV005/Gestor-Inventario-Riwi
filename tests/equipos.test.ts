/**
 * Altas de equipo y agregados.
 *
 * Las dos cosas que la etapa 4b añadió del lado del servidor: que `POST
 * /api/equipos` escriba la fila **y su movimiento `Alta`** en la misma
 * transacción, y que `GET /api/equipos/resumen` cuente en Postgres.
 *
 * La primera suite existe porque el fallo ya estaba puesto: `crear()` insertaba
 * solo en `equipos`. Mientras nadie escribiera equipos desde la aplicación no
 * se notaba —las 186 filas del Excel las trajo el importador, que sí escribía
 * su `Alta`— y el síntoma habría salido en `verificar-datos.sql` §F días
 * después del alta que lo causó, cuando ya no se sabe cuál fue.
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
  contarEquiposConEtiqueta,
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

const nuevo = () => new Cliente(servidor.url);

// ---------------------------------------------------------------------------
// El alta escribe en `equipos` y `movimientos`, o no escribe nada
// ---------------------------------------------------------------------------
//
// Regla 5 del proyecto e invariante F de `verificar-datos.sql`: todo equipo
// tiene exactamente un `Alta`, y es su movimiento más antiguo. Se prueba por
// los dos lados: que el alta buena deje las dos filas y que la rechazada no
// deje ninguna.

describe('equipos: el alta escribe también su movimiento', () => {
  const suite = ambito('alta');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}receptor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  it('deja exactamente un Alta, con su autor y su destino', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}ALTA1`,
      marca: 'Dell',
      modelo: 'Latitude 5440',
      serial: `SN-${suite.prefijo}ALTA1`,
      estado: 'Disponible',
      sede_id: sede,
    });
    assert.equal(r.estado, 201);
    const { equipo } = r.cuerpo as { equipo: { id: string } };
    creados.push(equipo.id);

    const movs = await movimientosDe(equipo.id);
    assert.equal(movs.length, 1, 'un alta escribe un movimiento y solo uno');
    assert.equal(movs[0].tipo, 'Alta');
    assert.equal(movs[0].sede_destino_id, sede, 'el destino es la sede del equipo');
    assert.equal(movs[0].usuario_app_id, admin.id, 'el autor es quien hizo la petición');
  });

  it('el destino recoge al responsable cuando lo hay', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}ALTA2`,
      marca: 'HP',
      modelo: 'EliteBook 840',
      serial: `SN-${suite.prefijo}ALTA2`,
      estado: 'Asignado',
      empleado_id: empleado,
      sede_id: sede,
    });
    assert.equal(r.estado, 201);
    const { equipo } = r.cuerpo as { equipo: { id: string } };
    creados.push(equipo.id);

    const movs = await movimientosDe(equipo.id);
    assert.equal(movs.length, 1);
    assert.equal(movs[0].empleado_destino_id, empleado);
  });

  // El otro lado. Sin esto, un `crear` que insertara el equipo y fallara al
  // escribir el movimiento pasaría los dos tests de arriba y dejaría basura.
  it('un alta rechazada no deja ni el equipo ni el movimiento', async () => {
    const etiqueta = `${suite.prefijo}ALTA3`;
    // 'Asignado' sin responsable viola equipos_asignado_implica_empleado.
    const r = await c.post('/api/equipos', {
      categoria: 'Mouse',
      etiqueta,
      estado: 'Asignado',
    });
    assert.equal(r.estado, 409);
    assert.equal(await contarEquiposConEtiqueta(etiqueta), 0, 'no quedó el equipo a medias');
  });

  /**
   * La regla 5 del proyecto por su otra cara: si el `PATCH` pudiera mover el
   * estado, existiría una forma de cambiar un equipo sin escribir su
   * movimiento, y el historial tendría agujeros que nadie ve.
   *
   * El 409 y no un descarte silencioso: `.omit()` a secas devolvería 200 sin
   * hacer lo que le pidieron, que es el mismo fallo que tenía `costo`.
   */
  it('el PATCH no puede mover estado, responsable ni sede', async () => {
    const id = creados[0];
    const antes = await movimientosDe(id);

    for (const [campo, valor] of [
      ['estado', 'De baja'],
      ['empleado_id', empleado],
      ['sede_id', sede],
    ] as const) {
      const r = await c.patch(`/api/equipos/${id}`, { [campo]: valor });
      assert.equal(r.estado, 409, `${campo} debería rechazarse`);
      const cuerpo = r.cuerpo as { error: string; campo: string };
      assert.equal(cuerpo.campo, campo);
      // El mensaje tiene que decir por dónde va, no solo que no.
      assert.match(cuerpo.error, /POST \/api\/equipos/, cuerpo.error);
    }

    assert.deepEqual(
      (await movimientosDe(id)).length,
      antes.length,
      'ninguno de los tres intentos escribió nada',
    );
    assert.equal(await estadoDe(id), 'Disponible', 'y el estado sigue donde estaba');
  });

  it('lo que el PATCH sí edita sigue funcionando', async () => {
    // Que el bloqueo de arriba no se haya llevado por delante la edición de la
    // ficha: sin esto, un `.omit()` de más pasaría los dos tests.
    const id = creados[0];
    const r = await c.patch(`/api/equipos/${id}`, { notas: 'teclado ES', ram: '32 GB' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    const { equipo } = r.cuerpo as { equipo: { notas: string; ram: string } };
    assert.equal(equipo.notas, 'teclado ES');
    assert.equal(equipo.ram, '32 GB');
  });

  it('el costo que manda el formulario llega a la base', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Monitor',
      etiqueta: `${suite.prefijo}ALTA4`,
      marca: 'LG',
      modelo: '24MK430H',
      serial: `SN-${suite.prefijo}ALTA4`,
      estado: 'Disponible',
      costo: '1250000.00',
    });
    assert.equal(r.estado, 201);
    const { equipo } = r.cuerpo as { equipo: { id: string; costo: string | null } };
    creados.push(equipo.id);
    assert.equal(equipo.costo, '1250000.00');
  });

  it('un costo con formato de miles se rechaza, no se trunca', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Monitor',
      etiqueta: `${suite.prefijo}ALTA5`,
      estado: 'Disponible',
      costo: '1.250.000,00',
    });
    assert.equal(r.estado, 400);
  });

  // Lo que el formulario ya no manda, y que la BD no debe recibir por su
  // cuenta: una condición sobre un portátil rompe `verificar-datos.sql` §D.
  it('no inventa condición ni fecha de compra', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}ALTA6`,
      marca: 'Lenovo',
      modelo: 'T14',
      serial: `SN-${suite.prefijo}ALTA6`,
      estado: 'Disponible',
    });
    assert.equal(r.estado, 201);
    const { equipo } = r.cuerpo as {
      equipo: { id: string; condicion: string | null; fecha_compra: string | null };
    };
    creados.push(equipo.id);
    assert.equal(equipo.condicion, null, 'un portátil no puede llevar condición (§D)');
    assert.equal(equipo.fecha_compra, null, 'la fecha de compra no se sabe: no se rellena');
  });
});

// ---------------------------------------------------------------------------
// El resumen agregado
// ---------------------------------------------------------------------------

describe('equipos: el resumen cuenta en Postgres', () => {
  const suite = ambito('resumen');
  let admin: UsuarioDePrueba;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await suite.limpiar();
  });

  // 'resumen' se registra antes que '/:id'. Si alguien las reordena, esto
  // devuelve 400 por uuid inválido en vez del resumen — el modo de fallo que
  // el comentario del fichero de rutas anuncia.
  it('la ruta no la intercepta /api/equipos/:id', async () => {
    const r = await c.get('/api/equipos/resumen');
    assert.equal(r.estado, 200);
    const cuerpo = r.cuerpo as { total: number; por_estado: unknown[] };
    assert.equal(typeof cuerpo.total, 'number');
    assert.ok(Array.isArray(cuerpo.por_estado));
  });

  it('los grupos suman el total, y el total cuadra con el listado', async () => {
    const resumen = (await c.get('/api/equipos/resumen')).cuerpo as {
      total: number;
      por_estado: { estado: string; equipos: number }[];
      por_categoria: { categoria: string; equipos: number }[];
    };

    const suma = (xs: { equipos: number }[]) => xs.reduce((a, x) => a + x.equipos, 0);
    assert.equal(suma(resumen.por_estado), resumen.total, 'por_estado suma el total');
    assert.equal(suma(resumen.por_categoria), resumen.total, 'por_categoria suma el total');

    // Contra otra ruta que cuenta lo mismo por su cuenta: si el GROUP BY
    // contara mal, este otro número seguiría estando bien.
    const listado = (await c.get('/api/equipos?porPagina=1')).cuerpo as { total: number };
    assert.equal(resumen.total, listado.total);
  });

  it('un alta nueva mueve el conteo de su estado en uno', async () => {
    const antes = (await c.get('/api/equipos/resumen')).cuerpo as {
      total: number;
      por_estado: { estado: string; equipos: number }[];
    };
    const disponiblesAntes = antes.por_estado.find((e) => e.estado === 'Disponible')?.equipos ?? 0;

    const r = await c.post('/api/equipos', {
      categoria: 'Teclado',
      etiqueta: `${suite.prefijo}RES1`,
      marca: 'Logitech',
      modelo: 'K120',
      serial: `SN-${suite.prefijo}RES1`,
      estado: 'Disponible',
    });
    assert.equal(r.estado, 201);
    creados.push((r.cuerpo as { equipo: { id: string } }).equipo.id);

    const despues = (await c.get('/api/equipos/resumen')).cuerpo as {
      total: number;
      por_estado: { estado: string; equipos: number }[];
    };
    assert.equal(despues.total, antes.total + 1);
    assert.equal(
      despues.por_estado.find((e) => e.estado === 'Disponible')?.equipos ?? 0,
      disponiblesAntes + 1,
    );
  });
});
