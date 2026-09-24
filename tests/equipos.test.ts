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
  contarAuditoria,
  crearEmpleado,
  estadoDe,
  licenciaTipoDe,
  marcarEquipo,
  marcarNoAsignable,
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

  /**
   * Las notas del importador son el único rastro de lo que decía la hoja sobre
   * los responsables que no eran personas, y `verificar-datos.sql` §A cuenta
   * con ellas. Editar las notas no puede llevárselas por delante.
   *
   * Aquí se comprueba el contrato que la interfaz usa: el `PATCH` guarda lo que
   * se le manda, así que quien parte y vuelve a unir el texto es `NotasEquipo`.
   * Lo que este test fija es que la parte de origen SOBREVIVE a una edición
   * hecha como la hace la vista.
   */
  it('editar las notas conserva el rastro del importador', async () => {
    const r0 = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}NOTAS`,
      estado: 'Disponible',
      notas: 'USUARIO RESPONSABLE de origen: "POLIZA DE SEGURO"',
    });
    assert.equal(r0.estado, 201, JSON.stringify(r0.cuerpo));
    const id = (r0.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);

    // Lo que manda la vista al añadir una observación: las dos partes unidas.
    const r = await c.patch(`/api/equipos/${id}`, {
      notas: 'USUARIO RESPONSABLE de origen: "POLIZA DE SEGURO" | teclado en inglés',
    });
    assert.equal(r.estado, 200);

    const { equipo } = (await c.get(`/api/equipos/${id}`)).cuerpo as {
      equipo: { notas: string };
    };
    assert.match(equipo.notas, /POLIZA DE SEGURO/, 'el rastro del origen sigue ahí');
    assert.match(equipo.notas, /teclado en inglés/);
  });

  it('las notas del alta llegan a la base', async () => {
    // Existían en el esquema desde la 0000 y el formulario no podía escribirlas.
    const r = await c.post('/api/equipos', {
      categoria: 'Monitor',
      etiqueta: `${suite.prefijo}NOTAS2`,
      estado: 'Disponible',
      notas: 'Llegó con el cable suelto',
    });
    assert.equal(r.estado, 201);
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);

    const { equipo } = (await c.get(`/api/equipos/${id}`)).cuerpo as {
      equipo: { notas: string | null };
    };
    assert.equal(equipo.notas, 'Llegó con el cable suelto');
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

// ---------------------------------------------------------------------------
// La bandeja se vacía: cerrar motivos y fijar quién tiene un préstamo (5e)
// ---------------------------------------------------------------------------
//
// Los casos se escriben desde `docs/decisiones-05.md`, no desde el código: D31
// dice que el filtro de una empresa incluye lo que tiene PRESTADO, y el encargo
// de la interfaz dice que `PROPIEDAD_AMBIGUA` y `RESPONSABLE_EN_CONFLICTO`
// tienen que ser resolubles y no solo visibles.

describe('bandeja: los motivos se cierran, y el último baja la marca', () => {
  const suite = ambito('bandeja');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}tenedor`);
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /** Un equipo con los motivos que se le pidan, ya marcado. */
  const marcado = async (etiqueta: string, motivos: string[], serial?: string) => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta,
      serial: serial ?? `SN-${etiqueta}`,
      estado: 'Disponible',
      sede_id: sedeA,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    await marcarEquipo(id, motivos);
    return id;
  };

  it('cerrar un motivo de varios lo quita y deja la marca puesta', async () => {
    const id = await marcado(`${suite.prefijo}B1`, ['PROPIEDAD_AMBIGUA', 'SIN_MARCA']);

    const r = await c.pedir('DELETE', `/api/equipos/${id}/motivos/PROPIEDAD_AMBIGUA`);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const { equipo } = r.cuerpo as {
      equipo: { motivos_revision: string[]; requiere_revision: boolean };
    };
    assert.deepEqual(equipo.motivos_revision, ['SIN_MARCA']);
    assert.equal(equipo.requiere_revision, true, 'queda uno: la marca sigue');

    // El caso estático de `api.test.ts` comprueba que la LLAMADA está escrita.
    // Este comprueba que la fila LLEGA. Hacen falta los dos: una llamada dentro
    // de un  que nunca se cumple pasaría el primero y fallaría este.
    assert.equal(await contarAuditoria(id, 'cerrar_motivo'), 1);
  });

  it('cerrar el ULTIMO baja la marca, que es el mismo hecho', async () => {
    const id = await marcado(`${suite.prefijo}B2`, ['PROPIEDAD_AMBIGUA']);

    const r = await c.pedir('DELETE', `/api/equipos/${id}/motivos/PROPIEDAD_AMBIGUA`);
    assert.equal(r.estado, 200);

    const { equipo } = r.cuerpo as {
      equipo: { motivos_revision: string[]; requiere_revision: boolean };
    };
    assert.deepEqual(equipo.motivos_revision, []);
    assert.equal(equipo.requiere_revision, false, 'sin motivos no hay marca (0006)');
  });

  it('cerrar un motivo que no esta puesto: 409, no un 200 que no hizo nada', async () => {
    const id = await marcado(`${suite.prefijo}B3`, ['SIN_MARCA']);
    const r = await c.pedir('DELETE', `/api/equipos/${id}/motivos/PROPIEDAD_AMBIGUA`);
    assert.equal(r.estado, 409);
  });

  it('un codigo inventado: 400, y no un cero silencioso', async () => {
    const id = await marcado(`${suite.prefijo}B4`, ['SIN_MARCA']);
    const r = await c.pedir('DELETE', `/api/equipos/${id}/motivos/NO_EXISTE`);
    assert.equal(r.estado, 400);
  });

  /**
   * El caso que impide cerrar la limpieza en falso, y viene de la etapa 2: la
   * marca es lo que saca la fila del índice único parcial. Bajarla con el
   * duplicado todavía dentro tiene que rebotar en Postgres, no aquí.
   */
  it('no se cierra el ultimo motivo si el duplicado sigue ahi', async () => {
    const choque = `SN-${suite.prefijo}CHOQUE`;
    const uno = await marcado(`${suite.prefijo}B5a`, ['SERIAL_DUPLICADO'], choque);
    const dos = await marcado(`${suite.prefijo}B5b`, ['SERIAL_DUPLICADO'], choque);

    // El primero sí puede salir: mientras el otro siga marcado, el índice solo
    // ve una fila limpia con ese serial.
    assert.equal(
      (await c.pedir('DELETE', `/api/equipos/${uno}/motivos/SERIAL_DUPLICADO`)).estado,
      200,
    );
    // El segundo no: dejarlo salir pondría dos filas limpias con el mismo
    // serial, que es justo lo que el índice existe para impedir.
    const r = await c.pedir('DELETE', `/api/equipos/${dos}/motivos/SERIAL_DUPLICADO`);
    assert.notEqual(r.estado, 200, `el segundo no deberia poder cerrarse, dio ${r.estado}`);
  });

  it('fijar quien tiene un equipo prestado, y solo si esta prestado', async () => {
    const id = await marcado(`${suite.prefijo}B6`, ['RESPONSABLE_EN_CONFLICTO']);

    // Disponible: no aplica, y el 409 dice cuál es la operación buena.
    const antes = await c.post(`/api/equipos/${id}/tenedor`, { empleado_id: empleado });
    assert.equal(antes.estado, 409);
    assert.match((antes.cuerpo as { error: string }).error, /asignar/i);

    assert.equal((await c.post(`/api/equipos/${id}/prestar`, { prestado_a: 'ISF' })).estado, 200);

    const r = await c.post(`/api/equipos/${id}/tenedor`, { empleado_id: empleado });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    const { equipo } = r.cuerpo as { equipo: { empleado_id: string | null; estado: string } };
    assert.equal(equipo.empleado_id, empleado);
    assert.equal(equipo.estado, 'Prestado', 'fijar el tenedor NO mueve el estado');

    // Y se puede volver a dejar sin decidir.
    const vacia = await c.post(`/api/equipos/${id}/tenedor`, { empleado_id: null });
    assert.equal((vacia.cuerpo as { equipo: { empleado_id: null } }).equipo.empleado_id, null);

    // Dos escrituras, dos filas. Y el 409 de antes NO escribió ninguna:
    // auditar un intento rechazado diría que alguien cambió algo.
    assert.equal(await contarAuditoria(id, 'fijar_tenedor'), 2);
  });
});

// ---------------------------------------------------------------------------
// D31: la empresa que TIENE un equipo también lo ve
// ---------------------------------------------------------------------------

describe('equipos: el filtro por empresa incluye lo prestado (D31)', () => {
  const suite = ambito('empresafiltro');
  let admin: UsuarioDePrueba;
  let sedeA: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sedeA = await primeraSede();
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await suite.limpiar();
  });

  it('sale en la lista del dueno Y en la de quien lo tiene', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}PRESTADO`,
      serial: `SN-${suite.prefijo}PRESTADO`,
      estado: 'Disponible',
      sede_id: sedeA,
      empresa: 'BBL Labs',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);

    assert.equal((await c.post(`/api/equipos/${id}/prestar`, { prestado_a: 'RIWI' })).estado, 200);

    const saleEn = async (empresa: string) => {
      const p = await c.get(
        `/api/equipos?empresa=${encodeURIComponent(empresa)}&q=${suite.prefijo}PRESTADO`,
      );
      return (p.cuerpo as { filas: { id: string }[] }).filas.some((f) => f.id === id);
    };

    assert.ok(await saleEn('BBL Labs'), 'el dueno tiene que verlo');
    assert.ok(await saleEn('RIWI'), 'quien lo tiene en la mano, tambien: es lo que D31 compro');
    assert.ok(!(await saleEn('Sin clasificar')), 'y nadie mas');
  });

  it('los conteos por empresa vienen con el listado y traen las tres claves', async () => {
    const p = await c.get('/api/equipos?porPagina=1');
    const { conteos_empresa } = p.cuerpo as { conteos_empresa: Record<string, number> };
    for (const clave of ['RIWI', 'BBL Labs', 'Sin clasificar']) {
      assert.ok(
        clave in conteos_empresa,
        `falta la clave "${clave}": GROUP BY no devuelve grupos vacios, y sin rellenarlos ` +
          `la interfaz no distingue "ninguno" de "no se pudo contar"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Cerrar un motivo en todo su bloque
// ---------------------------------------------------------------------------

describe('bandeja: un motivo se cierra en todo su bloque', () => {
  const suite = ambito('bloque');
  let admin: UsuarioDePrueba;
  let tecnico: UsuarioDePrueba;
  let sede: string;
  const creados: string[] = [];
  let c: Cliente;

  /** Suficientes para que «en bloque» signifique algo y no sea un cierre suelto. */
  const CUANTOS = 6;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    tecnico = await suite.crearUsuario({ sufijo: 'tec', rol: 'tecnico' });
    sede = await primeraSede();
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await suite.limpiar();
  });

  async function equipoMarcado(etiqueta: string, motivos: string[], serial?: string) {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}${etiqueta}`,
      serial: serial ?? `SN-${suite.prefijo}${etiqueta}`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    // Sin motivos NO se marca: `marcarEquipo([])` pondría la marca sin ninguna
    // fila que la justifique, que es lo que el CONSTRAINT TRIGGER de la 0006
    // impide. Este equipo existe para ocupar el serial, no para estar marcado.
    if (motivos.length > 0) await marcarEquipo(id, motivos);
    return id;
  }

  it('un técnico no puede cerrar un bloque entero', async () => {
    const otro = nuevo();
    await otro.entrar(tecnico.email, tecnico.password);
    const r = await otro.post('/api/equipos/revision/cerrar-en-bloque', {
      motivo: 'LICENCIA_OK',
    });
    // El permiso es proporcional al alcance: cerrar uno es `autenticado`,
    // cerrar cientos de una vez no.
    assert.equal(r.estado, 403, JSON.stringify(r.cuerpo));
  });

  it('cierra el bloque completo y deja constancia en las notas', async () => {
    const ids: string[] = [];
    for (let i = 0; i < CUANTOS; i++) {
      ids.push(await equipoMarcado(`B${i}`, ['LICENCIA_OK']));
    }

    // Una fila con DOS motivos: cerrar uno no debe bajarle la marca, porque el
    // otro sigue pendiente. Sin este caso, un cierre en bloque que desmarcara
    // todo lo tocado pasaría igual.
    const conDos = await equipoMarcado('BDOS', ['LICENCIA_OK', 'SIN_SERIAL']);

    const NOTA = 'Licencia verificada como correcta el 2026-09-22 por Johan';
    const r = await c.post('/api/equipos/revision/cerrar-en-bloque', {
      motivo: 'LICENCIA_OK',
      nota: NOTA,
    });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const res = r.cuerpo as {
      cerrados: number;
      fallidos: { equipo_id: string; problema: string | null }[];
    };
    assert.equal(res.fallidos.length, 0, JSON.stringify(res.fallidos));
    // `>=` y no `===`: la base de tests es compartida y otra suite puede
    // haber dejado filas con este motivo. Lo que se afirma es que las nuestras
    // entraron, y eso se comprueba fila a fila abajo.
    assert.ok(res.cerrados >= CUANTOS + 1, `cerró ${res.cerrados}`);

    for (const id of ids) {
      const eq_ = (await c.get(`/api/equipos/${id}`)).cuerpo as {
        equipo: { motivos_revision: string[]; requiere_revision: boolean; notas: string | null };
      };
      assert.deepEqual(eq_.equipo.motivos_revision, [], 'quedó un motivo sin cerrar');
      // Cerrar el último motivo baja la marca: son el mismo hecho, y lo dice el
      // CONSTRAINT TRIGGER de la 0006.
      assert.equal(eq_.equipo.requiere_revision, false);
      // La constancia: un NULL sin más y un NULL con constancia de que se
      // revisó se leen igual dentro de un año, y no son lo mismo.
      assert.match(eq_.equipo.notas ?? '', /Licencia verificada como correcta/);
      // Y el tipo NO se inventó. Es la mitad que importa: cerrar el motivo no
      // es rellenar el dato.
      assert.equal(await licenciaTipoDe(id), null);
      // Toda escritura sobre `equipos` deja rastro (§5), también en bloque.
      assert.equal(await contarAuditoria(id, 'cerrar_motivo'), 1);
    }

    // La fila con dos motivos perdió uno y sigue marcada por el otro.
    const dos = (await c.get(`/api/equipos/${conDos}`)).cuerpo as {
      equipo: { motivos_revision: string[]; requiere_revision: boolean };
    };
    assert.deepEqual(dos.equipo.motivos_revision, ['SIN_SERIAL']);
    assert.equal(dos.equipo.requiere_revision, true);
  });

  /**
   * El caso que justifica los savepoints, y el que un cierre en bloque ingenuo
   * rompería: una fila del bloque NO puede cerrarse.
   *
   * Dos equipos comparten serial. Mientras están marcados, el índice único
   * parcial de `serial` no les aplica; al cerrar el último motivo de uno, la
   * marca baja y el índice vuelve a exigir unicidad sobre esa fila. Postgres
   * rechaza **esa**, y con una sola transacción envolvente se llevaría por
   * delante a todas las demás del bloque.
   */
  it('una fila que no se deja cerrar no tumba el resto del bloque', async () => {
    const SERIAL = `SN-${suite.prefijo}CHOQUE`;
    // ORDEN: primero el MARCADO y después el limpio.
    //
    // Al revés no se puede montar el escenario: el índice único parcial sí
    // aplica a la fila sin marca, así que crear el limpio primero hace que la
    // API rechace el segundo con un 409 y el caso no llegue a existir. Marcado
    // primero, queda fuera del índice y el limpio entra sin problema.
    const choca = await equipoMarcado('CHOCA', ['MARCADOR_EN_CAMPO_TECNICO'], SERIAL);
    await equipoMarcado('LIMPIO', [], SERIAL);
    // Y dos más con el mismo motivo que sí pueden cerrarse.
    const buenos = [
      await equipoMarcado('OK1', ['MARCADOR_EN_CAMPO_TECNICO']),
      await equipoMarcado('OK2', ['MARCADOR_EN_CAMPO_TECNICO']),
    ];

    const r = await c.post('/api/equipos/revision/cerrar-en-bloque', {
      motivo: 'MARCADOR_EN_CAMPO_TECNICO',
    });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

    const res = r.cuerpo as {
      cerrados: number;
      fallidos: { equipo_id: string; etiqueta: string | null; problema: string | null }[];
    };

    // La que choca viene con NOMBRE, no como un número: un recuento de fallos
    // sin nombres obliga a buscarlos a mano.
    const fallida = res.fallidos.find((f) => f.equipo_id === choca);
    assert.ok(fallida, `esperaba ${choca} entre los fallidos: ${JSON.stringify(res.fallidos)}`);
    assert.ok(fallida.problema, 'el fallo tiene que decir por qué');

    // Y las otras dos entraron. Es la propiedad de los savepoints: el rechazo
    // se queda en su fila.
    for (const id of buenos) {
      const eq_ = (await c.get(`/api/equipos/${id}`)).cuerpo as {
        equipo: { motivos_revision: string[] };
      };
      assert.deepEqual(eq_.equipo.motivos_revision, [], 'una fila buena se fue con la mala');
    }

    // La que falló sigue marcada: no se cerró en falso.
    const sigue = (await c.get(`/api/equipos/${choca}`)).cuerpo as {
      equipo: { motivos_revision: string[]; requiere_revision: boolean; notas: string | null };
    };
    assert.deepEqual(sigue.equipo.motivos_revision, ['MARCADOR_EN_CAMPO_TECNICO']);
    assert.equal(sigue.equipo.requiere_revision, true);
  });

  it('la nota no se escribe en las filas que no se pudieron cerrar', async () => {
    const SERIAL = `SN-${suite.prefijo}CHOQUE2`;
    // Mismo orden que arriba, y por lo mismo.
    const choca = await equipoMarcado('CHOCA2', ['ESTADO_NO_APLICA'], SERIAL);
    await equipoMarcado('LIMPIO2', [], SERIAL);

    const r = await c.post('/api/equipos/revision/cerrar-en-bloque', {
      motivo: 'ESTADO_NO_APLICA',
      nota: 'NOTA QUE NO DEBE QUEDAR',
    });
    assert.equal(r.estado, 200);
    assert.ok(
      (r.cuerpo as { fallidos: { equipo_id: string }[] }).fallidos.some(
        (f) => f.equipo_id === choca,
      ),
    );

    // La nota va en la misma transacción que el cierre, así que al deshacerse
    // el cierre se deshace la nota. Sin esto, una fila seguiría marcada Y con
    // una constancia diciendo que se revisó y se resolvió.
    const eq_ = (await c.get(`/api/equipos/${choca}`)).cuerpo as {
      equipo: { notas: string | null };
    };
    assert.doesNotMatch(eq_.equipo.notas ?? '', /NOTA QUE NO DEBE QUEDAR/);
  });

  it('un motivo que no existe es 400, no un bloque vacío en silencio', async () => {
    const r = await c.post('/api/equipos/revision/cerrar-en-bloque', {
      motivo: 'MOTIVO_INVENTADO',
    });
    assert.equal(r.estado, 400, JSON.stringify(r.cuerpo));
  });
});

// ---------------------------------------------------------------------------
// D44 — los equipos que no se asignan a nadie
// ---------------------------------------------------------------------------

describe('infraestructura: un switch no se le entrega a nadie', () => {
  const suite = ambito('infra');
  let admin: UsuarioDePrueba;
  let sede: string;
  let empleado: string;
  const creados: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    empleado = await crearEmpleado(`${suite.prefijo}titular`, 'RIWI');
    c = nuevo();
    await c.entrar(admin.email, admin.password);
  });

  after(async () => {
    await borrarEquipos(creados);
    await borrarEmpleados([empleado]);
    await suite.limpiar();
  });

  /** Un equipo normal, que después se marca como infraestructura. */
  async function equipoInfra(etiqueta: string) {
    const r = await c.post('/api/equipos', {
      categoria: 'Otro',
      etiqueta: `${suite.prefijo}${etiqueta}`,
      serial: `SN-${suite.prefijo}${etiqueta}`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    await marcarNoAsignable(id);
    return id;
  }

  /**
   * Las tres operaciones que ponen a alguien detrás del equipo.
   *
   * Se prueban las tres y no una: la regla vive en un CAMPO de la tabla de
   * transiciones, y un campo mal puesto en una sola de ellas dejaría esa
   * abierta sin que las otras lo delataran.
   */
  for (const [op, cuerpo] of [
    ['asignar', { empleado_id: null as string | null }],
    ['reservar', {}],
    ['prestar', { prestado_a: 'BBL Labs' }],
  ] as const) {
    it(`${op} sobre infraestructura es 409, y dice por qué`, async () => {
      const id = await equipoInfra(`OP${op.slice(0, 3)}`);
      const datos = op === 'asignar' ? { empleado_id: empleado } : cuerpo;

      const r = await c.post(`/api/equipos/${id}/${op}`, datos);
      assert.equal(r.estado, 409, JSON.stringify(r.cuerpo));

      const b = r.cuerpo as { error: string; motivo?: string; puedes?: unknown };
      assert.match(b.error, /infraestructura/i);
      assert.equal(b.motivo, 'no_asignable');
      // NO ofrece alternativas: no hay ninguna que funcione mientras siga
      // marcado, y una lista de opciones que fallan manda a probar una por una.
      assert.equal(b.puedes, undefined);

      // Y sobre la base: no se movió nada.
      assert.equal(await estadoDe(id), 'Disponible');
    });
  }

  /**
   * El otro lado, y sin él lo de arriba lo pasaría un servidor que rechazara
   * TODAS las operaciones: mantenimiento sí aplica. Un switch se avería.
   */
  it('mantenimiento sí aplica a la infraestructura', async () => {
    const id = await equipoInfra('MTTO');
    const r = await c.post('/api/mantenimientos', {
      equipo_id: id,
      tipo: 'Correctivo',
      descripcion: 'El switch no enciende',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    assert.equal(await estadoDe(id), 'En mantenimiento');
  });

  it('dar de baja también', async () => {
    const id = await equipoInfra('BAJA');
    const r = await c.post(`/api/equipos/${id}/baja`, { motivo: 'Fin de vida útil' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(await estadoDe(id), 'De baja');
  });

  /**
   * El catálogo no ofrece lo que el servidor va a rechazar.
   *
   * Es la lección del botón con 404 de la 5d: si la lista que pinta la pantalla
   * y la regla que aplica el servidor salen de sitios distintos, se separan.
   */
  it('el catálogo trae una lista aparte para los no asignables', async () => {
    const r = await c.get('/api/transiciones');
    assert.equal(r.estado, 200);
    const cat = r.cuerpo as {
      por_estado: Record<string, string[]>;
      por_estado_no_asignable: Record<string, string[]>;
      operaciones: { operacion: string; requiere_asignable: boolean }[];
    };

    // Desde Disponible, un equipo normal puede asignarse, reservarse y prestarse.
    for (const op of ['asignar', 'reservar', 'prestar']) {
      assert.ok(cat.por_estado.Disponible.includes(op), `falta ${op} en por_estado`);
      assert.ok(
        !cat.por_estado_no_asignable.Disponible.includes(op),
        `${op} no debería ofrecerse para infraestructura`,
      );
    }

    // Y lo que sí queda: no puede ser una lista vacía, o la pantalla de un
    // switch no tendría ningún botón y no se podría ni dar de baja.
    assert.ok(
      cat.por_estado_no_asignable.Disponible.length > 0,
      'un no asignable se quedó sin ninguna operación',
    );

    // El campo que lo sostiene sale a la API, que es lo que permite a la
    // pantalla explicar por qué falta un botón.
    const asignar = cat.operaciones.find((o) => o.operacion === 'asignar');
    assert.equal(asignar?.requiere_asignable, true);
    const baja = cat.operaciones.find((o) => o.operacion === 'baja');
    assert.equal(baja?.requiere_asignable, false);
  });

  /**
   * La CHECK es la que sostiene la regla, no la guarda del repositorio.
   *
   * Se comprueba marcando como infraestructura un equipo que YA está asignado:
   * ese camino no pasa por `mutar`, así que si la base no lo parara, la regla
   * se podría saltar con un PATCH.
   */
  it('no se puede marcar como infraestructura un equipo que ya está asignado', async () => {
    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}YAASIG`,
      serial: `SN-${suite.prefijo}YAASIG`,
      estado: 'Disponible',
      sede_id: sede,
    });
    const id = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    creados.push(id);
    assert.equal((await c.post(`/api/equipos/${id}/asignar`, { empleado_id: empleado })).estado, 200);

    await assert.rejects(
      () => marcarNoAsignable(id),
      /check|constraint|asignable/i,
      'la base tendría que haber parado esto',
    );
    assert.equal(await estadoDe(id), 'Asignado');
  });
});
