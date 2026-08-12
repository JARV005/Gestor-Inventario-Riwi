# Inventario TI BBL

Migración de un inventario en Excel a aplicación web. La base de este repo es un
prototipo generado en Google AI Studio: React 19 + Vite + Tailwind 4, con todo el
estado en memoria (`useState` sobre `src/data/mockData.ts`). No tiene base de datos
ni autenticación. El objetivo es construirle el backend por debajo y reusar la UI.

## Lectura obligatoria antes de trabajar

`docs/plan-migracion-v1.md` — esquema de BD, endpoints, reglas del importador,
requisitos de seguridad y el orden de las 7 etapas. Es la fuente de verdad.
Si algo de este archivo contradice ese documento, gana ese documento.
Ahora gana `docs/decisiones-01.md`, y sobre ese, `docs/decisiones-04.md`

## Stack

- Front: React 19, Vite, Tailwind 4, lucide-react, recharts, motion
- Back: Express (`server.ts`), TypeScript, `tsx` en desarrollo
- BD: PostgreSQL propio (no Supabase, no ORM impuesto — proponer antes de instalar)
- IA: **ninguna**. Se eliminó entera en la etapa 4b (`docs/decisiones-03.md`
  §D12). La aplicación no hace ninguna llamada a servicios externos: no añadir
  una sin proponerlo antes.

## Reglas del proyecto

1. **Una etapa a la vez.** Están numeradas en `docs/plan-migracion-v1.md` §7.
   No adelantar trabajo de etapas posteriores aunque sea evidente.
2. **No avanzar a la etapa 4 sin cerrar la 2.** Si la UI se conecta antes de que
   los datos estén limpios, la limpieza no vuelve a ocurrir.
3. **Nunca inventar datos.** Si una fila del Excel es ambigua, va al reporte de
   rechazos con `requiere_revision = true`. No adivinar seriales, licencias ni
   responsables.
4. **`bios_password` y `licencia_serial` van cifrados** (AES-256-GCM), nunca
   aparecen en listados, logs ni exportaciones.
5. **Las mutaciones de estado escriben en `equipos` y `movimientos` en la misma
   transacción.** Nunca por separado.
6. **`data/origen/` está en `.gitignore`** y no debe salir de ahí. Contiene
   contraseñas en texto plano.
7. Cambios de esquema → migración versionada. Nunca `ALTER TABLE` a mano.

## Verificación

- Toda afirmación sobre el estado de la BD se respalda citando la línea
  exacta de la salida de psql que la sustenta. En la etapa 1 se leyó un
  UNIQUE CONSTRAINT simple como si fuera un índice parcial: estaba a la
  vista en la salida. El riesgo no es el descuido, es buscar una
  confirmación que ya se espera encontrar.
- Los dos verificadores son la red de seguridad del proyecto. Todo
  invariante nuevo entra en uno de ellos, y ninguna etapa se cierra sin que
  los dos corran en verde:
  `db/verificar-esquema.sql` comprueba que las reglas están puestas, con
  filas sintéticas, y **debe pasar en una BD vacía**.
  `db/verificar-datos.sql` comprueba que lo cargado las cumple, y no.
  Si un caso del primero necesita datos dentro, está mal escrito.
- Un test que solo cubre el camino que ya funciona no es evidencia. Cada
  invariante se prueba por sus dos lados: que acepte lo que debe aceptar
  y que rechace lo que debe rechazar.
- Un exit code distinto de cero con todos los tests en verde es un fallo
  real, no ruido del arnés. `node:test` cuenta el fallo de un hook como
  `hookFailed` y lo deja fuera de `# fail`. Si `npm test` sale con 1, hay
  algo roto aunque diga 48/48. Ocurrió: la limpieza de dos suites llevaba
  rota desde la etapa 3, la base de tests acumulaba filas corrida a
  corrida, y la corrida siguiente moría por un choque de UNIQUE — un
  síntoma dos pasos por delante de la causa.
- Un verificador que imprime «fallas: 1» y sale con código 0 está roto,
  aunque su tabla esté bien. `ON_ERROR_STOP` de psql reacciona a errores de
  SQL, no a una fila de resultado que diga que algo va mal. Los dos
  verificadores terminan ahora en un `DO` que hace `RAISE` si hay alguna
  falla; se comprobó inyectando una y viendo salir un 3. Ocurrió: la
  migración 0010 rompió un caso del verificador de esquema y
  `npm run db:verificar` siguió en verde durante toda la etapa 5, porque el
  veredicto lo estaba leyendo una persona a ojo. Es el `# fail 0` con exit 1
  de node:test por el otro lado — el resumen y el código de salida contando
  cosas distintas.
- La base de tests puede ir una migración por detrás de la de desarrollo, y
  el síntoma no lo parece: fallos que se leen como bugs de la aplicación
  (un 500 inesperado, un 200 donde debía haber 409). Antes de diagnosticar
  un test rojo, comprobar que la base de tests está al día.
- Antes de dar por cerrada una etapa, pregúntate qué prueba la habría
  dejado en rojo si el trabajo estuviera mal. Si no existe, escríbela.
- Una exploración de datos se diseña para encontrar dónde están mal, no
  para confirmar que están bien. Ha fallado dos veces por lo mismo: un
  UNIQUE CONSTRAINT simple leído como índice parcial, y una búsqueda de
  valores no-persona que devolvió 1 de 3. En ambos casos la evidencia
  estaba a la vista.
- Ningún resumen de datos se da por bueno sin el conteo que lo respalda.
  Si una afirmación no viene con su SELECT, es una hipótesis.
- Una constraint deferida no dispara en un fichero que termina en ROLLBACK:
  solo actúa en el COMMIT. Los tests que la comprueban deben forzar
  `SET CONSTRAINTS ALL IMMEDIATE` dentro del bloque. Sin eso salen en verde
  sin comprobar nada, que es el modo de fallo propio de las constraints
  deferidas: se vuelven invisibles justo en los tests.
- Un test cuyo resultado depende de que el corpus esté cargado debe fallar
  si no lo está, no pasar de vacío.
- La interpolación de columnas de Drizzle dentro de ``sql`` `` no es fiable:
  ha fallado tres veces con tres síntomas distintos (calificando de más en
  un CHECK y en un índice parcial, de menos en una subconsulta
  correlacionada). El último caso devolvía ceros plausibles sin error. En
  SQL crudo, calificar las tablas a mano y comprobar el SQL emitido, no el
  TypeScript.
- La causa, comprobada con `.toSQL()` y no supuesta: drizzle califica la
  lista de SELECT **solo cuando la consulta tiene un JOIN**. Con una sola
  tabla emite la columna a secas, y eso normalmente da igual… salvo que el
  fragmento crudo haya abierto una subconsulta, porque drizzle no ve ese
  ámbito y el nombre pelado resuelve contra la tabla de dentro:
  `` sql`(SELECT count(*) FROM equipos WHERE equipos.sede_id = ${sedes.id})` ``
  emite `... WHERE equipos.sede_id = "id"` — cero filas, sin error.
  **Añadir un JOIN no es el disparador**: ahí drizzle sí recalifica, tanto
  las columnas como los helpers. El disparador es la subconsulta
  correlacionada. De ahí la regla: en SQL crudo calificar a mano siempre,
  aunque hoy solo haya una tabla, y leer el SQL emitido. Mejor aún: usar
  los helpers tipados (`eq`, `isNotNull`, …), que sí se recalifican solos.
- Un conteo que la API devuelve se contrasta contra el mismo conteo hecho
  en SQL. Comparar la API consigo misma no prueba nada: un número puede ser
  correcto por accidente.
- Un fallo pasajero de una dependencia no debe matar el proceso. Ha
  ocurrido dos veces: el pool de Postgres y la comprobación de la clave de
  cifrado, esta última escrita justo después de arreglar la primera.
  Antes de dar por bueno cualquier código que consulte la base durante el
  arranque o fuera de una petición, preguntar qué pasa si la base está
  caída, lenta o bloqueada en ese instante.
- «Esto está mal» y «no pude comprobarlo» son distintos. Lo primero es un
  hecho y puede abortar; lo segundo es ausencia de información y abortar
  por ello trata la ignorancia como certeza.
- Un componente correcto puede ser inalcanzable. El estado de error de
  `InventoryView` distinguía sus tres causas y tenía botón de reintentar, y
  aun así el usuario nunca lo veía: el proceso moría dos capas más abajo,
  en un `EventEmitter` de una dependencia. Ninguna revisión del componente
  lo habría encontrado, porque el componente no tenía nada malo. Los
  caminos de fallo se prueban provocando la falla real sobre el sistema
  completo, no leyendo el código que los maneja.

## Eficiencia

- `src/data/mockData.ts` (23 KB) y `bun.lock` (81 KB) no se leen completos. El
  primero se va a borrar en la etapa 4.
- Los componentes de vista son grandes (`InventoryView.tsx` = 30 KB). Editar por
  búsqueda dirigida, no leyéndolos enteros.
- `src/types.ts` es el contrato: actualizarlo primero y dejar que `npm run lint`
  (`tsc --noEmit`) señale todo lo que rompe.

## Comandos

```bash
npm run dev     # tsx server.ts (Vite en middleware)
npm run lint    # tsc --noEmit
npm run build
```

## Fuera de alcance en la v1

Módulo de licencias SaaS y catálogo de compras. Se eliminan
(`LicensesMdmView.tsx`, `ProcurementCatalogView.tsx` y sus tipos).
La licencia de Windows **por equipo** sí se conserva: es un campo de `equipos`.


## Naturaleza del código base

Este repo es un **prototipo de referencia visual**, no una base de código a
preservar. Fue generado en Google AI Studio para mostrar cómo debe verse y
comportarse el producto final. Su implementación es desechable.

### Tienes libertad total para
- Reorganizar carpetas, dividir o fusionar componentes, extraer hooks
- Cambiar el manejo de estado, el enrutamiento y el patrón de datos
- Reescribir cualquier componente desde cero si sale mejor que adaptarlo
- Introducir capas que hoy no existen: servicios, repositorios, validación,
  manejo de errores, tests
- Renombrar todo lo que haga falta para alinearlo con el esquema en español

No hace falta que pidas permiso para refactorizar. Sí para cambiar de stack.

### NO tienes libertad para
- Cambiar de stack: React 19 + Vite + Tailwind 4 + Express se quedan.
  Nada de Next.js, ni de reemplazar Tailwind, ni de añadir una librería de
  estado global sin proponerlo antes.
- Cambiar **qué** muestra cada pantalla ni cómo se navega entre ellas. El
  prototipo es la especificación funcional y visual: las 7 vistas que
  quedan, su contenido y su flujo son el requisito. Puedes reescribir el
  cómo, no el qué.
- Eliminar funcionalidad visible porque el código que la soporta sea feo.
  Si algo estorba, dilo y lo decidimos.

### En caso de duda
El commit inicial ("base: prototipo AI Studio") conserva el original intacto.
Cuando reescribas una vista, compárala contra ese commit para no perder
detalle de comportamiento por el camino.