/**
 * Códigos de `equipos.motivos_revision`. Fijos y enumerados, nunca frases.
 *
 * El motivo de que sean códigos y no texto libre: la bandeja de limpieza se
 * trabaja por bloques. "Los 37 de licencia" es una tarde de trabajo; 60 filas
 * con explicaciones redactadas a mano no se agrupan y no se terminan nunca.
 *
 * Añadir un código aquí obliga a decidir su descripción y su recomendación, que
 * son las dos columnas que la persona que limpia va a leer.
 *
 * ---
 *
 * `resuelto_por`: QUÉ OPERACIÓN HACE DESAPARECER EL MOTIVO
 *
 * Va como campo de la tabla y no como un `if` en `mutar`, por lo mismo que
 * `disparo` y `compuesta` en `transiciones.ts`: de aquí salen a la vez el
 * retiro del motivo, la fila de auditoría que lo cuenta y el caso del
 * verificador que lo sostiene. Escrito como un caso especial en el repositorio,
 * la tabla diría una cosa y el código haría otra.
 *
 * El motivo por el que existe: asignar un equipo ponía el responsable y dejaba
 * `ASIGNADO_SIN_RESPONSABLE` puesto. El equipo 0468 quedó `Asignado` con
 * responsable y con la marca de que no tenía ninguno, y `verificar-datos.sql`
 * salía en rojo por una fila que la propia aplicación había estropeado. No fue
 * un descuido de un `if`: no había ningún sitio donde esto estuviera escrito.
 *
 * **«Resuelve» no es «rompe el invariante».** Son cosas distintas y confundirlas
 * es el error fácil aquí:
 *
 *   - `asignar` RESUELVE `ASIGNADO_SIN_RESPONSABLE`: la pregunta del motivo es
 *     «¿quién lo tiene?» y asignarlo la contesta.
 *   - `reservar` rompe su invariante —el equipo deja de estar Disponible— y no
 *     resuelve nada: sigue sin saberse quién lo tenía. NO va en esta tabla; de
 *     eso se ocupa el alcance del caso en `verificar-datos.sql`.
 *
 * Cada entrada de aquí abajo se justifica con la `recomendacion` del propio
 * motivo, que es lo que dice qué hay que hacer para cerrarlo.
 */

/**
 * Las operaciones que pueden retirar un motivo.
 *
 * Se escriben como literales y no se importa `Operacion` de `transiciones.ts`
 * a propósito: no todas las operaciones que resuelven un motivo son
 * transiciones de estado. `MOTIVOS_QUE_RESUELVE` se comprueba contra el
 * catálogo de transiciones en un test, que es donde la desincronización se ve
 * sin acoplar los dos ficheros.
 */
export type OperacionResolutoria =
  | 'asignar'
  | 'reasignar'
  | 'recuperar_prestamo'
  | 'retornar_mantenimiento';

export interface EntradaMotivo {
  descripcion: string;
  recomendacion: string;
  /** Operaciones que hacen desaparecer este motivo. Ver la cabecera. */
  resuelto_por?: readonly OperacionResolutoria[];
  /**
   * El motivo AFIRMA que no se sabe quién es el responsable del equipo.
   *
   * De aquí sale la columna `motivos_revision.implica_sin_responsable`, y de
   * ella el trigger de la 0018 que impide la fila del 0468: un equipo con
   * responsable no puede llevar un motivo que diga que no se sabe quién lo
   * tiene. Las dos cosas no pueden ser verdad a la vez.
   *
   * Va como campo aparte de `resuelto_por` aunque hoy sean los mismos cuatro
   * códigos. No es lo mismo: uno dice qué operación cierra el motivo, el otro
   * qué afirma el motivo mientras está abierto. Derivar el segundo del primero
   * —«los que resuelve asignar»— ataría el invariante de la base a un argumento
   * que hay que reconstruir cada vez que se lea.
   */
  implica_sin_responsable?: true;
}

export const MOTIVOS = {
  /**
   * Etapa 8 (D43). La licencia dice estar activada en un equipo que no está en
   * los archivos que se importaron.
   *
   * Doce de las treinta apuntan a `BAQ-000xx`, que son de Barranquilla. NO es
   * un fallo del importador: el equipo llegará con los ficheros de esa sede, y
   * la referencia se conserva para poder reconciliarlas entonces.
   */
  EQUIPO_NO_ENCONTRADO: {
    descripcion: 'La licencia apunta a un equipo que no está en los archivos importados',
    recomendacion:
      'Esperar a los archivos de la sede que lo tiene, o activarla contra el equipo correcto',
  },
  /**
   * Etapa 8 (D45). Dos máquinas con el mismo nombre de red.
   *
   * Lo pidió el propio Excel: su columna `CONTROL DE CALIDAD` marca «Nombre
   * duplicado» y nosotros no lo comprobábamos. Dos equipos con el mismo nombre
   * colisionan en el dominio y en las licencias.
   */
  NOMBRE_EQUIPO_DUPLICADO: {
    descripcion: 'El nombre de red del equipo se repite en otra fila',
    recomendacion: 'Renombrar uno de los dos: dos máquinas no pueden llamarse igual en la red',
  },
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
    // «Revisar el equipo y fijar su estado real». Un viaje a mantenimiento y de
    // vuelta es exactamente eso, y deja el equipo Disponible, que es lo que su
    // invariante pide.
    resuelto_por: ['retornar_mantenimiento'],
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
    // «Averiguar quién lo tiene»: asignarlo es contestarlo. La otra mitad de la
    // recomendación —«confirmar que está disponible»— no es una operación, se
    // cierra a mano desde la bandeja.
    resuelto_por: ['asignar', 'reasignar'],
    implica_sin_responsable: true,
  },
  RESPONSABLE_NO_PERSONA: {
    descripcion: 'USUARIO RESPONSABLE contenía un marcador en vez de un nombre',
    recomendacion: 'Averiguar quién es el responsable real',
    // «Averiguar quién es el responsable real». Al asignar, la FK apunta a una
    // persona de verdad y el marcador deja de ser lo que hay.
    resuelto_por: ['asignar', 'reasignar'],
    implica_sin_responsable: true,
  },
  RESPONSABLE_EN_ESTADO_NO_ASIGNADO: {
    descripcion:
      'La fila traía responsable pero un estado que no es "Asignado". El vínculo no se creó; el nombre quedó en notas',
    recomendacion: 'Decidir qué es cierto: el estado o el responsable',
    // «Decidir qué es cierto: el estado o el responsable». Asignar decide: era
    // cierto el responsable.
    resuelto_por: ['asignar', 'reasignar'],
    implica_sin_responsable: true,
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
    // Su recomendación lo dice literal: «Averiguar quién lo tiene de verdad y
    // asignárselo».
    resuelto_por: ['asignar', 'reasignar'],
    implica_sin_responsable: true,
  },
  PRESTATARIO_DESCONOCIDO: {
    descripcion: 'El equipo consta como prestado y el archivo no dice a quién',
    recomendacion: 'Averiguar a qué empresa se prestó, o recuperarlo si ya volvió',
    // «o recuperarlo si ya volvió»: con el préstamo cerrado, a qué empresa se
    // prestó deja de ser una pregunta abierta.
    //
    // NO lleva `fijar_tenedor`, que era el mapeo que parecía obvio: esa
    // operación fija la PERSONA que lo tiene, y este motivo pregunta por la
    // EMPRESA a la que se prestó. Habría retirado el motivo sin contestarlo.
    resuelto_por: ['recuperar_prestamo'],
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
} as const satisfies Record<string, EntradaMotivo>;

export type CodigoMotivo = keyof typeof MOTIVOS;

export const CODIGOS = Object.keys(MOTIVOS) as CodigoMotivo[];

/**
 * El índice al revés: operación → motivos que retira.
 *
 * Se **deriva** de `MOTIVOS`, no se escribe aparte. Escrito a mano sería una
 * segunda tabla que se desincroniza en silencio, que es el mismo fallo que tuvo
 * `Operacion` copiado a mano en `src/types.ts`: el servidor pasó a ocho
 * operaciones, el cliente se quedó en seis y `tsc` siguió en verde.
 *
 * `mutar` consulta esto; la fuente sigue siendo la tabla de arriba, donde el
 * mapeo está al lado de la descripción que lo justifica.
 */
export const MOTIVOS_QUE_RESUELVE: Readonly<Record<OperacionResolutoria, readonly CodigoMotivo[]>> =
  (() => {
    // La tabla se lee por una vista tipada: con `as const`, las entradas que no
    // llevan `resuelto_por` no tienen la propiedad en su tipo, y la unión de las
    // treinta no la expone. `satisfies` ya garantiza que la forma es correcta,
    // así que esto no afloja nada.
    const tabla: Readonly<Record<CodigoMotivo, EntradaMotivo>> = MOTIVOS;
    const indice: Partial<Record<OperacionResolutoria, CodigoMotivo[]>> = {};
    for (const codigo of CODIGOS) {
      for (const operacion of tabla[codigo].resuelto_por ?? []) {
        (indice[operacion] ??= []).push(codigo);
      }
    }
    return indice as Record<OperacionResolutoria, readonly CodigoMotivo[]>;
  })();

/**
 * Los motivos que afirman no saber quién tiene el equipo.
 *
 * Se deriva igual que `MOTIVOS_QUE_RESUELVE`, y por lo mismo: la siembra lo lee
 * de aquí, así que la columna de la base y la tabla de arriba no pueden decir
 * cosas distintas.
 */
export const MOTIVOS_SIN_RESPONSABLE: readonly CodigoMotivo[] = (() => {
  const tabla: Readonly<Record<CodigoMotivo, EntradaMotivo>> = MOTIVOS;
  return CODIGOS.filter((c) => tabla[c].implica_sin_responsable === true);
})();
