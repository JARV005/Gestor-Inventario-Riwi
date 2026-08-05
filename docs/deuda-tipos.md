# Deuda de tipos — inventario al activar la verificación

> Levantado en la etapa 0 (commit 2). Punto de partida para la etapa 4a.

## Por qué existía este agujero

El repo declaraba `npm run lint` = `tsc --noEmit` como red de seguridad, pero
**no verificaba nada de React**:

- `@types/react` y `@types/react-dom` no estaban instalados.
- `tsconfig.json` tenía `allowJs: true`, así que `react` y `react/jsx-runtime`
  resolvían a JavaScript sin tipos en vez de fallar.

Resultado: todo componente era `any`, y `tsc` no comprobaba ni una sola prop.
`npm run lint` salía en verde con errores de tipos reales en el árbol.

Esto importaba más allá de la etapa 0: tanto `CLAUDE.md` como
`decisiones-01.md` §4a apuestan la reescritura del contrato a *"actualizar
`types.ts` y dejar que `tsc` señale todo lo que rompe"*. Con la configuración
anterior no habría señalado nada.

## Qué se cambió

| Cambio | Motivo |
|---|---|
| `+ @types/react@^19`, `+ @types/react-dom@^19` (devDependencies) | Sin esto no hay verificación de JSX ni de props |
| `- "allowJs": true` en `tsconfig.json` | No hay ni un solo `.js`/`.jsx` propio en el repo. Solo servía para que React resolviera sin tipos |
| `strict` | **Sin activar.** Es decisión de la etapa 4a |

## Salida completa de `tsc --noEmit`

```
src/App.tsx(88,9): error TS2322: Type '{ selectedOrg: string; setSelectedOrg: Dispatch<SetStateAction<string>>; searchTerm: string; setSearchTerm: Dispatch<SetStateAction<string>>; onOpenCopilot: () => void; onOpenNewDeviceModal: () => void; }' is not assignable to type 'IntrinsicAttributes & HeaderProps'.
  Property 'selectedOrg' does not exist on type 'IntrinsicAttributes & HeaderProps'.
src/App.tsx(103,11): error TS2322: Type '{ activeTab: string; setActiveTab: Dispatch<SetStateAction<string>>; inTransitCount: number; inventoryCount: number; }' is not assignable to type 'IntrinsicAttributes & SidebarProps'.
  Property 'inTransitCount' does not exist on type 'IntrinsicAttributes & SidebarProps'.
src/App.tsx(115,15): error TS2322: Type '{ devices: Device[]; employees: Employee[]; hubs: Hub[]; logisticsTickets: LogisticsTicket[]; onNavigate: (tab: any) => void; onOpenCopilot: () => void; }' is not assignable to type 'IntrinsicAttributes & DashboardViewProps'.
  Property 'onNavigate' does not exist on type 'IntrinsicAttributes & DashboardViewProps'.
```

### Conteo por archivo

| Archivo | Errores |
|---|---|
| `src/App.tsx` | 3 |
| *(resto del repo)* | 0 |

### Conteo por código

| Código | Nº | Significado |
|---|---|---|
| `TS2322` | 3 | Props pasadas que no existen en la interfaz del componente |

### Con `--strict` (sonda, no activado)

| Archivo | Errores |
|---|---|
| `src/App.tsx` | 4 |

| Código | Nº |
|---|---|
| `TS2322` | 3 |
| `TS7006` | 1 — parámetro `tab` con `any` implícito, en el mismo `onNavigate` roto |

**La deuda es mucho menor de lo previsto.** Las 9 vistas son internamente
consistentes; toda la rotura está concentrada en las fronteras de props que
`App.tsx` cablea. Activar `strict` en la 4a costará poco.

## Análisis por frontera

`tsc` reporta **una sola propiedad sobrante por elemento JSX** y se detiene ahí,
así que los 3 errores subestiman el desajuste real. El diff completo:

### `App.tsx` → `Header` (línea 88)

| | Props |
|---|---|
| Coinciden | `searchTerm`, `setSearchTerm`, `onOpenNewDeviceModal` |
| **Sobran** | `selectedOrg`, `setSelectedOrg`, `onOpenCopilot` |
| **Faltan** | `onOpenAiCopilot`, `onOpenOnboardingModal`, `activeTab`, `setActiveTab` |

Efecto en runtime: el botón **"Copilot IA" no hace nada** (`onOpenCopilot` ≠
`onOpenAiCopilot`), el botón **"Enviar Kit" no hace nada**, y hacer clic en el
logo lanza **`setActiveTab is not a function`**.

### `App.tsx` → `Sidebar` (línea 103)

| | Props |
|---|---|
| Coinciden | `activeTab`, `setActiveTab` |
| **Sobran** | `inTransitCount`, `inventoryCount` |
| **Faltan** | `pendingLogisticsCount`, `maintenanceCount` |

Efecto en runtime: `undefined > 0` es `false`, así que **los dos badges del
sidebar nunca se renderizan**.

### `App.tsx` → `DashboardView` (línea 115)

| | Props |
|---|---|
| Coinciden | `devices`, `employees`, `hubs`, `logisticsTickets` |
| **Sobran** | `onNavigate`, `onOpenCopilot` |
| **Faltan** | `onOpenNewDeviceModal`, `onOpenOnboardingModal`, `onOpenAiCopilot`, `setActiveTab` |

Efecto en runtime: los cuatro manejadores del dashboard llegan `undefined`. Sus
botones de acción rápida están muertos y navegar desde las tarjetas lanza
`TypeError`.

## Estado

- **Commit 2 (este):** tipos activados, inventario levantado. Los 3 errores
  siguen abiertos a propósito: arreglarlos es lógica, no color, y mezclarlo con
  el diff de la paleta lo haría irrevisable.
- **Commit 3:** se reconectan las tres fronteras editando solo `App.tsx`, sin
  tocar los componentes ni rediseñar el flujo.

## Anotado para la etapa 4a

- **Activar `strict`.** Coste medido: 1 error adicional sobre el estado ya
  corregido.
- **Eliminar el selector de organización** del `Header` (decisión ya tomada).
  Es multi-tenant y hay una sola empresa. Hoy muestra `"TechCorp Global Inc."`
  hardcodeado mientras `App` mantiene un `selectedOrg = 'Acme LatAm Tech'` que
  nadie consume — esa es la raíz de las props sobrantes `selectedOrg` /
  `setSelectedOrg`.
- **Lockfile:** conviven `bun.lock` (commiteado) y `package-lock.json` (sin
  trackear). Decidir cuál es el canónico.
- `Sparkles` está importado y sin usar en `Sidebar.tsx` (`noUnusedLocals` no
  está activo, por eso no se reporta).
