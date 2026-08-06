# Decisiones 03 — fuera la IA

Fecha: 2026-08-06. Etapa 4b.
Deja sin efecto el **§6** de `docs/plan-migracion-v1.md` y el **D5** de
`docs/decisiones-01.md`. Esos dos documentos no se editan: son el registro de lo
que se decidió entonces. Este es el que dice que ya no vale.

---

## D12. El proyecto no lleva IA

**No va a haber copiloto ni ningún asistente.** Se elimina todo lo relacionado.

### Qué se ha quitado

| Qué | Dónde estaba |
|---|---|
| Modal de chat del copiloto | `src/components/AiCopilotModal.tsx` |
| Botón «Copilot IA» | `src/components/Header.tsx` |
| Botón «Consultar Copilot IA» | `src/components/DashboardView.tsx` |
| Lista blanca de campos hacia Gemini | `src/lib/contextoIA.ts` (`construirContextoIA`) |
| `POST /api/gemini/chat` | `server.ts` |
| `POST /api/gemini/handover-act` | `server.ts` |
| Dependencia `@google/genai` | `package.json` |
| `GEMINI_API_KEY` | `.env`, `.env.example` |
| `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` | `metadata.json` |

`GEMINI_MODEL` y `ENABLE_AI_COPILOT` estaban previstos en D5 pero **nunca
llegaron a existir** en ningún fichero. No había nada que quitar.

El tercer endpoint del prototipo, `POST /api/gemini/recommend-kit`, ya se había
descartado en la etapa 1: dependía del catálogo de compras, que está fuera de
alcance en la v1.

### Por qué

Tres razones, en orden de peso.

**1. Era la única salida a internet.** Con la BD on-premise, el copiloto era lo
único que mandaba datos del inventario fuera de la red de la empresa. El §6
existía enteramente para hacer aceptable esa salida: una lista blanca de seis
campos, una prohibición explícita de mandar los campos cifrados, y un flag para
apagarlo si la empresa no lo aceptaba. Quitar el módulo hace innecesario todo
ese aparato. La aplicación pasa a ser **completamente interna** — ver
`docs/despliegue.md`.

**2. Un acta de entrega no debe redactarse distinto cada vez.** Es un documento
legal con formato estable. Que Gemini la redactara significaba que dos actas del
mismo tipo podían decir cosas distintas, y que nadie de legal había revisado
ninguna de las dos. Una plantilla fija no es una degradación: es lo que ese
documento tenía que haber sido desde el principio.

**3. Menos superficie.** Una dependencia menos, una clave de API menos que
custodiar, dos endpoints menos que autenticar y limitar, y un fichero menos que
mantener sincronizado con el esquema (`contextoIA.ts` enumeraba campos a mano).

### Qué pasa con el acta

`HandoverDocumentView` **lee** de la base los datos del equipo y del empleado —
eso es la etapa 4b y ya está hecho. El **cuerpo** del acta (razón social,
número, cláusulas de custodia, protocolo de devolución y bloques de firma) es
trabajo de la **etapa 5**, y queda marcado con `TODO(5)` visible en la propia
vista: el documento dice en pantalla que sirve para consultar y no para
firmarse.

Lo que traía el prototipo en ese hueco no era un borrador aprovechable, era
relleno: la razón social de otra empresa, un número de acta inventado
(`FP-2026-9041`), una firmante que no existe y una cláusula sobre el agente MDM,
que D3 retiró del proyecto. La plantilla del `fallback` de Gemini —algo más
sobria— está transcrita entera en `docs/pendientes.md` como punto de partida, y
marcada como **no revisada por legal**.

### Lo que no cambia

- El uso de la IA para las actas figuraba en el plan como «solo para el
  copiloto y las actas». Se va entero: no queda ningún uso.
- La regla 4 del proyecto (`bios_password` y `licencia_serial` cifrados, nunca
  en listados, logs ni exportaciones) **sigue igual**. Lo único que desaparece
  de su enunciado es la mención a los payloads hacia Gemini, porque ya no hay
  payloads hacia ningún sitio.
- `docs/decisiones-01.md` §D5 y `docs/deuda-tipos.md` quedan como estaban. Son
  registro histórico de decisiones que en su momento fueron correctas.
