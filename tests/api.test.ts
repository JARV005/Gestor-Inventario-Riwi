/**
 * API núcleo: campos cifrados, roles y la desactivación de empleados.
 *
 * La regla que más fácil se rompe sola es la de los campos cifrados, así que se
 * comprueba en dos capas: sobre las respuestas —de éxito **y de error**— y
 * sobre el código de los repositorios.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

    // 500 de verdad: una FK que no existe hace que Postgres lance, y el error
    // de pg lleva dentro la consulta y a veces los valores.
    const revienta = await cAdmin.patch(`/api/equipos/${equipoId}`, {
      sede_id: '11111111-1111-1111-1111-111111111111',
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
