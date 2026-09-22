/**
 * El FORMATO del acta: lo que es igual en todas. Etapa 5f (D36–D39).
 *
 * ============================================================================
 * TEXTO LEGAL APROBADO POR BBL. NO SE EDITA SIN SUBIR `PLANTILLA_VERSION`.
 * ============================================================================
 *
 * Está separado del generador a propósito, y la separación no es de estilo: lo
 * de aquí son **decisiones de BBL**, no de quien programa. Quien tenga que
 * revisar una cláusula no debería abrir un fichero que dibuja tablas, y quien
 * mueva una tabla no debería tener el texto legal a mano de tocar.
 *
 * Las secciones 1 y 2 son metadatos del FORMATO, no del acta: valen lo mismo
 * en todas las actas de una misma `plantilla_version`. Por eso son constantes
 * y no columnas — guardarlas por acta sería repetir 300 veces el mismo dato y
 * abrir la puerta a que dos actas de la misma versión digan cosas distintas.
 */

/**
 * La versión de la redacción, **por tipo de acta** (D36).
 *
 * El formato de ENTREGA está aprobado por BBL: pasa a `'1'` y su acta ya no
 * lleva el aviso de borrador.
 *
 * El de DEVOLUCIÓN **no existe**: se ha adaptado del de entrega y sigue en
 * borrador hasta que BBL lo apruebe. No es una formalidad — las cláusulas
 * 7.1–7.9 están escritas para quien recibe y asume custodia, y copiadas tal
 * cual a una devolución dirían que la persona sigue obligada a custodiar
 * equipos que acaba de entregar. Ver `RESPONSABILIDADES` y
 * `docs/pendientes.md`.
 */
export const PLANTILLA_VERSION: Record<TipoActa, string> = {
  Entrega: '1',
  Devolución: '1-borrador',
};

export type TipoActa = 'Entrega' | 'Devolución';
export type EmpresaActa = 'RIWI' | 'BBL Labs' | 'Sin clasificar';

/**
 * El logo, por empresa, leído de una **ruta fija del repo** (D39).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  LOS BYTES DEL LOGO ENTRAN EN EL PDF, ASÍ QUE FORMAN PARTE DEL HASH.     │
 * │  RETOCAR UN LOGO OBLIGA A SUBIR `PLANTILLA_VERSION`.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Sin esa regla, un día alguien reexporta el PNG con otro compresor, todas las
 * actas nuevas salen con un hash distinto por un cambio que nadie registró, y
 * comparar una de mañana contra una de hoy deja de significar nada. La versión
 * es lo único que permite decir «estas dos se generaron con el mismo
 * documento».
 *
 * Y por eso el logo NO se sube por la interfaz: un fichero que cualquiera
 * puede cambiar sin dejar rastro no puede ser parte de un hash que se usa como
 * prueba.
 *
 * `Sin clasificar` no tiene logo, y eso se ve como un hueco en el
 * encabezado. Es el mismo criterio que `delEntorno`: un acta con un espacio en
 * blanco no se firma por error; una con el logo de la otra empresa, sí.
 */
export const LOGOS: Record<EmpresaActa, string | null> = {
  RIWI: 'assets/logos/logo-riwi.png',
  'BBL Labs': 'assets/logos/logo-bbl.png',
  'Sin clasificar': null,
};

/**
 * Proporciones de cada logo, medidas del fichero.
 *
 * Están aquí y no se calculan al vuelo porque el ancho se deriva de ellas y
 * pdfkit necesita el número antes de dibujar. Si un logo se sustituye, esto
 * cambia — y `PLANTILLA_VERSION` también, por la regla de arriba.
 *
 *   RIWI: 4500 × 1246  → 3.612  (muy apaisado)
 *   BBL:   176 ×   98  → 1.796
 *
 * **Se escala por ALTURA con el ancho libre.** Con una caja fija de ancho y
 * alto, el de RIWI —el doble de apaisado que el de BBL— sale aplastado. Se
 * comprueba abriendo las actas, no calculándolo.
 */
export const LOGO_RATIO: Record<EmpresaActa, number> = {
  RIWI: 4500 / 1246,
  'BBL Labs': 176 / 98,
  'Sin clasificar': 1,
};

/** Alto del logo en el encabezado, en puntos. El ancho sale del ratio. */
export const LOGO_ALTO = 34;

/**
 * Sección 1 — Información del formato.
 *
 * Constante atada a `PLANTILLA_VERSION`. Los nombres y cargos son los que
 * figuran en el formato aprobado por BBL.
 */
export const SECCION_FORMATO = {
  version: '1',
  fecha: '26 de marzo de 2026',
  elaborado_por: 'Sebastián Espitia',
  elaborado_cargo: 'IT Infrastructure Analyst',
  aprobado_por: 'Eduardo Rebage',
  aprobado_cargo: 'Head of Operations and Technology',
} as const;

/**
 * Sección 2 — Historial de revisiones. **Del formato, no del acta.**
 *
 * La muestra de BBL trae aquí «Entrega de quipo» y «Ingreso a la compañía»,
 * que describen la entrega concreta de Valeria Taborda y no una revisión del
 * formato. Congelado tal cual, un acta de devolución diría que esa persona
 * ingresa a la compañía, y una reasignación lo mismo.
 *
 * Como la sección es del formato, se llena con contenido de formato. Y el
 * «quipo» de la muestra es una errata: se corrige, porque este texto va a
 * salir cientos de veces. Queda anotado en `docs/decisiones-06.md` para que
 * quien compare contra la muestra no lo lea como un error nuestro.
 */
export const SECCION_HISTORIAL = {
  version: '1',
  autor: SECCION_FORMATO.elaborado_por,
  fecha: SECCION_FORMATO.fecha,
  descripcion: 'Versión inicial del formato',
  motivo: 'Adopción del formato en el sistema de inventario',
  aprobado_por: SECCION_FORMATO.aprobado_por,
} as const;

/**
 * Las empresas que **pueden emitir** un acta (D42).
 *
 * `Sin clasificar` no está, y esa ausencia es la regla: no es una empresa, es
 * la marca de que nadie ha dicho de quién es esta persona. Un acta es un
 * documento entre dos partes, y una de ellas no puede ser «se desconoce».
 *
 * El tipo es lo que sostiene la regla, no un `if`: al ser una clave de
 * `PREFIJO_CONSECUTIVO`, cualquier código que intente numerar un acta de
 * `Sin clasificar` no compila. Un `Record<EmpresaActa, string>` con las tres
 * dejaba la puerta abierta a que alguien la usara sin enterarse.
 */
export type EmpresaQueEmite = Exclude<EmpresaActa, 'Sin clasificar'>;

/**
 * El prefijo de la serie de consecutivos, **una por empresa** (D40).
 *
 * El prefijo no es decoración: hace imposible confundir dos actas de series
 * distintas en un correo o en una conversación. Con una serie por empresa,
 * `0007` a secas es ambiguo y `BBL-0007` no lo es.
 *
 * **Hubo un tercero, `SC`, y se retiró en la 5f-2** (D42). Lo había puesto yo
 * para que un empleado sin empresa pudiera recibir equipos, y el razonamiento
 * estaba al revés: `SC-0000` en la cabecera de un documento legal no le dice
 * nada a quien lo recibe y firma. El hueco se tapa asignando la empresa —un
 * desplegable—, no inventando una serie para el hueco.
 */
export const PREFIJO_CONSECUTIVO: Record<EmpresaQueEmite, string> = {
  RIWI: 'RIWI',
  'BBL Labs': 'BBL',
};

/** ¿Esta empresa puede emitir? Estrecha el tipo, así que vale de guarda. */
export function puedeEmitir(empresa: EmpresaActa): empresa is EmpresaQueEmite {
  return empresa in PREFIJO_CONSECUTIVO;
}

/** Los cuatro items de la lista de chequeo (sección 5). Solo en entregas. */
export const CHEQUEO_ITEMS = [
  'Office 365 / Teams / Firma',
  'BitLocker',
  'Edge – Chrome',
  'Otros',
] as const;

/** Los cuatro nombres de HOY. Lo que valida la entrada, no lo que hay guardado. */
export type NombreChequeo = (typeof CHEQUEO_ITEMS)[number];

/**
 * Un item de la lista de chequeo tal y como queda **congelado en el acta**.
 *
 * `item` es `string` y no `NombreChequeo` a propósito: un acta guarda los items
 * que tenía el formato el día que se firmó. Si mañana BBL cambia la lista, las
 * actas viejas siguen conteniendo los nombres viejos y siguen teniendo que
 * poder leerse y regenerarse. La unión estrecha vale para VALIDAR lo que entra;
 * atarla también a lo que sale convertiría un acta antigua legítima en un error
 * de tipos.
 *
 * `instalado: null` es «nadie contestó», que no es «no». Los tres estados se
 * imprimen distinto: «Sí», «No» y la casilla en blanco.
 */
export interface ItemChequeo {
  item: string;
  instalado: boolean | null;
  observaciones: string | null;
}

/** Sección 6 — Declaración. Certifica cosas distintas en cada sentido. */
export const DECLARACION: Record<TipoActa, string> = {
  Entrega:
    'El departamento de TI certifica que los activos listados han sido entregados al usuario ' +
    'en condiciones operativas y físicas adecuadas, de acuerdo con el inventario registrado en ' +
    'este documento.',
  // Adaptada: certifica RECEPCIÓN, no entrega. La de entrega afirma que TI dio
  // los equipos en buen estado; usada tal cual en una devolución afirmaría lo
  // contrario de lo que ocurre.
  Devolución:
    'El departamento de TI certifica que los activos listados han sido recibidos del usuario ' +
    'en las condiciones descritas en el inventario registrado en este documento. La verificación ' +
    'técnica detallada es posterior a este documento y cualquier hallazgo se registrará por separado.',
};

export interface BloqueResponsabilidad {
  titulo: string;
  puntos: string[];
}

/**
 * Sección 7 — Responsabilidades.
 *
 * ENTREGA: las nueve del formato aprobado, literales.
 *
 * DEVOLUCIÓN: **adaptación, en borrador.** El criterio ha sido no inventar
 * cláusulas nuevas: cada una de las cuatro que quedan sale de una de las
 * nueve, y las cinco que no aparecen se han dejado fuera porque hablan de una
 * custodia que acaba de terminar. El detalle de qué se quedó, qué se adaptó y
 * qué se fue está en `docs/pendientes.md`, que es lo que BBL tiene que revisar.
 */
export const RESPONSABILIDADES: Record<
  TipoActa,
  { intro: string; bloques: BloqueResponsabilidad[] }
> = {
  Entrega: {
    intro:
      'Con respecto al uso, custodia y protección de los activos tecnológicos asignados, el ' +
      'usuario reconoce, entiende y acepta las siguientes obligaciones y condiciones:',
    bloques: [
      {
        titulo: 'Cuidado de los activos y reporte de incidentes',
        puntos: [
          'El usuario es responsable de custodiar diligentemente los activos asignados y protegerlos contra daño, deterioro, pérdida o uso indebido.',
          'Cualquier pérdida, robo, daño significativo o incidente que afecte los activos debe ser reportado de inmediato al departamento de TI y a Recursos Humanos, incluyendo la denuncia ante la autoridad competente cuando corresponda.',
          'La organización podrá realizar investigaciones internas y aplicar acciones correctivas o disciplinarias conforme a sus políticas internas.',
        ],
      },
      {
        titulo: 'Devolución de activos al finalizar la relación laboral',
        puntos: [
          'Al finalizar la relación laboral, el usuario deberá devolver todos los activos asignados y obtener el certificado de devolución emitido por el departamento de TI como parte del proceso de Offboarding.',
          'Los activos deberán ser devueltos en adecuado estado de funcionamiento y conservación, salvo el desgaste natural producto del uso.',
          'El usuario no podrá retener información, documentos ni cualquier otro material perteneciente a la organización.',
        ],
      },
      {
        titulo: 'Custodia física y transporte seguro',
        puntos: [
          'Los equipos portátiles y demás activos asignados deberán mantenerse en lugares seguros, preferiblemente bajo llave o protegidos mediante dispositivos de seguridad aprobados.',
          'Los activos no deben dejarse dentro de vehículos ni en lugares desatendidos.',
          'Durante viajes, los activos deberán permanecer bajo supervisión directa del usuario en todo momento y no deberán dejarse sin vigilancia en puntos de control de seguridad u otros puntos de tránsito.',
        ],
      },
      {
        titulo: 'Uso permitido de los activos',
        puntos: [
          'Los activos asignados deberán utilizarse exclusivamente para actividades laborales autorizadas.',
          'Se prohíbe su uso para fines personales, actividades ilícitas o acciones que contravengan las políticas de la organización.',
        ],
      },
      {
        titulo: 'Gestión de contraseñas y seguridad del equipo',
        puntos: [
          'Las contraseñas son personales e intransferibles; no deben compartirse ni almacenarse en lugares visibles.',
          'El usuario deberá bloquear su estación de trabajo cuando se ausente y apagar el equipo al finalizar la jornada laboral, salvo instrucción en contrario del departamento de TI.',
        ],
      },
      {
        titulo: 'Configuración, instalación y modificación de software y hardware',
        puntos: [
          'Las configuraciones de hardware y software son gestionadas y monitoreadas de manera remota por el departamento de TI.',
          'El usuario no podrá instalar, desinstalar, modificar ni ejecutar aplicaciones o componentes sin autorización previa y por escrito del departamento de TI.',
          'En caso de incumplimiento, la organización podrá descontar los costos, multas o sanciones derivados del incidente.',
        ],
      },
      {
        titulo: 'Confidencialidad y tratamiento de la información',
        puntos: [
          'El usuario deberá cumplir las políticas de confidencialidad, clasificación, tratamiento y protección de la información establecidas por la organización.',
          'El usuario es responsable de preservar la integridad, disponibilidad y confidencialidad de la información a la que acceda mediante los activos asignados.',
        ],
      },
      {
        titulo: 'Responsabilidad por pérdida, daño o robo',
        puntos: [
          'El usuario podrá ser responsable hasta por el 100% del valor del activo en casos de pérdida, robo o daño total atribuible a negligencia o incumplimiento.',
          'El valor a reconocer corresponderá al valor de compra registrado por la organización o al costo total de reparación emitido por un proveedor autorizado.',
          'Se podrán aplicar medidas disciplinarias o administrativas conforme a las políticas internas y la normativa vigente.',
        ],
      },
      {
        titulo: 'No devolución o inubicabilidad del activo',
        puntos: [
          'Si el usuario no devuelve los activos asignados o no puede ser localizado durante dos (2) días hábiles pese a múltiples intentos de contacto (incluyendo contactos de emergencia), la organización podrá considerar el activo como perdido o robado.',
          'La organización podrá presentar la denuncia correspondiente ante la autoridad competente y ejecutar las acciones administrativas necesarias, sin perjuicio de la responsabilidad económica del usuario.',
        ],
      },
    ],
  },

  Devolución: {
    intro:
      'Con respecto a la devolución de los activos tecnológicos que tenía asignados, el usuario ' +
      'y la organización reconocen y aceptan lo siguiente:',
    bloques: [
      {
        // Adaptada de 7.1.a. La original obliga a custodiar; aquí lo que hay
        // que decir es lo contrario: que esa obligación termina.
        titulo: 'Cese de la custodia',
        puntos: [
          'Con la entrega de los activos relacionados en este documento cesa la responsabilidad del usuario de custodiarlos y protegerlos contra daño, deterioro, pérdida o uso indebido.',
          'El cese no alcanza a los hallazgos que se documenten en la verificación técnica posterior, conforme al punto siguiente.',
        ],
      },
      {
        // De 7.2.b y 7.2.c, que son las dos del formato aprobado que hablan de
        // una devolución y no de una entrega.
        titulo: 'Estado de los activos devueltos',
        puntos: [
          'Los activos se devuelven en adecuado estado de funcionamiento y conservación, salvo el desgaste natural producto del uso.',
          'El usuario declara no retener información, documentos ni cualquier otro material perteneciente a la organización.',
        ],
      },
      {
        // 7.7, sin cambios: es la única obligación del formato aprobado que
        // sobrevive intacta a la devolución. La confidencialidad no termina
        // cuando se entrega el portátil.
        titulo: 'Confidencialidad y tratamiento de la información',
        puntos: [
          'El usuario deberá cumplir las políticas de confidencialidad, clasificación, tratamiento y protección de la información establecidas por la organización.',
          'El usuario es responsable de preservar la integridad, disponibilidad y confidencialidad de la información a la que accedió mediante los activos asignados.',
        ],
      },
      {
        // De 7.8, acotada a lo que se detecte al recibir. La original habla de
        // pérdida y robo durante la custodia; aquí la custodia ha terminado y
        // lo que queda es el daño que aparezca en la revisión.
        titulo: 'Responsabilidad por daño detectado en la recepción',
        puntos: [
          'El usuario podrá ser responsable por el daño atribuible a negligencia o incumplimiento que se detecte en la verificación técnica de los activos devueltos.',
          'El valor a reconocer corresponderá al valor de compra registrado por la organización o al costo total de reparación emitido por un proveedor autorizado.',
        ],
      },
    ],
  },
};

/** Los tres bloques de firma (sección 8). Tres, no dos. */
export const FIRMAS: Record<TipoActa, readonly string[]> = {
  Entrega: ['Persona que recibe', 'Persona que entrega', 'Responsable de IT'],
  // Los dos primeros se invierten: en una devolución quien entrega es el
  // usuario. Mantener «Persona que recibe» arriba pondría al usuario a firmar
  // como receptor de lo que acaba de devolver.
  Devolución: ['Persona que entrega', 'Persona que recibe', 'Responsable de IT'],
};

/** Pie del formato aprobado, literal. */
export const PIE_CONTROLADO =
  'Este documento está controlado y publicado electrónicamente. Cualquier copia impresa o en ' +
  'formato físico debe ser verificada contra la versión electrónica antes de su uso.';

/** El título del encabezado, en mayúsculas como en el formato. */
export const TITULO: Record<TipoActa, string> = {
  Entrega: 'ENTREGA DE ACTIVOS DE TI',
  Devolución: 'DEVOLUCIÓN DE ACTIVOS DE TI',
};
