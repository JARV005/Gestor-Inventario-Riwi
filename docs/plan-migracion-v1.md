# Migración Excel → App Web · Inventario TI BBL
## Especificación v1

> Documento de decisiones. Pensado para pegarse en la raíz del repo y usarse como contexto en Claude Code.

---

## 0. Contexto

- **Base actual:** prototipo React 19 + Vite + Tailwind 4 generado en Google AI Studio. Estado 100% en memoria (`useState` sobre `src/data/mockData.ts`). Sin persistencia, sin auth, sin BD.
- **Backend existente:** `server.ts` (Express) con 3 endpoints proxy a Gemini: `/api/gemini/chat`, `/api/gemini/handover-act`, `/api/gemini/recommend-kit`. *(Los tres se han eliminado: `recommend-kit` en la etapa 1 con el catálogo, los otros dos en la 4b — `decisiones-03.md` §D12. La línea se conserva porque describe el punto de partida.)*
- **Datos reales:** `inventario_muestra_johan.xlsx` — 126 equipos, 61 periféricos, 3 sedes (Medellín, Barranquilla, Cartagena).

### Decisiones tomadas
| Decisión | Valor |
|---|---|
| Persistencia | PostgreSQL propio, servidor de la empresa |
| Alcance v1 | Todo el prototipo **menos** Licencias/MDM y Catálogo de compras |
| Usuarios | Solo TI (1–3 personas). Los empleados son datos, no cuentas |

---

## 1. Módulos

### Se conservan
- Dashboard
- Inventario (equipos + periféricos)
- Empleados
- Sedes (antes "Hubs")
- Mantenimiento
- Actas de entrega / devolución
- Modales: Onboarding, Nuevo Equipo

### Se eliminan
- `src/components/ProcurementCatalogView.tsx`
- `src/components/LicensesMdmView.tsx`
- Tipos `CatalogItem` y `SoftwareLicense` en `src/types.ts`
- `CATALOG_ITEMS` e `INITIAL_SOFTWARE_LICENSES` en `mockData.ts`
- Endpoint `/api/gemini/recommend-kit` (dependía del catálogo)
- Entradas correspondientes en `Sidebar.tsx`
- **El copiloto IA entero** (etapa 4b): `AiCopilotModal.tsx`, `src/lib/contextoIA.ts`,
  `/api/gemini/chat`, `/api/gemini/handover-act` y la dependencia `@google/genai`.
  Ver `decisiones-03.md` §D12

> La licencia de Windows **por equipo** (`TIPO DE LICENCIA`, `SERIAL WINDOWS`) NO se elimina: es campo del equipo, no un módulo.

### Se reinterpreta
`Hub` → `Sede`. Se eliminan `capacityItems`, `flag`, couriers y tracking. Se conservan nombre, ciudad, dirección, responsable, contacto.

---

## 2. Esquema de base de datos

Convención: snake_case, `id` UUID, `created_at`/`updated_at` en todas las tablas.

### `usuarios_app`
Solo personal de TI. Sin registro público; se siembran con un script.
```
id, email UNIQUE, nombre, password_hash (bcrypt cost 12),
rol ENUM('admin','tecnico'), activo BOOL, ultimo_acceso
```

### `sedes`
```
id, nombre, ciudad, direccion, responsable, contacto_email, contacto_telefono, activa BOOL
```
Semilla: Medellín, Barranquilla, Cartagena, Bogotá, Remoto.

### `empleados`
```
id, nombre, cedula UNIQUE NULL, email_corporativo, cargo, area,
sede_id FK, estado ENUM('Activo','Onboarding','Offboarding','Inactivo'),
fecha_ingreso, telefono, direccion, activo BOOL
```

### `equipos`
Tabla única para portátiles y periféricos, discriminada por `categoria`.
```
id
categoria      ENUM('Portátil','Desktop','Monitor','Teclado','Mouse','Diadema','Celular','Otro')
etiqueta       UNIQUE NULL          -- "BBL-0301"
nombre_equipo                        -- hostname
marca, modelo
serial         UNIQUE NULL          -- ver §3, hay duplicados y vacíos en origen
serial_cargador NULL
propiedad      ENUM('Empresa','Cliente','Empleado')   -- reemplaza "PC del cliente"
sistema_operativo NULL
licencia_tipo  ENUM('RETAIL','OEM','Sin licencia','No aplica') NULL
licencia_serial_cifrado  BYTEA NULL   -- AES-256-GCM
bios_password_cifrado    BYTEA NULL   -- AES-256-GCM
tamano_pantalla, procesador, disco, ram   -- NULL para periféricos
estado         ENUM('Disponible','Asignado','En mantenimiento','En tránsito','Reservado','De baja')
condicion      ENUM('Nuevo','Excelente','Bueno','Requiere reparación') NULL
sede_id        FK NULL
empleado_id    FK NULL              -- responsable actual
sesion_usuario NULL                 -- cuenta con la que inicia sesión
fecha_compra NULL, garantia_vence NULL, costo NUMERIC NULL
notas TEXT NULL
requiere_revision BOOL DEFAULT false
motivo_revision   TEXT NULL
```

**Invariante:** `estado = 'Asignado'` ⟺ `empleado_id IS NOT NULL`. Imponer con CHECK constraint.

### `movimientos`
El historial que el Excel nunca tuvo. **Append-only, nunca se edita ni se borra.**
```
id, equipo_id FK, tipo ENUM('Alta','Asignación','Devolución','Traslado',
  'Envío a mantenimiento','Retorno de mantenimiento','Baja'),
empleado_origen_id NULL, empleado_destino_id NULL,
sede_origen_id NULL, sede_destino_id NULL,
fecha, usuario_app_id FK, acta_id FK NULL, observaciones
```

### `mantenimientos`
```
id, equipo_id FK, tipo, descripcion, estado ENUM('Pendiente','En taller','Completado','Devuelto'),
fecha_reporte, fecha_cierre NULL, responsable, proveedor NULL, costo NUMERIC NULL
```

### `actas`
```
id, consecutivo UNIQUE, tipo ENUM('Entrega','Devolución'),
empleado_id FK, equipos_ids UUID[], fecha,
generada_por FK usuarios_app, pdf_path, hash_sha256, firmada BOOL, fecha_firma NULL
```

### `auditoria`
Obligatoria por §5. Toda escritura sobre `equipos` y todo desciframiento de BIOS.
```
id, tabla, registro_id, accion, usuario_app_id, fecha, antes JSONB, despues JSONB, ip
```

---

## 3. Importador del Excel

Script único, idempotente, ejecutable con `npm run import -- archivo.xlsx`. **Debe generar un reporte de rechazos y advertencias en CSV.** Ese reporte es el entregable de limpieza de datos.

### Normalizaciones automáticas
| Origen | Destino |
|---|---|
| `Medellin` / `Medellín` | `Medellín` |
| `DISPONIBLE` / `Disponible` | `Disponible` |
| `REVISION` / `Disponible - REVISION` | `Disponible` + `requiere_revision=true` |
| `No asignar` | `Reservado` |
| `De baja` | `De baja` |
| Marca `MacBook Air` | marca `Apple`, modelo `MacBook Air` |
| Marca `Asus TUF` | marca `ASUS`, modelo prefijo `TUF` |
| `TIPO EQUIPO = 'PC del cliente'` | categoría `Portátil` + `propiedad='Cliente'` |
| `N/A` / `No aplica` en cualquier campo | `NULL` |
| Periféricos: `DISPONIBILIDAD='ASIGNADO'` | `estado='Asignado'` |

### Casos que requieren decisión humana (marcar `requiere_revision`, NO adivinar)
1. **`TIPO DE LICENCIA = 'OK'` — 37 equipos.** No es un tipo de licencia. Importar `licencia_tipo = NULL`, `motivo_revision = 'Licencia marcada OK, requiere clasificación'`.
2. **Serial `GH14W64` duplicado.** Importar ambos, marcar los dos.
3. **3 equipos sin serial.** Importar con `serial = NULL` y marcar. No inventar seriales.
4. **17 equipos sin usuario responsable** pero con estado `Asignado`. Viola el invariante: importar como `Disponible` + marcar.
5. **`GARANTIA VENC.` vacía en 125 de 126.** No es error de importación, es un campo que nadie llena. Se importa vacío; decidir después si se retira del formulario o se vuelve obligatorio en altas nuevas.
6. **6 equipos sin ubicación.**

### Reglas de matching de empleados
`USUARIO RESPONSABLE` viene como texto libre ("Dalexa Dayana Sanjuan Corona"). El importador crea empleados a partir de nombres únicos y los vincula. Nombres que difieran solo en acentos/espacios se consideran el mismo. Colisiones dudosas → reporte, no merge automático.

---

## 4. API REST

Sobre el mismo `server.ts`. Todas bajo `/api`, todas autenticadas salvo `/api/auth/login` y `/api/health`.

```
POST   /api/auth/login | logout        GET /api/auth/me
GET    /api/equipos            ?estado&sede&categoria&q&page
POST   /api/equipos
GET    /api/equipos/:id
PATCH  /api/equipos/:id
POST   /api/equipos/:id/asignar        { empleado_id, observaciones }
POST   /api/equipos/:id/devolver
POST   /api/equipos/:id/trasladar      { sede_id }
POST   /api/equipos/:id/baja           { motivo }
GET    /api/equipos/:id/historial
GET    /api/equipos/:id/bios           -- devuelve descifrado, escribe auditoría, solo rol admin
GET    /api/equipos/revision           -- bandeja de pendientes de limpieza
CRUD   /api/empleados  /api/sedes  /api/mantenimientos
GET    /api/empleados/:id/equipos
POST   /api/actas                      -- genera PDF, devuelve id + path
GET    /api/actas/:id/pdf
GET    /api/dashboard/metricas
```

Las mutaciones de estado (`asignar`, `devolver`, `trasladar`, `baja`) escriben en `equipos` **y** en `movimientos` dentro de la misma transacción. Nunca por separado.

---

## 5. Seguridad

Esto es el argumento central del proyecto: hoy las claves BIOS y los seriales de Windows viajan por correo en un `.xlsx` sin protección.

1. **Cifrado en reposo:** `bios_password` y `licencia_serial` con AES-256-GCM. Clave en variable de entorno `ENCRYPTION_KEY`, **nunca** en el repo ni en la BD.
2. **Nunca en listados:** los endpoints de listado no devuelven esos campos jamás. Solo `GET /api/equipos/:id/bios`, uno a la vez, rol `admin`, con registro en `auditoria`.
3. **Nunca en exportaciones:** los exports a Excel/CSV excluyen ambos campos por diseño, sin opción de incluirlos.
4. **Sesiones:** cookie `httpOnly` + `secure` + `sameSite=strict`, store en Postgres (`connect-pg-simple`). Sin JWT en `localStorage`.
5. **Rate limit** en `/api/auth/login`.
6. **Backups:** `pg_dump` diario, retención 30 días, **restauración probada al menos una vez**. Un backup no verificado no es un backup.

---

## 6. Copiloto IA — restricción

> **Sin efecto desde la etapa 4b.** El proyecto no lleva IA: no hay copiloto,
> no hay endpoints hacia Gemini y no sale nada de la red de la empresa. Esta
> sección entera existía para hacer aceptable esa salida; sin salida, no tiene
> objeto. Ver `docs/decisiones-03.md` §D12.

---

## 7. Orden de trabajo

| # | Etapa | Entregable | Se puede validar cuando… |
|---|---|---|---|
| 1 | Infraestructura | `docker-compose.yml` con Postgres, migraciones, script de semilla | `npm run migrate` corre en limpio |
| 2 | Importador | Script + reporte de rechazos CSV | Los 126 equipos están en la BD y el reporte lista los ~50 casos dudosos |
| 3 | Auth + API núcleo | Login, CRUD equipos/empleados/sedes | Postman contra todos los endpoints |
| 4 | Conectar UI | Eliminar `mockData.ts`, `fetch` real, borrar los 2 módulos | Recargar el navegador ya no pierde datos |
| 5 | Movimientos y actas | Historial + PDF | Una asignación genera fila en `movimientos` y acta descargable |
| 6 | Mantenimiento + dashboard | Vistas conectadas a datos reales | Métricas cuadran con la BD |
| 7 | Endurecimiento | Cifrado, auditoría, backups, restauración probada | Restaurar el backup en una BD vacía funciona |

**No avanzar a 4 sin cerrar 2.** Si la UI se conecta antes de que los datos estén limpios, la limpieza no vuelve a ocurrir.

---

## 8. Notas para Claude Code

- Empezar cada etapa leyendo solo los archivos de esa etapa. `mockData.ts` son 23 KB; no cargarlo completo, se va a borrar.
- `src/types.ts` es el contrato: actualizarlo primero, dejar que `tsc --noEmit` señale todo lo que rompe.
- Los componentes de vista son grandes (`InventoryView.tsx` = 30 KB). Editar por secciones con búsqueda dirigida, no leerlos enteros.
- La UI está en español mezclado con inglés en los tipos. Unificar a español en la capa de datos y dejar la UI como está para no romper estilos.
