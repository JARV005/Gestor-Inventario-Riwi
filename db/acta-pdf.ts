/**
 * El PDF del acta. Etapa 5b.
 *
 * ============================================================================
 * ESTE FICHERO CONTIENE TEXTO LEGAL SIN REVISAR. Ver `PLANTILLA_VERSION`.
 * ============================================================================
 *
 * Está aparte del repositorio a propósito: quien tenga que revisar la
 * redacción no debería tener que leer una transacción de Postgres para
 * encontrarla. Aquí no se toca la base — entra una instantánea, sale un
 * `Buffer`.
 *
 * ---
 *
 * **Reproducible byte a byte** (D16, D26). Un PDF lleva por defecto la fecha de
 * generación y el nombre del programa que lo hizo, así que el mismo documento
 * generado dos veces da dos ficheros distintos y su hash no significa nada.
 * Aquí se fijan las cuatro cosas que varían:
 *
 *   - `CreationDate` y `ModDate` → la fecha del acta, no `now()`
 *   - `Producer` y `Creator`     → constantes
 *
 * Fuentes: solo las estándar de PDF (Helvetica). No se incrustan, así que no
 * añaden bytes que dependan de la versión de una fuente del sistema.
 *
 * Comprobado antes de construir nada encima: dos generaciones separadas 1,1 s
 * dan el mismo sha256; cambiar el contenido o la fecha lo cambia.
 */

import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';

/**
 * La versión de la redacción, que se guarda en cada acta.
 *
 * **`-borrador` mientras nadie de BBL la haya revisado.** El acta lo dice en su
 * pie, visible: quien decide qué debe decir un acta de entrega no es quien la
 * programa. Cuando esté revisada, esto pasa a `'1'`, el pie de borrador se
 * quita, y las actas viejas conservan su `plantilla_version` — por eso la
 * columna existe.
 */
export const PLANTILLA_VERSION = '1-borrador';

/**
 * La razón social sale del entorno y **nunca tiene valor por defecto**.
 *
 * Inventarla sería exactamente lo que hacía el prototipo, que imprimía el
 * nombre de otra empresa. Si no está puesta, el acta enseña el hueco: un
 * documento con un espacio en blanco no se firma por error, uno con el nombre
 * equivocado sí.
 */
function delEntorno(clave: string): string {
  const v = process.env[clave]?.trim();
  return v && v.length > 0 ? v : '________________________';
}

export interface LineaActaPdf {
  etiqueta: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: string;
  condicion: string | null;
  procesador: string | null;
  ram: string | null;
  disco: string | null;
  sistema_operativo: string | null;
}

export interface ActaParaPdf {
  consecutivo: string;
  tipo: 'Entrega' | 'Devolución';
  fecha: Date;
  empleado_nombre: string;
  empleado_cedula: string | null;
  empleado_cargo: string | null;
  empleado_area: string | null;
  sede_nombre: string | null;
  generada_por_nombre: string;
  equipos: LineaActaPdf[];
}

const MARGEN = 56;

const fechaLarga = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);

/**
 * Las cláusulas. **Texto pendiente de revisión legal.**
 *
 * Del original del prototipo se corrigieron tres cosas que estaban mal:
 *
 *  - El estado físico iba fijo en «Excelente / Como Nuevo (Certificado
 *    FirstPlug)», sin mirar el equipo. Ahora sale de `condicion`, y si es NULL
 *    va vacío — que es lo correcto en un portátil, donde `verificar-datos.sql`
 *    §D prohíbe que ese campo esté relleno.
 *  - La cláusula de devolución mandaba usar «el kit de recolección FirstPlug»,
 *    que no existe. Aquí dice que la devolución se coordina con TI, que es lo
 *    único cierto hasta que alguien defina el protocolo.
 *  - El original llevaba un número de acta inventado. Este sale de la
 *    secuencia real.
 */
const CLAUSULAS: Record<'Entrega' | 'Devolución', string[]> = {
  Entrega: [
    'El colaborador declara recibir el equipo descrito en este documento, en el estado que aquí se consigna, y haber verificado sus datos de identificación (marca, modelo y número de serie).',
    'El equipo es propiedad de la organización y se entrega exclusivamente para el desempeño de las funciones asignadas.',
    'El colaborador se compromete a custodiar el equipo con diligencia y a notificar a TI, de forma inmediata, cualquier falla, pérdida, hurto o daño.',
    'El colaborador no instalará software sin licencia ni cederá el equipo a terceros sin autorización de TI.',
    'A la terminación del vínculo, o cuando la organización lo solicite, el colaborador devolverá el equipo. La devolución se coordina con el área de TI y queda registrada en un acta de devolución.',
  ],
  Devolución: [
    'El colaborador hace entrega del equipo descrito en este documento y la organización lo recibe en el estado que aquí se consigna.',
    'La verificación técnica del equipo es posterior a esta acta. Cualquier daño o faltante detectado se documentará por separado.',
    'Con la firma de este documento, y salvo lo indicado en el punto anterior, cesa la responsabilidad de custodia del colaborador sobre el equipo.',
  ],
};

/** El documento. Función pura: mismos datos, mismos bytes. */
export function generarPdfActa(acta: ActaParaPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGEN,
    info: {
      Title: `Acta de ${acta.tipo} ${acta.consecutivo}`,
      Author: delEntorno('ORGANIZACION_RAZON_SOCIAL'),
      Subject: `Acta de ${acta.tipo.toLowerCase()} de equipo de cómputo`,
      // Las cuatro que hacen que el PDF sea reproducible. `CreationDate` es la
      // del acta y no la de generación: regenerarla mañana tiene que dar los
      // mismos bytes.
      Producer: 'inventario-bbl',
      Creator: `inventario-bbl plantilla ${PLANTILLA_VERSION}`,
      CreationDate: acta.fecha,
      ModDate: acta.fecha,
    } as never,
  });

  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const terminado = new Promise<Buffer>((resolver, rechazar) => {
    doc.on('end', () => resolver(Buffer.concat(trozos)));
    doc.on('error', rechazar);
  });

  const ancho = doc.page.width - MARGEN * 2;
  const linea = () =>
    doc
      .moveTo(MARGEN, doc.y)
      .lineTo(MARGEN + ancho, doc.y)
      .strokeColor('#cccccc')
      .stroke()
      .moveDown(0.6);

  // ---- Encabezado --------------------------------------------------------
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor('#000000')
    .text(`ACTA DE ${acta.tipo.toUpperCase()} DE EQUIPO DE CÓMPUTO`, { align: 'center' })
    .moveDown(0.3);

  // `lineGap`: cuando la razón social no está puesta, las dos líneas son rayas
  // de subrayado y se tocan — se ve al abrir el PDF, no al leer el código.
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(delEntorno('ORGANIZACION_RAZON_SOCIAL'), { align: 'center', lineGap: 4 })
    .text(`NIT ${delEntorno('ORGANIZACION_NIT')}`, { align: 'center' })
    .moveDown(0.8);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(acta.consecutivo, { align: 'center' })
    .font('Helvetica')
    .fontSize(9)
    .text(
      `${fechaLarga(acta.fecha)}${acta.sede_nombre ? ` · ${acta.sede_nombre}` : ''}`,
      { align: 'center' },
    )
    .moveDown(1);

  linea();

  // ---- Colaborador -------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(10).text('DATOS DEL COLABORADOR').moveDown(0.4);
  doc.font('Helvetica').fontSize(10);

  const campo = (etiqueta: string, valor: string | null) => {
    doc.text(`${etiqueta}: ${valor && valor.trim() ? valor : '—'}`);
  };
  campo('Nombre', acta.empleado_nombre);
  campo('Documento', acta.empleado_cedula);
  campo('Cargo', acta.empleado_cargo);
  campo('Área', acta.empleado_area);
  campo('Sede', acta.sede_nombre);
  doc.moveDown(0.8);

  linea();

  // ---- Equipos -----------------------------------------------------------
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(acta.equipos.length === 1 ? 'EQUIPO' : `EQUIPOS (${acta.equipos.length})`)
    .moveDown(0.4);

  for (const e of acta.equipos) {
    const titulo = [e.marca, e.modelo].filter(Boolean).join(' ') || e.categoria;
    doc.font('Helvetica-Bold').fontSize(10).text(titulo);
    doc.font('Helvetica').fontSize(9);
    campo('  Tipo', e.categoria);
    campo('  Etiqueta de inventario', e.etiqueta);
    campo('  Número de serie', e.serial);

    const especificaciones = [e.procesador, e.ram, e.disco, e.sistema_operativo]
      .filter(Boolean)
      .join(' · ');
    campo('  Especificaciones', especificaciones || null);
    // Vacío si el equipo no tiene condición registrada. El original ponía
    // «Excelente» siempre, que es afirmar sobre un equipo que nadie miró.
    campo('  Estado', e.condicion);
    doc.moveDown(0.5);
  }

  linea();

  // ---- Cláusulas ---------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(10).text('CONDICIONES').moveDown(0.4);
  doc.font('Helvetica').fontSize(9);

  CLAUSULAS[acta.tipo].forEach((texto, i) => {
    doc.text(`${i + 1}. ${texto}`, { align: 'justify', indent: 0 }).moveDown(0.35);
  });

  doc.moveDown(1.5);

  // ---- Firmas ------------------------------------------------------------
  const yFirmas = doc.y;
  const anchoFirma = (ancho - 40) / 2;

  doc
    .moveTo(MARGEN, yFirmas)
    .lineTo(MARGEN + anchoFirma, yFirmas)
    .strokeColor('#000000')
    .stroke();
  doc
    .moveTo(MARGEN + anchoFirma + 40, yFirmas)
    .lineTo(MARGEN + ancho, yFirmas)
    .stroke();

  doc.font('Helvetica').fontSize(9);
  doc.text(acta.empleado_nombre, MARGEN, yFirmas + 6, { width: anchoFirma });
  doc.text(
    acta.empleado_cedula ? `C.C. ${acta.empleado_cedula}` : 'Colaborador',
    MARGEN,
    doc.y,
    { width: anchoFirma },
  );

  doc.text(acta.generada_por_nombre, MARGEN + anchoFirma + 40, yFirmas + 6, {
    width: anchoFirma,
  });
  doc.text('Por el área de TI', MARGEN + anchoFirma + 40, doc.y, { width: anchoFirma });

  // ---- Pie ---------------------------------------------------------------
  //
  // El aviso de borrador se ve en el documento a propósito, igual que el hueco
  // del dashboard: un acta con aspecto de definitiva y con texto sin revisar es
  // la que alguien firma sin mirar. Se quita cuando `PLANTILLA_VERSION` deje de
  // decir «borrador», y no antes.
  //
  // ATENCIÓN AL MARGEN INFERIOR. Escribir por debajo de él hace que pdfkit
  // añada una página automáticamente, y el pie se lleva el documento a la
  // siguiente hoja — luego el segundo `text()` añade otra. Un acta de un solo
  // equipo salía en TRES páginas por esto, con las firmas huérfanas en la
  // primera. Se vio abriendo el PDF, no leyendo el código: el generador no
  // falla, produce un documento válido y equivocado.
  //
  // Se pone el margen inferior a cero mientras se escribe el pie y se restaura
  // después, que es la forma que tiene pdfkit de decir «esto va en el margen».
  const margenInferior = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const pie = doc.page.height - margenInferior + 8;
  doc.fontSize(7).fillColor('#666666');
  doc.text(
    `${acta.consecutivo} · generada por ${acta.generada_por_nombre} · plantilla ${PLANTILLA_VERSION}`,
    MARGEN,
    pie - 12,
    { width: ancho, lineBreak: false },
  );
  if (PLANTILLA_VERSION.includes('borrador')) {
    doc.fillColor('#a33').text(
      'BORRADOR: el texto de este documento no ha sido revisado por el área legal de la organización.',
      MARGEN,
      pie,
      { width: ancho, lineBreak: false },
    );
  }

  doc.page.margins.bottom = margenInferior;
  doc.end();
  return terminado;
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
