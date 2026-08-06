# Paleta RIWI

> Tokens definidos en `src/index.css` dentro de `@theme` (Tailwind 4).
> Contrastes medidos con WCAG 2.1 sobre los hex reales, no estimados.

## Estado: aplicación PARCIAL

La paleta está aplicada **solo al armazón**: `Sidebar.tsx`, `Header.tsx` y
`App.tsx`.

Las vistas grandes siguen con los colores crudos de Tailwind (`blue-600`,
`slate-500`, `emerald-500`…) y se pintarán cuando se reconstruyan en etapas
posteriores:

`InventoryView` · `DashboardView` · `EmployeesView` · `MaintenanceView`
`HandoverDocumentView` · `LogisticsHubsView`
`OnboardingModal` · `NewDeviceModal`

*(`AiCopilotModal` estaba en esta lista y ya no existe: el copiloto se eliminó
en la 4b, `decisiones-03.md` §D12. `LogisticsHubsView` lo sustituyó `SedesView`
en la 4a.)*

**La app se ve despareja a propósito.** No es un defecto pendiente de arreglar:
pintar componentes que se van a reescribir en la 4a sería trabajo tirado.

En código nuevo no se usan colores crudos de Tailwind. Solo tokens.

---

## Tokens

### Marca

| Token | Hex | Uso |
|---|---|---|
| `brand` | `#5B4FE0` | Acción primaria, ítem de nav activo, foco |
| `brand-hover` | `#4A3ECC` | Hover de acción primaria; texto de marca sobre `brand-subtle` |
| `brand-light` | `#7C71F0` | Acentos no textuales: barra de ítem activo, iconos sobre `nav` |
| `brand-subtle` | `#EEECFC` | Fondo de chip de marca, hover suave sobre superficie clara |

### Superficies claras — el cuerpo de la app

| Token | Hex | Uso |
|---|---|---|
| `surface` | `#FFFFFF` | Tarjetas, cabecera, popovers |
| `surface-alt` | `#F7F7FB` | Fondo de página, inputs, filas alternas |
| `line` | `#E3E2EE` | Bordes y divisores |

### Tinta sobre superficie clara

| Token | Hex | Uso |
|---|---|---|
| `ink` | `#1D1C4A` | Texto principal; texto sobre cualquier chip de estado |
| `ink-muted` | `#6E6E8B` | Texto secundario, iconos, placeholders |
| `ink-faint` | `#9B9AB0` | **Solo decoración** y fondo del chip `Reservado` |

### Estado

| Token | Hex | Sobre blanco |
|---|---|---|
| `ok` | `#57C99B` | 2.05:1 |
| `warn` | `#E5C84B` | 1.65:1 |
| `danger` | `#F4593F` | 3.31:1 |
| `info` | `#DDA5F2` | 1.96:1 |

### Superficie oscura — solo el sidebar

| Token | Valor | Resuelto sobre `nav` | Uso |
|---|---|---|---|
| `nav` | `#1D1C4A` | — | Fondo del sidebar |
| `nav-deep` | `#15143A` | — | Panel hundido dentro del sidebar |
| `nav-ink` | `#EDECF5` | — | Texto principal del sidebar |
| `nav-muted` | `rgba(237,236,245,.64)` | `#A2A1B7` | Texto secundario del sidebar |
| `nav-line` | `rgba(237,236,245,.17)` | `#403F67` | Bordes dentro del sidebar |
| `nav-hover` | `rgba(237,236,245,.08)` | `#2E2D58` | Overlay de hover de ítem |

---

## Reglas

### 1. Los colores de estado NUNCA son texto

`ok`, `warn`, `danger` e `info` miden entre **1.65:1 y 3.31:1** sobre blanco.
Ninguno alcanza el 4.5:1 de texto; tres no alcanzan ni el 3:1 no textual.

Van **siempre como fondo de chip**. Nunca `text-ok`, `text-warn`,
`text-danger`, `text-info`.

### 2. El texto del chip se elige por la luminosidad del fondo

No hay un color de texto fijo para los chips. Se elige el que contrasta contra
ese fondo concreto:

| Fondo | Texto | Chips |
|---|---|---|
| Claro | `ink` | `ok`, `warn`, `danger`, `info`, `ink-faint` |
| Oscuro | blanco | `brand` |

`brand` es el **único chip oscuro del set**. Con `ink` daría 2.76:1 y no
cumpliría; con blanco da 5.77:1.

Formular la regla como "texto `ink` siempre" era un atajo que funcionaba solo
mientras todos los chips fueran claros. Al añadir `brand` deja de valer: lo que
se mantiene constante no es el color del texto, sino el contraste.

### 3. `ink-faint` no es un color de texto

`ink-faint` da **2.75:1 sobre `surface`** y **2.57:1 sobre `surface-alt`**. No
llega al 4.5:1 de texto ni al 3:1 no textual.

Se usa solo para **decoración** (puntos de estado, separadores) y como **fondo
del chip `Reservado`**, donde con texto `ink` da 5.80:1.

Por eso `slate-400` **no** se mapea a `ink-faint` sino a `ink-muted` (4.92:1).

### 4. `brand-light` no es un color de texto sobre blanco

3.83:1. Vale para texto grande (≥24px, o ≥18.66px en negrita) y para elementos
no textuales. Sobre `nav` da 4.16:1 y cumple el 3:1 no textual.

---

## Contrastes medidos

### Superficie clara

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `ink` / `surface` | 15.94:1 | 4.5 | ✅ |
| `ink` / `surface-alt` | 14.92:1 | 4.5 | ✅ |
| `ink` / `brand-subtle` | 13.69:1 | 4.5 | ✅ |
| `ink-muted` / `surface` | 4.92:1 | 4.5 | ✅ |
| `ink-muted` / `surface-alt` | 4.61:1 | 4.5 | ✅ |
| `brand` / `surface` | 5.77:1 | 4.5 | ✅ |
| `brand-hover` / `surface` | 7.36:1 | 4.5 | ✅ |
| `brand-hover` / `brand-subtle` | 6.32:1 | 4.5 | ✅ |
| blanco / `brand` | 5.77:1 | 4.5 | ✅ |
| blanco / `brand-hover` | 7.36:1 | 4.5 | ✅ |
| `ink-faint` / `surface` | 2.75:1 | 4.5 | ❌ solo decoración, regla 3 |
| `brand-light` / `surface` | 3.83:1 | 4.5 | ❌ solo texto grande, regla 4 |
| `line` / `surface` | 1.28:1 | 3.0 | ⚠️ divisor decorativo |
| `ink-muted` / `brand-subtle` | 4.23:1 | 4.5 | ❌ no usar; usar `ink` |

### Superficie oscura (sidebar)

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `nav-ink` / `nav` | 13.60:1 | 4.5 | ✅ |
| `nav-muted` / `nav` | 6.31:1 | 4.5 | ✅ |
| `nav-ink` / `nav-deep` | 15.02:1 | 4.5 | ✅ |
| `nav-muted` / `nav-deep` | 6.97:1 | 4.5 | ✅ |
| `nav-muted` / `nav-hover` | 5.10:1 | 4.5 | ✅ |
| `nav-ink` / `nav-hover` | 10.98:1 | 4.5 | ✅ |
| `brand-light` / `nav` | 4.16:1 | 3.0 | ✅ barra de ítem activo |
| `nav-line` / `nav` | 1.61:1 | 3.0 | ⚠️ divisor decorativo |
| `brand` / `nav` | 2.76:1 | 3.0 | ❌ ver nota del ítem activo |

### Chips de estado

Texto elegido por luminosidad del fondo (regla 2):

| Estado | Fondo | Texto | Ratio | |
|---|---|---|---|---|
| Disponible | `ok` | `ink` | 7.77:1 | ✅ |
| Asignado | `brand` | **blanco** | 5.77:1 | ✅ |
| En mantenimiento | `warn` | `ink` | 9.64:1 | ✅ |
| En tránsito | `info` | `ink` | 8.15:1 | ✅ |
| De baja | `danger` | `ink` | 4.82:1 | ✅ |
| Reservado | `ink-faint` | `ink` | 5.80:1 | ✅ |

Descartado: `brand` con texto `ink` da 2.76:1.

---

## Mapeo de badges de estado

Para cuando se reconstruyan las vistas:

| Estado | Fondo | Texto |
|---|---|---|
| Disponible | `ok` | `ink` |
| Asignado | `brand` | `white` |
| En mantenimiento | `warn` | `ink` |
| En tránsito | `info` | `ink` |
| De baja | `danger` | `ink` |
| Reservado | `ink-faint` | `ink` |

Ningún hex de la paleta se ajustó para que esto cuadrara.

---

## Nota sobre el ítem activo del sidebar

Un bloque `brand` sobre `nav` da solo **2.76:1**, insuficiente para señalar
estado por sí mismo. La marca de ítem activo combina dos señales, medidas por
separado:

1. **Barra izquierda de 3px en `brand-light`** — 4.16:1 sobre `nav`, cumple el
   3:1 de elemento no textual. Es la que porta la accesibilidad.
2. **Texto blanco sobre `brand`** — 5.77:1, cumple el 4.5:1 de texto.

El hover usa el overlay `nav-hover` (aclara), nunca `nav-deep`: oscurecer en
hover se lee como deshabilitado.

---

## Mapeo aplicado

| Antes | Después |
|---|---|
| `blue-600` / `blue-700` | `brand` / `brand-hover` |
| `blue-50` / `blue-200` | `brand-subtle` / `line` |
| `slate-900` | `ink` |
| `slate-500`, `slate-600`, `slate-700` | `ink-muted` |
| `slate-400` | `ink-muted` (**no** `ink-faint`, ver regla 3) |
| `slate-50`, `slate-100` | `surface-alt` |
| `slate-200` | `line` |
| `bg-[#F8FAFC]` | `surface-alt` |
| `bg-[#0F172A]`, `slate-800` | `nav`, `nav-deep`, `nav-line`, `nav-hover` |
| `emerald-*` (badges de estado) | `ok` como fondo de chip |
| `amber-*` (badges de estado) | `warn` como fondo de chip |
| `text-amber-700` (texto de aviso) | chip `warn` con texto `ink` — `warn` no puede ser texto |

---

## Detalles de implementación

- **`nav-hover`** es el único token que no venía en la lista original de RIWI.
  Se añadió para no repetir `rgba(237,236,245,.08)` inline en cada ítem. Mismo
  valor especificado, expresado como token.
- **`--color-danger` no aparece en el CSS compilado** todavía. Tailwind 4 solo
  emite los tokens que alguna utilidad usa, y ninguna vista pintada muestra aún
  el estado "De baja". Aparecerá solo cuando se use. No es un fallo.
- **"Garantía por vencer"** en el `Header` era `text-amber-700`. Pasarlo a `ink`
  a secas dejaba las tres notificaciones visualmente idénticas: el aviso dejaba
  de avisar. Ahora es un **chip `warn` con texto `ink`** (9.64:1), que conserva
  la señal sin usar el color como texto.
