/**
 * Autenticación, por el lado negativo.
 *
 * Lo que importa aquí no es que acepte al usuario legítimo —eso es un solo
 * caso— sino que rechace todo lo demás. Los tests están escritos pensando en
 * qué intentaría alguien, no en qué hace el usuario correcto.
 *
 * Hay un puñado de casos positivos, y están para que los negativos signifiquen
 * algo: una batería en la que todo devuelve 401 pasaría entera con el login
 * roto del todo.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  arrancar,
  caducarSesiones,
  cambiarPassword,
  Cliente,
  cerrarPool,
  comprobarBaseDeTest,
  contarSesiones,
  crearUsuario,
  desactivar,
  limpiar,
  limpiarSesiones,
  type Servidor,
  type UsuarioDePrueba,
} from './ayuda.js';
import { clave, rutasRegistradas } from '../server/permisos.js';

let servidor: Servidor;
let admin: UsuarioDePrueba;
let tecnico: UsuarioDePrueba;

before(async () => {
  comprobarBaseDeTest();
  await limpiar();
  servidor = await arrancar();
  admin = await crearUsuario({ sufijo: 'admin', rol: 'admin' });
  tecnico = await crearUsuario({ sufijo: 'tecnico', rol: 'tecnico' });
});

after(async () => {
  await limpiar();
  await servidor.cerrar();
  await cerrarPool();
});

const nuevo = () => new Cliente(servidor.url);

// ---------------------------------------------------------------------------

describe('login: control positivo', () => {
  it('entra con credenciales correctas y devuelve el usuario sin password_hash', async () => {
    const c = nuevo();
    const r = await c.entrar(admin.email, admin.password);
    assert.equal(r.estado, 200);
    const cuerpo = r.cuerpo as { usuario: Record<string, unknown> };
    assert.equal(cuerpo.usuario.email, admin.email);
    assert.equal(cuerpo.usuario.rol, 'admin');
    assert.ok(!('password_hash' in cuerpo.usuario), 'el login no devuelve el hash');
    assert.match(r.texto.toLowerCase().includes('password_hash') ? 'fuga' : 'ok', /ok/);
  });

  it('la cookie es httpOnly y sameSite=strict', async () => {
    const c = nuevo();
    await c.entrar(admin.email, admin.password);
    // Se pide algo autenticado para forzar un Set-Cookie que podamos leer.
    const r = await c.get('/api/auth/me');
    assert.equal(r.estado, 200);
    const cookies = r.cabeceras.getSetCookie().join(' ; ');
    assert.match(cookies, /HttpOnly/i);
    assert.match(cookies, /SameSite=Strict/i);
  });
});

describe('login: no distingue por qué falla', () => {
  it('email inexistente y contraseña incorrecta dan la MISMA respuesta', async () => {
    const c = nuevo();
    const inexistente = await c.entrar('test-no-existe-jamas@bbl.local', 'lo-que-sea');
    const incorrecta = await c.entrar(admin.email, 'contrasena-equivocada');

    assert.equal(inexistente.estado, 401);
    assert.equal(incorrecta.estado, 401);
    // Byte a byte: cualquier diferencia en el cuerpo convierte el login en un
    // oráculo de qué cuentas existen.
    assert.equal(inexistente.texto, incorrecta.texto);
  });

  it('un usuario inactivo tampoco se distingue de uno inexistente', async () => {
    const u = await crearUsuario({ sufijo: 'inactivo-indistinguible', activo: false });
    const c = nuevo();
    const inactivo = await c.entrar(u.email, u.password);
    const inexistente = await c.entrar('test-tampoco-existe@bbl.local', 'lo-que-sea');
    assert.equal(inactivo.estado, 401);
    assert.equal(inactivo.texto, inexistente.texto);
  });
});

describe('login: las dos comprobaciones de D4 son independientes', () => {
  // El riesgo real es que alguien escriba UNA condición combinada
  // (`activo && password_hash !== null`) y parezca correcta. Estos dos casos
  // construyen los estados por separado: si solo existiera la condición
  // combinada, ambos seguirían pasando, pero si existe solo una de las dos,
  // uno de estos dos falla.

  it('activo=false CON hash válido: rechazado (existe la comprobación de activo)', async () => {
    const u = await crearUsuario({ sufijo: 'inactivo-con-hash', activo: false });
    const r = await nuevo().entrar(u.email, u.password);
    assert.equal(r.estado, 401);
  });

  it('activo=true SIN hash: rechazado (existe la comprobación de hash nulo)', async () => {
    const u = await crearUsuario({ sufijo: 'activo-sin-hash', activo: true, sinHash: true });
    const r = await nuevo().entrar(u.email, 'lo-que-sea');
    assert.equal(r.estado, 401);
  });

  it('sin hash: tampoco entra con contraseña vacía', async () => {
    const u = await crearUsuario({ sufijo: 'sin-hash-vacia', activo: true, sinHash: true });
    for (const intento of ['', ' ', 'null', 'undefined']) {
      const r = await nuevo().entrar(u.email, intento);
      assert.equal(r.estado, 401, `entró con la contraseña ${JSON.stringify(intento)}`);
    }
  });

  it('sistema@bbl.local no entra por ninguna vía', async () => {
    for (const intento of ['', 'sistema', 'admin', 'Importación automática']) {
      const r = await nuevo().entrar('sistema@bbl.local', intento);
      assert.equal(r.estado, 401);
    }
  });
});

describe('sesión: ciclo de vida', () => {
  it('sin cookie devuelve 401', async () => {
    const r = await nuevo().get('/api/auth/me');
    assert.equal(r.estado, 401);
  });

  it('cookie con basura devuelve 401', async () => {
    const r = await nuevo().get('/api/auth/me', { cookie: 'inventario.sid=basura-sin-firma' });
    assert.equal(r.estado, 401);
  });

  it('cookie bien formada con un sid que no está en el store devuelve 401', async () => {
    const c = nuevo();
    await c.entrar(admin.email, admin.password);
    const valida = c.cookieCruda;
    // Se altera el identificador conservando la forma s:<id>.<firma>
    const alterada = valida.replace(/s%3A(.)/, (m, ch: string) =>
      m.replace(ch, ch === 'a' ? 'b' : 'a'),
    );
    assert.notEqual(alterada, valida, 'la cookie no se pudo alterar; revisar el test');
    const r = await nuevo().get('/api/auth/me', { cookie: alterada });
    assert.equal(r.estado, 401);
  });

  it('el sid cambia al iniciar sesión (fijación de sesión)', async () => {
    const c = nuevo();
    await c.get('/api/auth/me'); // crea o no sesión, pero fija el terreno
    const antes = c.cookieCruda;
    await c.entrar(admin.email, admin.password);
    const despues = c.cookieCruda;
    assert.notEqual(antes, despues);
  });

  it('logout invalida la sesión en el servidor, no solo la cookie', async () => {
    const c = nuevo();
    await c.entrar(admin.email, admin.password);
    const cookieRobada = c.cookieCruda;

    assert.equal((await c.get('/api/auth/me')).estado, 200);
    assert.equal((await c.post('/api/auth/logout')).estado, 204);

    // La cookie de antes, reenviada tal cual: es lo que tendría un atacante
    // que la hubiera copiado. Si el logout solo hubiera borrado la cookie del
    // navegador, esto seguiría dando 200.
    const r = await nuevo().get('/api/auth/me', { cookie: cookieRobada });
    assert.equal(r.estado, 401);
  });

  it('una sesión caducada devuelve 401', async () => {
    const c = nuevo();
    await c.entrar(admin.email, admin.password);
    const cookie = c.cookieCruda;
    await caducarSesiones();
    const r = await nuevo().get('/api/auth/me', { cookie });
    assert.equal(r.estado, 401);
  });

  it('la sesión de un usuario no sirve para las peticiones de otro', async () => {
    const a = nuevo();
    const b = nuevo();
    await a.entrar(admin.email, admin.password);
    await b.entrar(tecnico.email, tecnico.password);

    const yoA = (await a.get('/api/auth/me')).cuerpo as { usuario: { email: string } };
    const yoB = (await b.get('/api/auth/me')).cuerpo as { usuario: { email: string } };
    assert.equal(yoA.usuario.email, admin.email);
    assert.equal(yoB.usuario.email, tecnico.email);
    assert.notEqual(yoA.usuario.email, yoB.usuario.email);
  });
});

describe('sesión: lo que la invalida sin pasar por logout', () => {
  // Los dos casos de esta sección son el motivo de que el guardián consulte la
  // BD en cada petición en vez de fiarse de lo que hay dentro de la sesión.

  it('desactivar al usuario mata su sesión viva EN EL ACTO', async () => {
    const u = await crearUsuario({ sufijo: 'a-desactivar' });
    const c = nuevo();
    await c.entrar(u.email, u.password);
    assert.equal((await c.get('/api/auth/me')).estado, 200);

    await desactivar(u.id);

    // Sin esto, "desactivar" a alguien no lo echa: le pone una fecha de
    // caducidad. Es el pendiente 1 de docs/pendientes.md en su forma general.
    const r = await c.get('/api/auth/me');
    assert.equal(r.estado, 401);
  });

  it('cambiar la contraseña mata las sesiones abiertas', async () => {
    const u = await crearUsuario({ sufijo: 'a-cambiar-clave' });
    const c = nuevo();
    await c.entrar(u.email, u.password);
    assert.equal((await c.get('/api/auth/me')).estado, 200);

    await cambiarPassword(u.id, 'otra-contrasena-completamente-distinta');

    // Quien cambia la contraseña porque sospecha que se la robaron no gana
    // nada si la sesión del atacante sobrevive al cambio.
    const r = await c.get('/api/auth/me');
    assert.equal(r.estado, 401);
  });

  it('una sesión invalidada se borra del store, no solo se rechaza', async () => {
    await limpiarSesiones();
    const u = await crearUsuario({ sufijo: 'store-limpio' });
    const c = nuevo();
    await c.entrar(u.email, u.password);
    assert.equal(await contarSesiones(), 1);

    await desactivar(u.id);
    await c.get('/api/auth/me');
    assert.equal(await contarSesiones(), 0, 'la fila del store sigue ahí');
  });
});

describe('login: rate limit', () => {
  it('corta tras agotar la cuota, y un acierto ajeno no la reinicia', async () => {
    const antes = process.env.LOGIN_LIMITE;
    process.env.LOGIN_LIMITE = '4';
    const s = await arrancar();
    try {
      const c = new Cliente(s.url);

      // Tres fallos.
      for (let i = 0; i < 3; i++) {
        assert.equal((await c.entrar(admin.email, 'mal')).estado, 401);
      }
      // Un acierto de otra cuenta. Si reiniciara el contador, bastaría con
      // intercalar logins propios para probar sin límite contra otra cuenta.
      assert.equal((await c.entrar(tecnico.email, tecnico.password)).estado, 200);
      // El quinto intento ya excede la cuota de 4.
      const cortado = await c.entrar(admin.email, 'mal');
      assert.equal(cortado.estado, 429);
    } finally {
      await s.cerrar();
      if (antes === undefined) delete process.env.LOGIN_LIMITE;
      else process.env.LOGIN_LIMITE = antes;
    }
  });

  it('el 429 no revela si la cuenta existe', async () => {
    const antes = process.env.LOGIN_LIMITE;
    process.env.LOGIN_LIMITE = '1';
    const s = await arrancar();
    try {
      const c = new Cliente(s.url);
      await c.entrar(admin.email, 'mal');
      const existente = await c.entrar(admin.email, 'mal');
      const inexistente = await c.entrar('test-no-existe-nunca@bbl.local', 'mal');
      assert.equal(existente.estado, 429);
      assert.equal(inexistente.estado, 429);
      assert.equal(existente.texto, inexistente.texto);
    } finally {
      await s.cerrar();
      if (antes === undefined) delete process.env.LOGIN_LIMITE;
      else process.env.LOGIN_LIMITE = antes;
    }
  });
});

describe('cookie: los tres flags en producción', () => {
  // `secure` está condicionado a NODE_ENV porque en desarrollo se sirve por
  // HTTP plano. Este test es lo que impide que esa excepción se convierta en un
  // `false` olvidado: comprueba la configuración de producción de verdad.
  it('con NODE_ENV=production salen Secure, HttpOnly y SameSite=Strict', async () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const s = await arrancar();
    try {
      const c = new Cliente(s.url);
      const r = await c.pedir('POST', '/api/auth/login', {
        cuerpo: { email: admin.email, password: admin.password },
        // La app confía en el proxy; sin esta cabecera express-session se
        // niega a poner una cookie `secure` sobre una conexión que ve en claro.
        cabeceras: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(r.estado, 200);
      const cookies = r.cabeceras.getSetCookie().join(' ; ');
      assert.match(cookies, /Secure/i);
      assert.match(cookies, /HttpOnly/i);
      assert.match(cookies, /SameSite=Strict/i);
    } finally {
      await s.cerrar();
      if (antes === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = antes;
    }
  });
});

describe('permisos: la superficie entera, no caso a caso', () => {
  // Estos dos no enumeran ataques: recorren la tabla de permisos. Una ruta
  // nueva queda cubierta sola, que es lo que impide que "todo lo demás" crezca
  // cada vez que alguien añade un endpoint.

  it('toda ruta no pública devuelve 401 sin sesión', async () => {
    const c = nuevo();
    for (const r of rutasRegistradas()) {
      if (r.permiso === 'publico') continue;
      const camino = r.ruta.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000');
      // GET no admite cuerpo; los demás lo llevan vacío para que la ruta no
      // falle por validación antes de llegar al guardián.
      const resp = await c.pedir(
        r.metodo.toUpperCase(),
        camino,
        r.metodo === 'get' ? {} : { cuerpo: {} },
      );
      assert.equal(resp.estado, 401, `${clave(r.metodo, r.ruta)} no exige sesión`);
    }
  });

  it('ninguna ruta se registró saltándose el helper de permisos', () => {
    const declaradas = new Set(rutasRegistradas().map((r) => clave(r.metodo, r.ruta)));

    // Se recorre el router de Express: si alguien escribe app.get(...) en vez
    // de ruta(...), la ruta existe pero no tiene permiso declarado, y sin este
    // test no se notaría hasta que la usara alguien que no debía.
    const pila = (servidor.app as unknown as { _router?: { stack: unknown[] } })._router?.stack ?? [];
    const enRouter: string[] = [];
    for (const capa of pila as Array<{ route?: { path: string; methods: Record<string, boolean> } }>) {
      if (!capa.route) continue;
      for (const [metodo, activo] of Object.entries(capa.route.methods)) {
        if (activo) enRouter.push(clave(metodo, capa.route.path));
      }
    }

    assert.ok(enRouter.length > 0, 'no se pudo leer el router de Express; revisar el test');
    const huerfanas = enRouter.filter((k) => !declaradas.has(k));
    assert.deepEqual(huerfanas, [], `rutas sin permiso declarado: ${huerfanas.join(', ')}`);
  });
});
