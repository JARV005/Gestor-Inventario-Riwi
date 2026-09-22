/**
 * El PDF del acta. Etapa 5f: el formato aprobado por BBL (D36–D39).
 *
 * Aquí no hay texto legal ni decisiones de formato: eso vive en
 * `db/acta-formato.ts`. Este fichero solo dibuja. Y no toca la base — entra una
 * instantánea, sale un `Buffer`.
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
 * El logo SÍ añade bytes, y son constantes porque el fichero es constante y se
 * lee de una ruta fija del repo. Cambiarlo cambia el hash de todas las actas
 * nuevas: por eso `LOGOS` obliga a subir `PLANTILLA_VERSION`.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import PDFDocument from 'pdfkit';

import {
  CHEQUEO_ITEMS,
  type ItemChequeo,
  DECLARACION,
  FIRMAS,
  LOGO_ALTO,
  LOGO_RATIO,
  LOGOS,
  PIE_CONTROLADO,
  PLANTILLA_VERSION,
  RESPONSABILIDADES,
  SECCION_FORMATO,
  SECCION_HISTORIAL,
  TITULO,
  type EmpresaActa,
  type TipoActa,
} from './acta-formato.js';

export { PLANTILLA_VERSION, type TipoActa, type EmpresaActa } from './acta-formato.js';

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
  /** Sección 4, columna «Propietario»: de qué empresa es ESTE equipo. */
  empresa: string;
  /** Sección 4, columna «Accesorios entregados». */
  accesorios: string | null;
  /** Sección 4, columna «Comentarios». */
  comentarios: string | null;
}

export interface ActaParaPdf {
  consecutivo: string;
  tipo: TipoActa;
  fecha: Date;
  /** De qué empresa es el acta. Decide el logo del encabezado. */
  empresa: EmpresaActa;
  empleado_nombre: string;
  empleado_cedula: string | null;
  empleado_cargo: string | null;
  empleado_area: string | null;
  sede_nombre: string | null;
  generada_por_nombre: string;
  equipos: LineaActaPdf[];
  /** Solo en entregas. `null` si el acta no lo lleva. */
  chequeo: ItemChequeo[] | null;
}

const MARGEN = 45;
const GRIS_BORDE = '#999999';
const GRIS_CABECERA = '#e8e8e8';
const NEGRO = '#000000';

/** Mínimo de filas de la sección 4: la plantilla trae cinco. */
const FILAS_INVENTARIO = 5;

const fechaLarga = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);

const oHueco = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '');

/** El documento. Función pura: mismos datos, mismos bytes. */
export function generarPdfActa(acta: ActaParaPdf): Promise<Buffer> {
  const version = PLANTILLA_VERSION[acta.tipo];
  const esBorrador = version.includes('borrador');

  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGEN,
    // El margen inferior deja sitio al pie controlado, que va en TODAS las
    // páginas. Sin esto, el texto de la última sección se le echa encima.
    bufferPages: true,
    info: {
      Title: `${TITULO[acta.tipo]} ${acta.consecutivo}`,
      Author: delEntorno('ORGANIZACION_RAZON_SOCIAL'),
      Subject: `${TITULO[acta.tipo]} — ${acta.empresa}`,
      // Las cuatro que hacen que el PDF sea reproducible. `CreationDate` es la
      // del acta y no la de generación: regenerarla mañana tiene que dar los
      // mismos bytes.
      Producer: 'inventario-bbl',
      Creator: `inventario-bbl plantilla ${version}`,
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

  const ANCHO = doc.page.width - MARGEN * 2;

  // -------------------------------------------------------------------------
  // Primitivas de tabla
  // -------------------------------------------------------------------------
  //
  // pdfkit no tiene tablas. Estas tres funciones son todo lo que hace falta y
  // se quedan aquí, cerca de quien las usa, en vez de en una librería: son
  // treinta líneas y una dependencia más sería otra cosa que mantener.

  /** Alto que ocuparía este texto en una celda de ancho `w`. */
  const altoTexto = (texto: string, w: number, tam: number, negrita = false) => {
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
    return doc.heightOfString(texto || ' ', { width: w - 8 });
  };

  interface Celda {
    texto: string;
    ancho: number;
    negrita?: boolean;
    fondo?: string;
    centrado?: boolean;
  }

  /** Dibuja una fila de celdas con borde y devuelve su alto. */
  const fila = (celdas: Celda[], y: number, tam = 8): number => {
    const alto =
      Math.max(
        ...celdas.map((c) => altoTexto(c.texto, c.ancho, tam, c.negrita)),
        11,
      ) + 6;

    let x = MARGEN;
    for (const c of celdas) {
      if (c.fondo) doc.rect(x, y, c.ancho, alto).fill(c.fondo);
      doc.rect(x, y, c.ancho, alto).strokeColor(GRIS_BORDE).lineWidth(0.5).stroke();
      doc
        .font(c.negrita ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(tam)
        .fillColor(NEGRO)
        .text(c.texto, x + 4, y + 3, {
          width: c.ancho - 8,
          align: c.centrado ? 'center' : 'left',
        });
      x += c.ancho;
    }
    return alto;
  };

  /**
   * Salta de página si lo que viene no cabe.
   *
   * Es lo que impide el acta de tres páginas con las firmas huérfanas: cada
   * bloque pregunta por su alto ANTES de empezar a dibujarse, en vez de dejar
   * que pdfkit corte por donde le toque.
   */
  const cabe = (alto: number) => {
    if (doc.y + alto > doc.page.height - MARGEN - 26) {
      doc.addPage();
      doc.y = MARGEN;
    }
  };

  const titulo = (n: string) => {
    cabe(28);
    doc.y += 6;
    const alto = fila(
      [{ texto: n, ancho: ANCHO, negrita: true, fondo: GRIS_CABECERA }],
      doc.y,
      9,
    );
    doc.y += alto;
  };

  // -------------------------------------------------------------------------
  // Encabezado: logo + título
  // -------------------------------------------------------------------------
  const rutaLogo = LOGOS[acta.empresa];
  const yEncabezado = doc.y;
  if (rutaLogo) {
    // **Escalado por altura, ancho libre.** Con una caja fija de ancho y alto,
    // el logo de RIWI —3.6:1, el doble de apaisado que el de BBL— sale
    // aplastado. Se le da el alto y el ancho sale del ratio.
    const anchoLogo = LOGO_ALTO * LOGO_RATIO[acta.empresa];
    doc.image(readFileSync(rutaLogo), MARGEN, yEncabezado, {
      height: LOGO_ALTO,
      width: anchoLogo,
    });
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(NEGRO)
    .text(TITULO[acta.tipo], MARGEN, yEncabezado + 10, { width: ANCHO, align: 'right' });

  doc.y = yEncabezado + LOGO_ALTO + 6;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555555')
    .text(
      `${acta.consecutivo}  ·  ${fechaLarga(acta.fecha)}` +
        (acta.sede_nombre ? `  ·  ${acta.sede_nombre}` : ''),
      MARGEN,
      doc.y,
      { width: ANCHO, align: 'right' },
    );
  doc.fillColor(NEGRO);

  // -------------------------------------------------------------------------
  // 1. Información del formato
  // -------------------------------------------------------------------------
  titulo('1. INFORMACIÓN DEL FORMATO');
  {
    const c = ANCHO / 4;
    let y = doc.y;
    y += fila(
      [
        { texto: 'Versión', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.version, ancho: c },
        { texto: 'Fecha', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.fecha, ancho: c },
      ],
      y,
    );
    y += fila(
      [
        { texto: 'Elaborado por', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.elaborado_por, ancho: c },
        { texto: 'Cargo', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.elaborado_cargo, ancho: c },
      ],
      y,
    );
    y += fila(
      [
        { texto: 'Aprobado por', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.aprobado_por, ancho: c },
        { texto: 'Cargo', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: SECCION_FORMATO.aprobado_cargo, ancho: c },
      ],
      y,
    );
    doc.y = y;
  }

  // -------------------------------------------------------------------------
  // 2. Historial de revisiones
  // -------------------------------------------------------------------------
  titulo('2. HISTORIAL DE REVISIONES');
  {
    const anchos = [0.08, 0.16, 0.26, 0.24, 0.16, 0.1].map((f) => ANCHO * f);
    let y = doc.y;
    y += fila(
      ['Versión', 'Autor', 'Descripción del cambio', 'Motivo del cambio', 'Aprobado por', 'Fecha'].map(
        (t, i) => ({ texto: t, ancho: anchos[i], negrita: true, fondo: GRIS_CABECERA }),
      ),
      y,
    );
    y += fila(
      [
        SECCION_HISTORIAL.version,
        SECCION_HISTORIAL.autor,
        SECCION_HISTORIAL.descripcion,
        SECCION_HISTORIAL.motivo,
        SECCION_HISTORIAL.aprobado_por,
        SECCION_HISTORIAL.fecha,
      ].map((t, i) => ({ texto: t, ancho: anchos[i] })),
      y,
    );
    doc.y = y;
  }

  // -------------------------------------------------------------------------
  // 3. Custodio
  // -------------------------------------------------------------------------
  titulo('3. INFORMACIÓN DEL CUSTODIO DEL ACTIVO');
  {
    const c = ANCHO / 4;
    let y = doc.y;
    y += fila(
      [
        { texto: 'Nombre completo', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: acta.empleado_nombre, ancho: c },
        {
          texto: 'Número de documento de identificación',
          ancho: c,
          negrita: true,
          fondo: GRIS_CABECERA,
        },
        // Hueco, no «—»: la muestra aprobada por BBL también lo trae vacío, y
        // la mayoría de las fichas del Excel no traen cédula. El aviso de que
        // falta va en el formulario de emisión, que es donde alguien puede
        // hacer algo al respecto.
        { texto: oHueco(acta.empleado_cedula), ancho: c },
      ],
      y,
    );
    y += fila(
      [
        { texto: 'Cargo', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: oHueco(acta.empleado_cargo), ancho: c },
        { texto: 'Área', ancho: c, negrita: true, fondo: GRIS_CABECERA },
        { texto: oHueco(acta.empleado_area), ancho: c },
      ],
      y,
    );
    doc.y = y;
  }

  // -------------------------------------------------------------------------
  // 4. Inventario
  // -------------------------------------------------------------------------
  titulo(
    acta.tipo === 'Entrega' ? '4. INVENTARIO DE ACTIVOS ENTREGADOS' : '4. INVENTARIO DE ACTIVOS DEVUELTOS',
  );
  {
    const anchos = [0.13, 0.2, 0.17, 0.12, 0.19, 0.19].map((f) => ANCHO * f);
    const cabecera = [
      'Tipo de activo',
      'Marca / Modelo',
      'Número de serie',
      'Propietario',
      // «entregados» en una devolución diría lo contrario de lo que pasa.
      acta.tipo === 'Entrega' ? 'Accesorios entregados' : 'Accesorios devueltos',
      'Comentarios',
    ];
    cabe(14 + 17 * Math.max(acta.equipos.length, FILAS_INVENTARIO));
    let y = doc.y;
    y += fila(
      cabecera.map((t, i) => ({ texto: t, ancho: anchos[i], negrita: true, fondo: GRIS_CABECERA })),
      y,
    );

    // La tabla crece si hay más equipos y se rellena con filas vacías si hay
    // menos: cinco es lo que trae la plantilla, y una tabla que encoge se lee
    // como si faltara algo.
    const total = Math.max(acta.equipos.length, FILAS_INVENTARIO);
    for (let i = 0; i < total; i++) {
      const e = acta.equipos[i];
      // Cada fila comprueba su propio hueco: con doce equipos la tabla salta
      // de página por sí sola y no se corta a mitad de una celda.
      if (y + 20 > doc.page.height - MARGEN - 26) {
        doc.addPage();
        y = MARGEN;
        y += fila(
          cabecera.map((t, j) => ({
            texto: t,
            ancho: anchos[j],
            negrita: true,
            fondo: GRIS_CABECERA,
          })),
          y,
        );
      }
      const valores = e
        ? [
            e.categoria,
            [e.marca, e.modelo].filter(Boolean).join(' '),
            oHueco(e.serial),
            e.empresa,
            oHueco(e.accesorios),
            oHueco(e.comentarios),
          ]
        : ['', '', '', '', '', ''];
      y += fila(
        valores.map((t, j) => ({ texto: t, ancho: anchos[j] })),
        y,
      );
    }
    doc.y = y;
  }

  // -------------------------------------------------------------------------
  // 5. Lista de chequeo — solo en entregas
  // -------------------------------------------------------------------------
  if (acta.tipo === 'Entrega') {
    titulo('5. LISTA DE CHEQUEO DE CONFIGURACIÓN Y ACCESOS');
    const anchos = [0.4, 0.15, 0.45].map((f) => ANCHO * f);
    let y = doc.y;
    y += fila(
      ['Lista de chequeo', 'Instalado', 'Observaciones'].map((t, i) => ({
        texto: t,
        ancho: anchos[i],
        negrita: true,
        fondo: GRIS_CABECERA,
        centrado: i === 1,
      })),
      y,
    );
    for (const nombre of CHEQUEO_ITEMS) {
      const dato = acta.chequeo?.find((c) => c.item === nombre);
      // Sin valor por defecto: si nadie contestó, la casilla va vacía. Un «Sí»
      // premarcado en un documento legal es una afirmación que nadie hizo.
      const marca = dato?.instalado === true ? 'Sí' : dato?.instalado === false ? 'No' : '';
      y += fila(
        [
          { texto: nombre, ancho: anchos[0] },
          { texto: marca, ancho: anchos[1], centrado: true },
          { texto: oHueco(dato?.observaciones), ancho: anchos[2] },
        ],
        y,
      );
    }
    doc.y = y;
  }

  // -------------------------------------------------------------------------
  // 6. Declaración
  // -------------------------------------------------------------------------
  const n6 = acta.tipo === 'Entrega' ? '6' : '5';
  titulo(`${n6}. DECLARACIÓN DE ${acta.tipo === 'Entrega' ? 'ENTREGA' : 'RECEPCIÓN'}`);
  {
    const alto = fila([{ texto: DECLARACION[acta.tipo], ancho: ANCHO }], doc.y);
    doc.y += alto;
  }

  // -------------------------------------------------------------------------
  // 7. Responsabilidades
  // -------------------------------------------------------------------------
  const n7 = acta.tipo === 'Entrega' ? '7' : '6';
  titulo(`${n7}. RESPONSABILIDADES DEL USUARIO Y CONDICIONES DE USO`);
  {
    const { intro, bloques } = RESPONSABILIDADES[acta.tipo];
    doc.font('Helvetica').fontSize(8).fillColor(NEGRO);
    cabe(doc.heightOfString(intro, { width: ANCHO }) + 6);
    doc.text(intro, MARGEN, doc.y + 3, { width: ANCHO, align: 'justify' });
    doc.y += 4;

    bloques.forEach((b, i) => {
      const encabezado = `${n7}.${i + 1} ${b.titulo}`;
      // El bloque entero mide antes de empezar: partir un apartado legal entre
      // dos páginas por la mitad de una frase es exactamente lo que se ve al
      // abrir el PDF y no al leer el código.
      doc.font('Helvetica-Bold').fontSize(8);
      let necesita = doc.heightOfString(encabezado, { width: ANCHO }) + 3;
      doc.font('Helvetica').fontSize(8);
      for (const p of b.puntos) {
        necesita += doc.heightOfString(p, { width: ANCHO - 12 }) + 2;
      }
      cabe(necesita);

      doc.font('Helvetica-Bold').fontSize(8).text(encabezado, MARGEN, doc.y + 3, { width: ANCHO });
      doc.font('Helvetica').fontSize(8);
      b.puntos.forEach((p, j) => {
        doc.text(`${String.fromCharCode(97 + j)}. ${p}`, MARGEN + 12, doc.y + 1, {
          width: ANCHO - 12,
          align: 'justify',
        });
      });
    });
    doc.y += 6;
  }

  // -------------------------------------------------------------------------
  // 8. Firmas — tres bloques, no dos
  // -------------------------------------------------------------------------
  const n8 = acta.tipo === 'Entrega' ? '8' : '7';
  {
    // El bloque de firmas mide 80 puntos y se pide entero: es el que salió
    // huérfano en una página en blanco la última vez.
    cabe(80 + 28);
    titulo(`${n8}. FIRMAS`);

    const etiquetas = FIRMAS[acta.tipo];
    const ancho = ANCHO / etiquetas.length;
    const y = doc.y;
    const ALTO_FIRMA = 62;

    etiquetas.forEach((etiqueta, i) => {
      const x = MARGEN + ancho * i;
      doc.rect(x, y, ancho, ALTO_FIRMA).strokeColor(GRIS_BORDE).lineWidth(0.5).stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(NEGRO)
        .text(etiqueta, x + 4, y + 4, { width: ancho - 8 });

      // Quién firma cada bloque: el usuario en el suyo, TI en los otros dos.
      // El nombre va impreso porque un acta con tres rayas anónimas obliga a
      // preguntar quién es quién.
      const esDelUsuario = etiqueta.includes(acta.tipo === 'Entrega' ? 'recibe' : 'entrega');
      const nombre = esDelUsuario ? acta.empleado_nombre : acta.generada_por_nombre;
      doc.font('Helvetica').fontSize(7).fillColor('#555555');
      doc.text(nombre, x + 4, y + 16, { width: ancho - 8 });

      doc
        .moveTo(x + 6, y + ALTO_FIRMA - 20)
        .lineTo(x + ancho - 6, y + ALTO_FIRMA - 20)
        .strokeColor(GRIS_BORDE)
        .stroke();
      doc.fontSize(7).fillColor('#555555');
      doc.text('Firma', x + 6, y + ALTO_FIRMA - 17, { width: (ancho - 12) / 2 });
      doc.text('Fecha', x + ancho / 2, y + ALTO_FIRMA - 17, { width: (ancho - 12) / 2 });
    });
    doc.y = y + ALTO_FIRMA;
    doc.fillColor(NEGRO);
  }

  // -------------------------------------------------------------------------
  // Pie, en TODAS las páginas
  // -------------------------------------------------------------------------
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
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const pie = doc.page.height - margenInferior + 2;

    doc.font('Helvetica').fontSize(6).fillColor('#777777');
    doc.text(PIE_CONTROLADO, MARGEN, pie - 10, { width: ANCHO, lineBreak: false });
    doc.text(
      `${acta.consecutivo} · ${acta.empresa} · plantilla ${version} · ` +
        `generada por ${acta.generada_por_nombre} · página ${i + 1} de ${rango.count}`,
      MARGEN,
      pie,
      { width: ANCHO, lineBreak: false },
    );

    // El aviso de borrador se ve en el documento a propósito: un acta con
    // aspecto de definitiva y con texto sin aprobar es la que alguien firma
    // sin mirar. Se quita cuando `PLANTILLA_VERSION` de ese tipo deje de decir
    // «borrador», y no antes.
    if (esBorrador) {
      doc.fillColor('#a33').fontSize(6);
      doc.text(
        'BORRADOR: el texto de devolución se ha adaptado del formato de entrega y NO ha sido aprobado por BBL.',
        MARGEN,
        pie + 8,
        { width: ANCHO, lineBreak: false },
      );
    }
    doc.page.margins.bottom = margenInferior;
  }

  doc.end();
  return terminado;
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
