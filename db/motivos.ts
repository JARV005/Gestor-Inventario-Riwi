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

  // -------------------------------------------------------------------------
  // Etapa 5e: los dos archivos, y lo que aparece al cruzarlos
  // -------------------------------------------------------------------------

  PROPIEDAD_AMBIGUA: {
    descripcion:
      'El serial está en los dos archivos y ninguno lleva marca de préstamo. El hostname sugiere de quién es, pero un hostname no es un título de propiedad',
    recomendacion: 'Confirmar de qué empresa es el equipo y corregir «empresa»',
  },
  RESPONSABLE_EN_CONFLICTO: {
    descripcion:
      'Los dos archivos nombran a personas DISTINTAS como responsable del mismo serial. No se eligió ninguna',
    recomendacion: 'Averiguar quién lo tiene de verdad y asignárselo. Los dos nombres están en notas',
  },
  PRESTATARIO_DESCONOCIDO: {
    descripcion: 'El equipo consta como prestado y el archivo no dice a quién',
    recomendacion: 'Averiguar a qué empresa se prestó, o recuperarlo si ya volvió',
  },
  LICENCIA_NO_ES_LICENCIA: {
    descripcion: 'TIPO DE LICENCIA traía algo que no es un tipo de licencia (una marca de préstamo, un tamaño de pantalla)',
    recomendacion: 'Clasificar la licencia real del equipo, o dejarla en «No aplica»',
  },
  MARCADOR_EN_CAMPO_TECNICO: {
    descripcion:
      'El bloque técnico (SO, tamaño, procesador, disco, RAM) traía un marcador repetido en vez de datos. Entró vacío en vez de con la cadena',
    recomendacion: 'Completar las características desde el equipo físico',
  },
  SECRETO_NO_ES_SECRETO: {
    descripcion:
      'Una columna cifrada traía un marcador («OK», «Licenciado», «N/A») en vez de una clave. NO se cifró: un marcador cifrado es invisible y nadie lo encontraría',
    recomendacion: 'Recuperar la clave real del equipo, o confirmar que no tiene',
  },
  CLAVE_WINDOWS_MALFORMADA: {
    descripcion:
      'SERIAL WINDOWS tiene forma de clave pero con los grupos mal: parece una errata de transcripción, no un marcador. Se cifró tal cual para no perderla',
    recomendacion: 'Comparar con la clave real del equipo y corregir la errata',
  },
  COLUMNAS_DESPLAZADAS: {
    descripcion:
      'La fila trae los valores corridos de columna a partir de TIPO DE LICENCIA. No se recolocaron: adivinar el orden sería inventar',
    recomendacion: 'Rellenar licencia, tamaño, procesador, disco y RAM desde el equipo',
  },
  BLOQUE_DUPLICADO: {
    descripcion:
      'La hoja repite un bloque entero de filas ya listadas antes. Se importó una sola vez, la copia más completa',
    recomendacion: 'Confirmar que es una copia y limpiar el Excel de origen',
  },
  COPIAS_QUE_NO_CONCUERDAN: {
    descripcion: 'Las dos copias de la misma fila dicen cosas distintas (estado, responsable o ubicación)',
    recomendacion: 'Decidir cuál de las dos copias es la buena',
  },
  NOMBRE_EN_DOS_EMPRESAS: {
    descripcion:
      'El mismo nombre aparece en los dos archivos. NO se fusionó: puede ser una persona en las dos empresas o dos personas distintas',
    recomendacion: 'Confirmar si es la misma persona. Si lo es, unificar las dos fichas a mano',
  },
  ETIQUETA_DUPLICADA: {
    descripcion: 'La etiqueta está pegada a dos equipos distintos',
    recomendacion: 'Ver cuál de los dos la lleva de verdad y reetiquetar el otro',
  },
  CEDULA_COMPARTIDA: {
    descripcion:
      'Dos personas con nombres distintos traen la MISMA cédula. Se guardó sin cédula en las dos: elegir una sería decidir quién es quién',
    recomendacion: 'Averiguar de quién es la cédula y ponérsela a mano a la persona correcta',
  },
  SESION_NO_CONCUERDA: {
    descripcion: 'La sesión de usuario del equipo no corresponde a su responsable',
    recomendacion: 'Confirmar quién usa el equipo: puede ser un cambio de responsable sin registrar',
  },
} as const;

export type CodigoMotivo = keyof typeof MOTIVOS;

export const CODIGOS = Object.keys(MOTIVOS) as CodigoMotivo[];
