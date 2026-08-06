/**
 * Lo único que puede salir hacia Gemini (§6 y D5).
 *
 * Antes era una plantilla de cadena dentro de `App.tsx`. Cumplía la regla, pero
 * el riesgo nunca fue que estuviera mal: era que alguien la ampliara sin
 * pensarlo, porque interpolar un campo más cuesta doce caracteres.
 *
 * Como función con una lista blanca, añadir un campo obliga a tocar este
 * fichero, que es donde está escrito qué no puede salir.
 */

import type { Equipo, Sede } from '../types';

/**
 * PROHIBIDO ENVIAR, EN CUALQUIER CIRCUNSTANCIA:
 *
 *   bios_password, licencia_serial, serial, sesion_usuario,
 *   cedula, email_corporativo, direcciones y nombres de empleados.
 *
 * Ampliar la lista de abajo requiere revisión: ver plan-migracion-v1.md §6.
 */
export function construirContextoIA(equipos: Equipo[], sedes: Sede[]): string {
  const porEstado = new Map<string, number>();
  const porCategoria = new Map<string, number>();
  const porMarca = new Map<string, number>();

  for (const e of equipos) {
    porEstado.set(e.estado, (porEstado.get(e.estado) ?? 0) + 1);
    porCategoria.set(e.categoria, (porCategoria.get(e.categoria) ?? 0) + 1);
    if (e.marca) porMarca.set(e.marca, (porMarca.get(e.marca) ?? 0) + 1);
  }

  const resumir = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ');

  // Solo agregados. Ni una fila individual, ni un identificador, ni un nombre.
  return [
    `Total de equipos: ${equipos.length}.`,
    `Por estado — ${resumir(porEstado)}.`,
    `Por categoría — ${resumir(porCategoria)}.`,
    `Por marca — ${resumir(porMarca)}.`,
    `Sedes: ${sedes.map((s) => s.nombre).join(', ')}.`,
    `Equipos pendientes de revisión de datos: ${equipos.filter((e) => e.requiere_revision).length}.`,
  ].join('\n');
}
