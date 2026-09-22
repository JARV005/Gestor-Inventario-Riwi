/**
 * Genera las actas de ejemplo. `npx tsx db/actas-ejemplo.ts`
 *
 * Datos inventados a propósito: son para MIRARLAS, no para probar nada. El
 * criterio de la etapa 5f es que estas cuatro se abran en un visor antes de dar
 * el formato por bueno — el acta de tres páginas con las firmas huérfanas tenía
 * el hash correcto y todas las comprobaciones sobre bytes en verde.
 *
 * No toca la base.
 */

import { writeFileSync } from 'node:fs';

import { generarPdfActa, sha256, type ActaParaPdf, type LineaActaPdf } from './acta-pdf.js';
import { PLANTILLA_VERSION } from './acta-formato.js';

const equipo = (n: Partial<LineaActaPdf> & { empresa: string }): LineaActaPdf => ({
  etiqueta: null,
  serial: null,
  marca: null,
  modelo: null,
  categoria: 'Portátil',
  condicion: null,
  procesador: null,
  ram: null,
  disco: null,
  sistema_operativo: null,
  accesorios: null,
  comentarios: null,
  ...n,
});

const PORTATIL = (etq: string, empresa: string) =>
  equipo({
    empresa,
    etiqueta: etq,
    serial: `SN-${etq}`,
    marca: 'Dell',
    modelo: 'Inspiron 15 3520',
    categoria: 'Portátil',
    procesador: 'Intel Core i5 13va',
    ram: '16GB',
    disco: '512GB',
    sistema_operativo: 'Windows 11 Pro',
    accesorios: 'Cargador, maletín',
  });

async function escribir(nombre: string, acta: ActaParaPdf) {
  const pdf = await generarPdfActa(acta);
  const ruta = `data/origen/ejemplo-${nombre}.pdf`;
  writeFileSync(ruta, pdf);
  console.log(
    `${ruta.padEnd(44)} ${String(pdf.length).padStart(7)} B  sha256 ${sha256(pdf).slice(0, 16)}…  plantilla ${PLANTILLA_VERSION[acta.tipo]}`,
  );
}

async function main() {
  const fecha = new Date('2026-03-26T15:00:00Z');

  // 1. Entrega de BBL: el caso de la muestra, con el chequeo relleno tal y como
  //    viene en el formato aprobado (BitLocker en No, los otros tres en Sí).
  await escribir('entrega-bbl', {
    consecutivo: 'BBL-0000',
    tipo: 'Entrega',
    fecha,
    empresa: 'BBL Labs',
    empleado_nombre: 'Valeria Taborda',
    empleado_cedula: null, // la muestra aprobada también lo trae vacío
    empleado_cargo: 'Analista de Datos',
    empleado_area: 'Tecnología',
    sede_nombre: 'Medellín',
    generada_por_nombre: 'Sebastián Espitia',
    chequeo: [
      { item: 'Office 365 / Teams / Firma', instalado: true, observaciones: null },
      { item: 'BitLocker', instalado: false, observaciones: 'Pendiente de activar' },
      { item: 'Edge – Chrome', instalado: true, observaciones: null },
      { item: 'Otros', instalado: true, observaciones: 'Zoom, AnyDesk' },
    ],
    equipos: [PORTATIL('BBL-0301', 'BBL Labs')],
  });

  // 2. Entrega de RIWI: logo apaisado (3.6:1), cédula presente, y un equipo
  //    prestado por BBL para que la columna «Propietario» no sea uniforme.
  await escribir('entrega-riwi', {
    consecutivo: 'RIWI-0000',
    tipo: 'Entrega',
    fecha,
    empresa: 'RIWI',
    empleado_nombre: 'Carlos Castaño Rodriguez',
    empleado_cedula: '1038337751',
    empleado_cargo: 'Coder',
    empleado_area: 'Formación',
    sede_nombre: 'Medellín',
    generada_por_nombre: 'Sebastián Espitia',
    chequeo: [
      { item: 'Office 365 / Teams / Firma', instalado: true, observaciones: null },
      { item: 'BitLocker', instalado: true, observaciones: null },
      { item: 'Edge – Chrome', instalado: true, observaciones: null },
      // Sin contestar: la casilla sale vacía. Un «Sí» premarcado en un
      // documento legal es una afirmación que nadie hizo.
      { item: 'Otros', instalado: null, observaciones: null },
    ],
    equipos: [
      PORTATIL('1705', 'RIWI'),
      equipo({
        empresa: 'BBL Labs',
        etiqueta: 'BBL-0077',
        serial: '46H9494',
        marca: 'Dell',
        modelo: 'Inspiron 15 3530',
        categoria: 'Portátil',
        comentarios: 'Prestado por BBL Labs',
      }),
      equipo({
        empresa: 'RIWI',
        etiqueta: null,
        serial: '2603APKA9JJ9',
        marca: 'Logitech',
        modelo: 'M170',
        categoria: 'Mouse',
        condicion: 'Nuevo',
      }),
    ],
  });

  // 3. Devolución de BBL: borrador, con el aviso en rojo y siete secciones.
  await escribir('devolucion-bbl', {
    consecutivo: 'BBL-0001',
    tipo: 'Devolución',
    fecha,
    empresa: 'BBL Labs',
    empleado_nombre: 'Valeria Taborda',
    empleado_cedula: null,
    empleado_cargo: 'Analista de Datos',
    empleado_area: 'Tecnología',
    sede_nombre: 'Medellín',
    generada_por_nombre: 'Sebastián Espitia',
    chequeo: null,
    equipos: [PORTATIL('BBL-0301', 'BBL Labs')],
  });

  // 4. Devolución de RIWI con DOCE equipos: el caso que rompe la página. La
  //    sección 4 tiene que crecer, saltar de hoja repitiendo su cabecera, y las
  //    firmas NO pueden quedarse huérfanas en una página en blanco.
  await escribir('devolucion-riwi-12', {
    consecutivo: 'RIWI-0001',
    tipo: 'Devolución',
    fecha,
    empresa: 'RIWI',
    empleado_nombre: 'Veronica Martinez',
    empleado_cedula: '1017283945',
    empleado_cargo: 'Coordinadora',
    empleado_area: 'Operaciones',
    sede_nombre: 'Barranquilla',
    generada_por_nombre: 'Sebastián Espitia',
    chequeo: null,
    equipos: Array.from({ length: 12 }, (_, i) =>
      PORTATIL(`BAQ-${String(i + 1).padStart(5, '0')}`, 'RIWI'),
    ),
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
