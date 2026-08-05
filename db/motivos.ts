/**
 * Códigos de `equipos.motivos_revision`. Fijos y enumerados, nunca frases.
 *
 * El motivo de que sean códigos y no texto libre: la bandeja de limpieza se
 * trabaja por bloques. "Los 37 de licencia" es una tarde de trabajo; 60 filas
 * con explicaciones redactadas a mano no se agrupan y no se terminan nunca.
 *
 * Añadir un código aquí obliga a decidir su descripción y su recomendación, que
 * son las dos columnas que la persona que limpia va a leer.
 */

export const MOTIVOS = {
  LICENCIA_OK: {
    descripcion: 'TIPO DE LICENCIA venía como "OK", que no es un tipo de licencia',
    recomendacion: 'Clasificar como RETAIL, OEM, Sin licencia o No aplica',
  },
  SIN_SERIAL: {
    descripcion: 'Sin serial utilizable: la celda estaba vacía o contenía un marcador',
    recomendacion: 'Localizar el equipo y leer el serial de la etiqueta física',
  },
  SERIAL_DUPLICADO: {
    descripcion: 'El serial se repite en otra fila de la hoja de equipos',
    recomendacion: 'Verificar cuál de los dos equipos tiene el serial mal transcrito',
  },
  SERIAL_REPETIDO_PERIFERICO: {
    descripcion: 'El serial se repite entre periféricos; probablemente sea un modelo, no un serial',
    recomendacion: 'Confirmar si es referencia de modelo. No intentar distinguir las unidades',
  },
  SIN_ETIQUETA: {
    descripcion: 'Sin etiqueta utilizable: vacía o con un marcador como "No tiene"',
    recomendacion: 'Asignar etiqueta BBL-XXXX y pegarla en el equipo',
  },
  SIN_MARCA: {
    descripcion: 'Marca ausente o marcada como no aplicable',
    recomendacion: 'Completar marca y modelo desde el equipo físico',
  },
  SIN_UBICACION: {
    descripcion: 'UBICACIÓN vacía',
    recomendacion: 'Determinar en qué sede está el equipo',
  },
  UBICACION_FUERA_DE_SEDES: {
    descripcion: 'La ubicación no corresponde a ninguna sede registrada',
    recomendacion: 'Decidir si se crea la sede o si el valor se mapea a una existente',
  },
  ESTADO_REVISION: {
    descripcion: 'El estado de origen indicaba revisión pendiente',
    recomendacion: 'Revisar el equipo y fijar su estado real',
  },
  ESTADO_NO_APLICA: {
    descripcion: 'ESTADO DEL EQUIPO era un marcador, no un estado',
    recomendacion: 'Determinar si la fila corresponde a un equipo real',
  },
  SIN_TIPO: {
    descripcion: 'TIPO EQUIPO era un marcador, no un tipo',
    recomendacion: 'Determinar si la fila corresponde a un equipo real',
  },
  ASIGNADO_SIN_RESPONSABLE: {
    descripcion: 'Estado "Asignado" sin responsable. Importado como Disponible para no violar el invariante',
    recomendacion: 'Averiguar quién lo tiene, o confirmar que está disponible',
  },
  RESPONSABLE_NO_PERSONA: {
    descripcion: 'USUARIO RESPONSABLE contenía un marcador en vez de un nombre',
    recomendacion: 'Averiguar quién es el responsable real',
  },
  RESPONSABLE_EN_ESTADO_NO_ASIGNADO: {
    descripcion:
      'La fila traía responsable pero un estado que no es "Asignado". El vínculo no se creó; el nombre quedó en notas',
    recomendacion: 'Decidir qué es cierto: el estado o el responsable',
  },
} as const;

export type CodigoMotivo = keyof typeof MOTIVOS;

export const CODIGOS = Object.keys(MOTIVOS) as CodigoMotivo[];
