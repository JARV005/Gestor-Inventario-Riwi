# Inventario TI BBL

Migración de un inventario en Excel a aplicación web. La base de este repo es un
prototipo generado en Google AI Studio: React 19 + Vite + Tailwind 4, con todo el
estado en memoria (`useState` sobre `src/data/mockData.ts`). No tiene base de datos
ni autenticación. El objetivo es construirle el backend por debajo y reusar la UI.

## Lectura obligatoria antes de trabajar

`docs/plan-migracion-v1.md` — esquema de BD, endpoints, reglas del importador,
requisitos de seguridad y el orden de las 7 etapas. Es la fuente de verdad.
Si algo de este archivo contradice ese documento, gana ese documento.
Ahora gana `docs/decisiones-01.md`

## Stack

- Front: React 19, Vite, Tailwind 4, lucide-react, recharts, motion
- Back: Express (`server.ts`), TypeScript, `tsx` en desarrollo
- BD: PostgreSQL propio (no Supabase, no ORM impuesto — proponer antes de instalar)
- IA: Gemini vía `@google/genai`, solo para el copiloto y las actas

## Reglas del proyecto

1. **Una etapa a la vez.** Están numeradas en `docs/plan-migracion-v1.md` §7.
   No adelantar trabajo de etapas posteriores aunque sea evidente.
2. **No avanzar a la etapa 4 sin cerrar la 2.** Si la UI se conecta antes de que
   los datos estén limpios, la limpieza no vuelve a ocurrir.
3. **Nunca inventar datos.** Si una fila del Excel es ambigua, va al reporte de
   rechazos con `requiere_revision = true`. No adivinar seriales, licencias ni
   responsables.
4. **`bios_password` y `licencia_serial` van cifrados** (AES-256-GCM), nunca
   aparecen en listados, logs, exportaciones ni en payloads hacia Gemini.
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