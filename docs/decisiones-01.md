# Decisiones 01 — tras el reconocimiento

> Complementa `plan-migracion-v1.md`. Donde haya contradicción, gana este documento.

---

## D1. El modelo de logística se elimina como entidad

`LogisticsTicket`, `INITIAL_LOGISTICS_TICKETS` y `LogisticsHubsView` en su forma
actual desaparecen. El concepto sobrevive repartido así:

| Antes | Ahora |
|---|---|
| Ticket con estado abierto/cerrado | Fila en `movimientos` tipo `Traslado` |
| Ticket abierto | `movimientos.fecha_confirmacion IS NULL` |
| `inTransitCount` del sidebar | `COUNT(equipos WHERE estado='En tránsito')` |
| Salida de `OnboardingModal` | Movimiento tipo `Asignación`, o `Traslado` si cambia de sede |
| Vista de hubs | `SedesView`: conteo por sede + traslados abiertos |

### Campos añadidos a `movimientos`
```
fecha_confirmacion  TIMESTAMP NULL   -- NULL = traslado en curso
transportadora      TEXT NULL
guia                TEXT NULL
fecha_estimada      DATE NULL
```

**Invariante nuevo:** un equipo está en `estado='En tránsito'` ⟺ existe un
movimiento tipo `Traslado` con `fecha_confirmacion IS NULL`. Confirmar el
traslado cierra el movimiento y pasa el equipo a `Disponible` o `Asignado`
en la sede destino, en la misma transacción.

---

## D2. La etapa 4 se parte en dos

La etapa 4 original ("conectar UI") no es conectar, es reescribir el contrato.
`types.ts` casi no comparte nada con el esquema §2.

### Etapa 4a — Reescribir el contrato
- Traducir todos los tipos a español, alineados con el esquema de BD.
- `DeviceStatus` → `EstadoEquipo` con los 6 valores del §2.
- Eliminar las ubicaciones hardcodeadas (CDMX, Buenos Aires, Miami, Madrid).
  Ninguna de las 6 actuales sobrevive; las sedes vienen de la BD.
- **Eliminar la relación duplicada.** Hoy existe en ambos sentidos:
  `Device.assignedTo` y `Employee.assignedDeviceIds[]`. La BD solo tiene
  `equipos.empleado_id`. Todo lo que hoy lee `assignedDeviceIds` (buena parte
  de `EmployeesView`) se recalcula desde el lado de equipos, vía
  `GET /api/empleados/:id/equipos`.
- Cierre: `npm run lint` limpio con los tipos nuevos y mocks adaptados.

### Etapa 4b — Conectar
- Reemplazar `useState(INITIAL_*)` por carga async.
- Introducir estados de `loading` y `error`, que hoy no existen en ninguna parte.
- `MaintenanceView` deja de importar `mockData` directamente y de tener su
  propio `useState` invisible para `App`.
- Borrar `mockData.ts`.

---

## D3. Campos y widgets sin fuente de dato

### Se eliminan del tipo y del dashboard
`healthScore`, `batteryHealth`, `mdmEnrolled`, `mdmProvider`, `encrypted`,
`imageUrl`.

Razón: no hay MDM, no hay inventario de salud de baterías y no hay fotos.
Un widget que grafica un dato inventado es peor que la ausencia del widget.

### Se transforman
| Campo actual | Destino |
|---|---|
| `costUSD` | `costo` NUMERIC, en **pesos colombianos** |
| `department` | `empleados.area` |

`costo` se conserva como campo pero **su widget sale de la v1**: el Excel no
tiene ni un solo costo cargado y una tarjeta que muestra $0 desinforma.
Vuelve cuando haya datos.

### Widgets que reemplazan a los eliminados
Todos con dato real disponible desde la etapa 2:
1. **Equipos con `requiere_revision`** — hace visible la deuda de datos heredada
   del Excel. Debe ser prominente, no una nota al pie.
2. Equipos por estado (los 6 valores)
3. Equipos por sede
4. Equipos por categoría
5. Equipos sin responsable asignado
6. Mantenimientos abiertos
7. Antigüedad promedio de la flota

---

## D4. Usuario de sistema para la importación

Corrige un hueco del plan: la etapa 2 escribe en `movimientos.usuario_app_id`,
que es FK a `usuarios_app`, pero el auth es la etapa 3.

**La etapa 1 siembra este usuario:**
```
email:         sistema@bbl.local
nombre:        Importación automática
rol:           admin
activo:        false          -- nunca puede iniciar sesión
password_hash: NULL           -- el login rechaza hash nulo explícitamente
```

El importador atribuye a este usuario las 126 filas `Alta`. Así los movimientos
migrados quedan distinguibles para siempre de los que hizo una persona.

El endpoint de login debe rechazar `activo = false` **y** `password_hash IS NULL`
como dos comprobaciones separadas, no como una sola.

---

## D5. Lista blanca hacia Gemini

Hoy `inventorySummaryContext` (App.tsx) ya cumple §6: manda solo agregados.
El riesgo no es corregir algo roto, es que alguien amplíe ese string después.

Convertirlo en una función explícita, no un template literal:

```ts
// Los campos permitidos se enumeran aquí y en ningún otro lugar.
// Ampliar esta lista requiere revisión: ver plan-migracion-v1.md §6.
function construirContextoIA(equipos: Equipo[]): string
```

Prohibido enviar, en cualquier circunstancia: `bios_password`,
`licencia_serial`, `serial`, `sesion_usuario`, `cedula`, `email_corporativo`,
direcciones y nombres de empleados.

---

## D6. Ajustes menores

| Punto | Decisión |
|---|---|
| Archivo con espacios | Renombrar a `inventario_muestra_johan.xlsx` |
| `npm run clean` usa `rm -rf` | Cambiar a `rimraf` (dev habitual en Windows) |
| `gemini-3.6-flash` hardcodeado ×3 | Variable de entorno `GEMINI_MODEL` |
| Flag del copiloto | `ENABLE_AI_COPILOT`, leído en `server.ts`, apaga los endpoints y oculta el botón |
| `npm run migrate` / `npm run import` | No existen; los crea la etapa 1 y 2 respectivamente |

---

## Orden actualizado

| # | Etapa |
|---|---|
| 0 | **Recorte de alcance + paleta RIWI** (solo frontend, sin BD) |
| 1 | Infraestructura: Postgres, migraciones, semillas (incluye usuario sistema) |
| 2 | Importador + reporte de rechazos |
| 3 | Auth (admin/aux) + API núcleo |
| 4a | Reescribir `types.ts` al contrato en español |
| 4b | Conectar UI, borrar `mockData.ts` |
| 5 | Movimientos y actas |
| 6 | Mantenimiento + dashboard con los widgets de D3 |
| 7 | Endurecimiento: cifrado, auditoría, backups con restauración probada |

Sigue vigente: **no pasar a 4a sin cerrar 2.**
