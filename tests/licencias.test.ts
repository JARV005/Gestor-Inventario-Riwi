/**
 * Etapa 8b · D43 — el inventario de licencias.
 *
 * El caso que justifica el fichero es `la key no sale por ningún listado`: es la
 * misma regla que `bios_password`, y la forma de romperla es añadir un endpoint
 * que devuelva la fila entera sin darse cuenta.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  ambito,
  arrancar,
  borrarEquipos,
  Cliente,
  comprobarBaseDeTest,
  contarAuditoria,
  crearEmpleado,
  borrarEmpleados,
  crearLicencia,
  borrarLicencias,
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

describe('licencias: la key es un secreto del §5', () => {
  const suite = ambito('lic');
  let admin: UsuarioDePrueba;
  let tecnico: UsuarioDePrueba;
  let sede: string;
  let equipo: string;
  const licencias: string[] = [];
  const equipos: string[] = [];
  let c: Cliente;

  /** La key de prueba. Nunca debe aparecer en ninguna respuesta salvo /key. */
  const KEY = 'XXXXX-TEST1-TEST2-TEST3-TEST4';

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    tecnico = await suite.crearUsuario({ sufijo: 'tec', rol: 'tecnico' });
    sede = await primeraSede();
    c = nuevo();
    await c.entrar(admin.email, admin.password);

    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}EQ`,
      serial: `SN-${suite.prefijo}EQ`,
      estado: 'Disponible',
      sede_id: sede,
    });
    equipo = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    equipos.push(equipo);
  });

  after(async () => {
    await borrarLicencias(licencias);
    await borrarEquipos(equipos);
    await suite.limpiar();
  });

  async function licenciaConKey(descripcion: string, key: string | null = KEY) {
    const id = await crearLicencia({ tipo: 'Local', descripcion, key });
    licencias.push(id);
    return id;
  }

  /**
   * ========================================================================
   * EL CASO QUE JUSTIFICA EL FICHERO.
   * ========================================================================
   *
   * Se recorre la respuesta ENTERA buscando la key, a cualquier profundidad, en
   * vez de comprobar que falte un campo concreto. Un `assert` sobre el nombre
   * del campo se queda obsoleto en cuanto alguien renombre la columna o añada
   * un objeto anidado; buscar el VALOR no.
   */
  it('la key no aparece en el listado ni en el detalle', async () => {
    const id = await licenciaConKey('Windows 11 Pro');

    for (const url of ['/api/licencias', `/api/licencias/${id}`]) {
      const r = await c.get(url);
      assert.equal(r.estado, 200, url);
      assert.ok(
        !r.texto.includes(KEY),
        `la key salió en ${url}. Es un secreto del §5: fuera de listados y exportaciones.`,
      );
      // Y tampoco el nombre de la columna cifrada, que delataría su existencia
      // y su longitud si alguien devolviera el bytea en crudo.
      assert.ok(!r.texto.includes('key_cifrada'), `key_cifrada salió en ${url}`);
    }
  });

  it('el listado sí dice SI hay key, que es lo que hace falta ver', async () => {
    const conKey = await licenciaConKey('Con key');
    const sinKey = await licenciaConKey('Sin key', null);

    const r = await c.get('/api/licencias?porPagina=200');
    const filas = (r.cuerpo as { filas: { id: string; tiene_key: boolean }[] }).filas;

    assert.equal(filas.find((f) => f.id === conKey)?.tiene_key, true);
    assert.equal(filas.find((f) => f.id === sinKey)?.tiene_key, false);
  });

  it('la key se lee de una en una, y la lectura queda registrada', async () => {
    const id = await licenciaConKey('Para leer');

    const antes = await contarAuditoria(id, 'descifrar_key_licencia');
    const r = await c.get(`/api/licencias/${id}/key`);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal((r.cuerpo as { key: string }).key, KEY);

    assert.equal(
      await contarAuditoria(id, 'descifrar_key_licencia'),
      antes + 1,
      'leer un secreto sin dejar rastro es peor que un error',
    );
  });

  it('un técnico no puede leer la key', async () => {
    const id = await licenciaConKey('Solo admin');
    const otro = nuevo();
    await otro.entrar(tecnico.email, tecnico.password);

    const r = await otro.get(`/api/licencias/${id}/key`);
    assert.equal(r.estado, 403, JSON.stringify(r.cuerpo));
    assert.ok(!r.texto.includes(KEY));
  });

  it('la búsqueda no busca dentro de la key', async () => {
    await licenciaConKey('Buscable');

    // Buscar por un trozo de la key no debe encontrar nada: si encontrara, el
    // buscador sería un oráculo para adivinarla a trozos.
    const r = await c.get('/api/licencias?q=TEST1');
    assert.equal(r.estado, 200);
    assert.equal((r.cuerpo as { total: number }).total, 0, 'el buscador entra en la key');
  });
});

describe('licencias: activar, soltar y lo que no resuelve', () => {
  const suite = ambito('licact');
  let admin: UsuarioDePrueba;
  let sede: string;
  let equipo: string;
  const licencias: string[] = [];
  const equipos: string[] = [];
  let c: Cliente;

  before(async () => {
    admin = await suite.crearUsuario({ sufijo: 'admin', rol: 'admin' });
    sede = await primeraSede();
    c = nuevo();
    await c.entrar(admin.email, admin.password);

    const r = await c.post('/api/equipos', {
      categoria: 'Portátil',
      etiqueta: `${suite.prefijo}EQ`,
      serial: `SN-${suite.prefijo}EQ`,
      estado: 'Disponible',
      sede_id: sede,
    });
    equipo = (r.cuerpo as { equipo: { id: string } }).equipo.id;
    equipos.push(equipo);
  });

  after(async () => {
    await borrarLicencias(licencias);
    await borrarEquipos(equipos);
    await suite.limpiar();
  });

  it('activar la pone en el equipo y deja rastro; soltarla la devuelve a Disponible', async () => {
    const id = await crearLicencia({ tipo: 'Local', descripcion: 'Mover', key: 'K-1' });
    licencias.push(id);

    const act = await c.post(`/api/licencias/${id}/activar`, { equipo_id: equipo });
    assert.equal(act.estado, 200, JSON.stringify(act.cuerpo));
    let lic = (act.cuerpo as { licencia: { estado: string; equipo_id: string | null } }).licencia;
    assert.equal(lic.estado, 'Activada');
    assert.equal(lic.equipo_id, equipo);
    assert.equal(await contarAuditoria(id, 'activar_licencia'), 1);

    const sol = await c.post(`/api/licencias/${id}/activar`, { equipo_id: null });
    assert.equal(sol.estado, 200, JSON.stringify(sol.cuerpo));
    lic = (sol.cuerpo as { licencia: { estado: string; equipo_id: string | null } }).licencia;
    assert.equal(lic.estado, 'Disponible');
    assert.equal(lic.equipo_id, null);
    assert.equal(await contarAuditoria(id, 'soltar_licencia'), 1);
  });

  /**
   * La CHECK, no la aplicación.
   *
   * Una licencia `Disponible` con equipo puesto haría que el conteo de libres
   * mintiera, y es el tipo de fila que nadie descubre hasta que la busca.
   */
  it('la base impide una licencia Disponible con equipo puesto', async () => {
    await assert.rejects(
      () =>
        crearLicencia({
          tipo: 'Local',
          descripcion: 'Contradictoria',
          key: 'K-2',
          estado: 'Disponible',
          equipo_id: equipo,
        }),
      /check|constraint/i,
    );
  });

  /** Y el otro lado: una Activada tiene que decir dónde, de una de las dos formas. */
  it('la base impide una licencia Activada que no dice dónde', async () => {
    await assert.rejects(
      () =>
        crearLicencia({
          tipo: 'Local',
          descripcion: 'Activada en ninguna parte',
          key: 'K-3',
          estado: 'Activada',
        }),
      /check|constraint/i,
    );
  });

  /**
   * El caso de las doce de Barranquilla: apunta a algo que no está, y la
   * referencia del fichero es lo único que lo dice.
   */
  it('una licencia puede estar Activada contra una referencia sin resolver', async () => {
    const id = await crearLicencia({
      tipo: 'Local',
      descripcion: 'De Barranquilla',
      key: 'K-4',
      estado: 'Activada',
      equipo_referencia: 'BAQ-00003',
      requiere_revision: true,
    });
    licencias.push(id);

    const r = await c.get('/api/licencias?sin_equipo=true&porPagina=200');
    assert.equal(r.estado, 200);
    const cuerpo = r.cuerpo as {
      filas: { id: string; equipo_referencia: string | null }[];
      resumen: { sin_equipo_resuelto: number };
    };

    const fila = cuerpo.filas.find((f) => f.id === id);
    assert.ok(fila, 'la licencia sin equipo resuelto no aparece en su filtro');
    assert.equal(fila.equipo_referencia, 'BAQ-00003');
    assert.ok(
      cuerpo.resumen.sin_equipo_resuelto >= 1,
      'el resumen no cuenta las que apuntan a un equipo que no está',
    );
  });
});
