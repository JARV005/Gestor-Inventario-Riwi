# API — endpoints y permisos

Los de la etapa 3: autenticación y CRUD de equipos, empleados y sedes. Las
mutaciones de estado (`asignar`, `devolver`, `trasladar`, `baja`) y las actas
son de la etapa 5; el dashboard, de la 6.

```bash
npm run api    # solo la API, contra la base de desarrollo, puerto 3001
npm run dev    # API + frontend
```

## Roles

Dos: `admin` y `tecnico`. **En la interfaz `tecnico` se muestra como
«Auxiliar»**; el valor del enum es interno y no se enseña.

`tecnico` no puede: ver los campos cifrados, dar de baja equipos (etapa 5),
importar, ni crear usuarios. Todo lo demás sí.

**Los permisos se aplican en el servidor.** El frontend puede ocultar botones,
pero eso es cosmético: quien tenga una sesión y `curl` puede llamar a cualquier
endpoint.

## Tabla de endpoints

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/health` | público |
| POST | `/api/auth/login` | público |
| POST | `/api/auth/logout` | autenticado |
| GET | `/api/auth/me` | autenticado |
| GET | `/api/equipos` | autenticado |
| POST | `/api/equipos` | autenticado |
| GET | `/api/equipos/revision` | autenticado |
| GET | `/api/equipos/:id` | autenticado |
| PATCH | `/api/equipos/:id` | autenticado |
| GET | `/api/equipos/:id/historial` | autenticado |
| **GET** | **`/api/equipos/:id/bios`** | **admin** |
| GET | `/api/empleados` | autenticado |
| POST | `/api/empleados` | autenticado |
| GET | `/api/empleados/:id` | autenticado |
| PATCH | `/api/empleados/:id` | autenticado |
| GET | `/api/empleados/:id/equipos` | autenticado |
| GET | `/api/sedes` | autenticado |
| POST | `/api/sedes` | autenticado |
| GET | `/api/sedes/:id` | autenticado |
| PATCH | `/api/sedes/:id` | autenticado |

Esta tabla no se mantiene a mano: sale de `server/permisos.ts`, donde cada ruta
se registra con `ruta(app, metodo, camino, permiso, ...)` y el permiso es
argumento obligatorio. De ese registro salen tres tests —sin sesión da 401 en
todas, rol insuficiente da 403 en las restringidas, y ninguna ruta del router de
Express se saltó el helper—, así que un endpoint nuevo queda cubierto solo.

## Sesión

Cookie `inventario.sid`, `httpOnly` + `sameSite=strict`, estado en Postgres
(`connect-pg-simple`). Sin JWT en `localStorage`.

`secure` va condicionado a `NODE_ENV === 'production'` porque desarrollo se
sirve por HTTP plano y una cookie `secure` no viaja por ahí. La excepción está
acotada y hay un test que comprueba los tres flags con `NODE_ENV=production`.

**La sesión se revalida contra la base en cada petición**, no solo en el login.
De ahí salen tres garantías que un login no puede dar:

| Qué pasa | Efecto |
|---|---|
| Se desactiva al usuario | Su sesión muere en la siguiente petición, y la fila se borra del store |
| Se le cambia la contraseña | Sus sesiones abiertas mueren |
| Se le cambia el rol | Aplica de inmediato, sin cerrar sesión |

Lo de la contraseña funciona con una huella SHA-256 del `password_hash`
guardada en la sesión y comparada en cada petición. Ni el rol ni el estado
viven dentro de la sesión: si vivieran, degradar a alguien no tendría efecto
hasta que cerrase sesión.

`logout` destruye la fila del store, no solo borra la cookie.

## Login

```
POST /api/auth/login      { "email": "...", "password": "..." }
```

- **Un solo mensaje de error para todos los fallos.** No existe, contraseña
  incorrecta, cuenta inactiva y cuenta sin contraseña devuelven exactamente el
  mismo 401 con el mismo cuerpo. Hay un test que los compara byte a byte.
- Rate limit: 10 intentos por cuarto de hora y por IP. Cuenta también los
  aciertos, para que no baste con intercalar un login propio para reiniciar la
  cuota. El 429 tampoco revela si la cuenta existe.
- `sistema@bbl.local` no entra por ninguna vía: se comprueban `activo = false`
  y `password_hash IS NULL` como **dos condiciones separadas**, y hay un test
  por cada una que construye el estado aislado.

### Sobre la temporización

La rama de «usuario inexistente» compara la contraseña contra un hash señuelo
del mismo coste. Sin eso, no existir tarda ~1 ms y equivocarse de contraseña
~230 ms, y esa diferencia enumera cuentas aunque el cuerpo sea idéntico.

**Esto queda verificado por lectura, no por test.** Una aserción de tiempos
sería inestable y daría rojos que no significan nada, y un test que enseña a
ignorar rojos vale menos que no tenerlo. Lo que sí está automatizado es la
igualdad byte a byte de las respuestas.

## Campos cifrados

`bios_password_cifrado` y `licencia_serial_cifrado` **no salen en ningún
listado, ni siquiera para admin** (§5.2). Solo por:

```
GET /api/equipos/:id/bios      -> rol admin, de uno en uno
```

que descifra, deja fila en `auditoria` **antes** de responder, y registra que se
leyó — nunca el valor leído.

La regla se protege en dos capas, porque es de las que se rompen solas:

1. **Sobre las respuestas.** Un barrido recorre el árbol JSON completo de cada
   GET que devuelve equipos, para los dos roles, buscando las claves prohibidas
   a cualquier profundidad. Incluye **las respuestas de error**: un 500 que
   serializa el objeto filtra lo mismo que un listado descuidado, y es donde
   nadie mira. El manejador de errores construye el cuerpo campo a campo y
   nunca serializa el error.
2. **Sobre el código.** Un test lee `db/repositorios/` y falla si encuentra un
   `.select()` sin argumentos, que en Drizzle es literalmente `SELECT *`. Basta
   con que alguien lo escriba una vez para filtrar los dos campos en todas las
   respuestas de ese endpoint, sin hacer ruido. El comentario de
   `db/repositorios/equipos.ts` avisa; el test es lo que lo impide.

## Desactivar un empleado

`PATCH /api/empleados/:id` con `{"activo": false}` **se bloquea con 409 si tiene
equipos a su nombre**, y la respuesta dice cuáles.

Un empleado inactivo con un portátil asignado es un equipo perdido con pasos
extra: no sale en los listados de gente activa, así que nadie vuelve a mirarlo,
y el equipo sigue figurando entregado a quien ya no está. Obligar a devolver
primero es el orden real de un offboarding.

Solo se comprueba al pasar de activo a inactivo. Un PATCH que no toque `activo`,
o que reactive, no exige nada.

```
HTTP/1.1 409 Conflict
{
  "error": "No se puede desactivar a un empleado con equipos a su nombre. Devolverlos primero.",
  "equipos": [
    { "id": "549fabab-...", "etiqueta": "BBL-0301", "serial": "776B494",
      "categoria": "Portátil", "marca": "Dell", "modelo": "Inspiron 15 3530",
      "estado": "Asignado" }
  ]
}
```

## Primer usuario

Crear usuarios es una operación de admin, y hasta que exista el primero no hay
quien la haga. Se rompe el círculo con un script, como pide el §2 («sin registro
público; se siembran con un script»):

```bash
npm run usuario -- johan@bbl.local "Johan Rivera" admin
# la contraseña se pide por stdin: como argumento quedaría en el historial
# del shell y en la lista de procesos
```

---

## Cierre del pendiente 1

`POLIZA DE SEGURO` y `z No asignar` entraron en `empleados` durante la etapa 2
por decisión explícita (`decisiones-02.md` D10.4). Se desactivaron **desde la
API**, no con un `UPDATE`: resolverlos por SQL habría dejado el pendiente
abierto sin que se notara, porque no habría demostrado que la aplicación puede
hacerlo.

Transcripción real contra `inventario_bbl`, el 2026-08-06:

```http
POST /api/auth/login
Content-Type: application/json

{"email":"johan@bbl.local","password":"..."}
```
```http
HTTP/1.1 200 OK
Set-Cookie: inventario.sid=s%3AMzqQ-deJI_HLaOZ...; Path=/; HttpOnly; SameSite=Strict

{"usuario":{"id":"edc260b6-...","email":"johan@bbl.local",
            "nombre":"Johan Rivera","rol":"admin"}}
```

Antes de desactivar, comprobar que no tienen nada a su nombre:

```http
GET /api/empleados/23e2f43b-8086-4284-ad97-f8191cd48faf/equipos   ->  {"equipos":[]}
GET /api/empleados/4de6809f-4e33-46f6-b660-552e6b6bd3cb/equipos   ->  {"equipos":[]}
```

```http
PATCH /api/empleados/23e2f43b-8086-4284-ad97-f8191cd48faf
Content-Type: application/json
Cookie: inventario.sid=...

{"activo": false}
```
```http
HTTP/1.1 200 OK
{"empleado":{"id":"23e2f43b-...","nombre":"POLIZA DE SEGURO","activo":false, ...}}
```

```http
PATCH /api/empleados/4de6809f-4e33-46f6-b660-552e6b6bd3cb
{"activo": false}
```
```http
HTTP/1.1 200 OK
{"empleado":{"id":"4de6809f-...","nombre":"z No asignar","activo":false, ...}}
```

Estado final:

```
      nombre      | activo
------------------+--------
 POLIZA DE SEGURO | f
 z No asignar     | f
```

Y el bloqueo, comprobado en la misma sesión contra un empleado real con equipo
a su nombre, es el 409 que aparece más arriba en este documento.
