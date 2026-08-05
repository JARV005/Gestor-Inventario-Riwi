/**
 * Importador del Excel. `npm run import -- [ruta.xlsx]`
 *
 * Toda la carga ocurre en una transacción: o entra el inventario entero o no
 * entra nada. Medio inventario dentro es peor que ninguno, porque no se sabe
 * dónde se cortó.
 *
 * El entregable es el reporte de rechazos, no la carga. Un importador que mete
 * las 187 filas sin marcar ninguna está mal, no bien: los datos de origen
 * tienen huecos conocidos y esconderlos es perderlos.
 *
 * `BIOS PASSWORD` y `SERIAL WINDOWS` se leen y se cifran (§5). No se imprimen,
 * no se registran y no salen en el reporte, nunca.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';

import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';

import { cifrar } from './cifrado.js';
import { db, pool } from './cliente.js';
import { empleados, equipos, movimientos, sedes, usuariosApp } from './esquema.js';
import { MOTIVOS, type CodigoMotivo } from './motivos.js';

const RUTA_POR_DEFECTO = 'data/origen/inventario_muestra_johan.xlsx';
const RUTA_REPORTE = 'data/origen/reporte-rechazos.csv';
const HOJA_EQUIPOS = 'INVENTARIO EQUIPOS BBL';
const HOJA_PERIFERICOS = 'INVENTARIO PERIFERICOS BBL';
const EMAIL_SISTEMA = 'sistema@bbl.local';

// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------

/** minúsculas, sin tildes, espacios colapsados. La llave de matching. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Marcadores que el Excel usa para decir "aquí no hay dato". El §3 manda
 * convertirlos a NULL. `No tiene` sale de la columna ETIQUETA, donde aparece
 * 9 veces.
 */
const MARCADORES = new Set([
  'n/a',
  'na',
  'no aplica',
  'no tiene',
  'ninguno',
  'sin asignar',
  '-',
  '--',
  '.',
]);

const esMarcador = (s: string) => MARCADORES.has(norm(s));

/** Texto de la celda, o null si está vacía o es un marcador de ausencia. */
function limpio(s: string): string | null {
  const t = s.trim();
  if (!t || esMarcador(t)) return null;
  return t;
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if ('text' in o) return texto(o.text); // Hyperlink: 73 correos en SESION DE USUARIO
  if ('result' in o) return texto(o.result); // Formula
  if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('').trim();
  return String(v);
}

// ---------------------------------------------------------------------------
// Lectura de hojas
// ---------------------------------------------------------------------------

type Fila = { numero: number; celda: (columna: string) => string };

function leerHoja(hoja: ExcelJS.Worksheet): Fila[] {
  const cabecera: string[] = [];
  for (let c = 1; c <= hoja.columnCount; c++) {
    cabecera.push(texto(hoja.getRow(1).getCell(c).value));
  }
  const filas: Fila[] = [];
  for (let r = 2; r <= hoja.rowCount; r++) {
    const valores = new Map<string, string>();
    let algo = false;
    for (let c = 1; c <= hoja.columnCount; c++) {
      const t = texto(hoja.getRow(r).getCell(c).value);
      if (t) algo = true;
      valores.set(cabecera[c - 1], t);
    }
    if (algo) filas.push({ numero: r, celda: (col) => valores.get(col) ?? '' });
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Candidatas
// ---------------------------------------------------------------------------

type EstadoEquipo = 'Disponible' | 'Asignado' | 'En mantenimiento' | 'En tránsito' | 'Reservado' | 'De baja';
type Categoria = 'Portátil' | 'Desktop' | 'Monitor' | 'Teclado' | 'Mouse' | 'Diadema' | 'Celular' | 'Otro';
type Condicion = 'Nuevo' | 'Excelente' | 'Bueno' | 'Usado' | 'Requiere reparación';
type Licencia = 'RETAIL' | 'OEM' | 'Sin licencia' | 'No aplica';

interface Candidata {
  hoja: string;
  fila: number;
  motivos: CodigoMotivo[];
  rechazada: boolean;
  /**
   * Persona real nombrada en la fila, exista o no el vínculo. Null solo si la
   * celda venía vacía o traía un marcador.
   *
   * Va separado de `responsable` a propósito: una persona mencionada en el
   * Excel existe aunque su equipo no se le pueda asignar. Si solo se crearan
   * los empleados vinculables, tres personas del archivo no tendrían fila en
   * la BD y su único rastro sería `equipos.notas`, que es texto libre que
   * nadie consulta: quien resolviera esas filas tendría que reescribir el
   * nombre a mano y confiar en no equivocarse.
   */
  persona: string | null;
  /** Solo cuando el vínculo se puede crear, es decir con estado 'Asignado'. */
  responsable: string | null;
  cedula: string | null;
  ubicacionOriginal: string;
  sedeNombre: string | null;
  datos: {
    categoria: Categoria;
    etiqueta: string | null;
    nombre_equipo: string | null;
    marca: string | null;
    modelo: string | null;
    serial: string | null;
    serial_cargador: string | null;
    propiedad: 'Empresa' | 'Cliente' | 'Empleado';
    sistema_operativo: string | null;
    licencia_tipo: Licencia | null;
    licencia_serial_cifrado: Buffer | null;
    bios_password_cifrado: Buffer | null;
    tamano_pantalla: string | null;
    procesador: string | null;
    disco: string | null;
    ram: string | null;
    estado: EstadoEquipo;
    condicion: Condicion | null;
    sesion_usuario: string | null;
    notas: string | null;
  };
}

/** Marca/modelo según las normalizaciones del §3. */
function normalizarMarca(marca: string | null, modelo: string | null) {
  if (!marca) return { marca: null, modelo };
  if (norm(marca) === 'macbook air') {
    return { marca: 'Apple', modelo: modelo ?? 'MacBook Air' };
  }
  if (norm(marca) === 'asus tuf') {
    const m = modelo ?? '';
    return { marca: 'ASUS', modelo: norm(m).startsWith('tuf') ? m : `TUF ${m}`.trim() };
  }
  return { marca, modelo };
}

function mapearEstado(bruto: string): { estado: EstadoEquipo; motivo: CodigoMotivo | null } {
  const n = norm(bruto);
  if (n.includes('revision')) return { estado: 'Disponible', motivo: 'ESTADO_REVISION' };
  if (n === 'asignado') return { estado: 'Asignado', motivo: null };
  if (n === 'disponible') return { estado: 'Disponible', motivo: null };
  if (n === 'de baja') return { estado: 'De baja', motivo: null };
  if (n === 'no asignar') return { estado: 'Reservado', motivo: null };
  return { estado: 'Disponible', motivo: 'ESTADO_NO_APLICA' };
}

function mapearLicencia(bruto: string): { licencia: Licencia | null; motivo: CodigoMotivo | null } {
  const n = norm(bruto);
  if (!n) return { licencia: null, motivo: null };
  // "OK" no es un tipo de licencia. 37 filas. Entra NULL y marcada.
  if (n === 'ok') return { licencia: null, motivo: 'LICENCIA_OK' };
  if (n === 'retail') return { licencia: 'RETAIL', motivo: null };
  if (n === 'oem') return { licencia: 'OEM', motivo: null };
  if (n === 'sin licencia') return { licencia: 'Sin licencia', motivo: null };
  // Aquí "N/A" no se convierte a NULL como en el resto de campos: el enum tiene
  // el miembro 'No aplica' justamente para esto, y colapsarlo a NULL borraría
  // la diferencia entre "no lleva licencia Windows" y "nadie lo rellenó".
  if (n === 'n/a' || n === 'no aplica') return { licencia: 'No aplica', motivo: null };
  return { licencia: null, motivo: null };
}

function candidataDeEquipo(f: Fila, serialesRepetidos: Set<string>): Candidata {
  const motivos: CodigoMotivo[] = [];
  const anota = (m: CodigoMotivo | null) => {
    if (m && !motivos.includes(m)) motivos.push(m);
  };

  const tipoBruto = f.celda('TIPO EQUIPO');
  const esCliente = norm(tipoBruto) === 'pc del cliente';
  const tipoAusente = esMarcador(tipoBruto) || !tipoBruto;

  const { estado: estadoMapeado, motivo: motivoEstado } = mapearEstado(f.celda('ESTADO DEL EQUIPO'));
  anota(motivoEstado);
  if (tipoAusente) anota('SIN_TIPO');

  // Decisión (a): una fila sin tipo NI estado no describe ningún equipo.
  // Importarla crearía un activo fantasma que nadie podría cerrar.
  const rechazada = tipoAusente && motivoEstado === 'ESTADO_NO_APLICA';

  const marcaBruta = limpio(f.celda('MARCA'));
  const { marca, modelo } = normalizarMarca(marcaBruta, limpio(f.celda('MODELO')));
  // Decisión (b): en un PC del cliente, la ausencia de marca/serial/etiqueta es
  // esperable — la máquina no es de la empresa. `propiedad = 'Cliente'` ya lo
  // explica; marcarlo serían 5 falsos positivos permanentes en la bandeja.
  if (!marca && !esCliente) anota('SIN_MARCA');

  const serial = limpio(f.celda('SERIAL EQUIPO'));
  if (!serial && !esCliente) anota('SIN_SERIAL');
  if (serial && serialesRepetidos.has(serial)) anota('SERIAL_DUPLICADO');

  const etiqueta = limpio(f.celda('ETIQUETA'));
  if (!etiqueta && !esCliente) anota('SIN_ETIQUETA');

  const ubicacionOriginal = f.celda('UBICACIÓN');
  const ubicacion = limpio(ubicacionOriginal);
  if (!ubicacion) anota('SIN_UBICACION');

  const { licencia, motivo: motivoLicencia } = mapearLicencia(f.celda('TIPO DE LICENCIA'));
  anota(motivoLicencia);

  // ------------------------------------------------------------ responsable
  const respBruto = f.celda('USUARIO RESPONSABLE');
  let persona: string | null = null;
  let responsable: string | null = null;
  let estado = estadoMapeado;
  const notas: string[] = [];

  if (!respBruto) {
    if (estado === 'Asignado') {
      // Violar el invariante no es una opción: entra como Disponible y marcada.
      estado = 'Disponible';
      anota('ASIGNADO_SIN_RESPONSABLE');
    }
  } else if (esMarcador(respBruto) || norm(respBruto) === 'disponible') {
    anota('RESPONSABLE_NO_PERSONA');
    notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}"`);
    if (estado === 'Asignado') estado = 'Disponible';
  } else if (estado !== 'Asignado') {
    // El CHECK prohíbe un responsable sobre un equipo que no está Asignado.
    // El vínculo no se crea, pero la persona sí: existe en el Excel y por
    // tanto existe. La nota registra el conflicto de estado, que es lo que
    // hay que resolver, no el nombre.
    anota('RESPONSABLE_EN_ESTADO_NO_ASIGNADO');
    notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}" (estado "${f.celda('ESTADO DEL EQUIPO')}")`);
    persona = respBruto;
  } else {
    persona = respBruto;
    responsable = respBruto;
  }

  return {
    hoja: HOJA_EQUIPOS,
    fila: f.numero,
    motivos,
    rechazada,
    persona,
    responsable,
    cedula: null,
    ubicacionOriginal,
    sedeNombre: ubicacion,
    datos: {
      categoria: 'Portátil',
      etiqueta,
      nombre_equipo: limpio(f.celda('NOMBRE EQUIPO')),
      marca,
      modelo,
      serial,
      serial_cargador: limpio(f.celda('SERIAL ADAPTADOR DE CARGA')),
      propiedad: esCliente ? 'Cliente' : 'Empresa',
      sistema_operativo: limpio(f.celda('SISTEMA OPERATIVO')),
      licencia_tipo: licencia,
      // Los dos campos del §5. A partir de aquí solo existen cifrados.
      licencia_serial_cifrado: cifrar(limpio(f.celda('SERIAL WINDOWS'))),
      bios_password_cifrado: cifrar(limpio(f.celda('BIOS PASSWORD'))),
      tamano_pantalla: limpio(f.celda('TAMAÑO')),
      procesador: limpio(f.celda('PROCESADOR')),
      disco: limpio(f.celda('DISCO')),
      ram: limpio(f.celda('RAM')),
      estado,
      condicion: null,
      sesion_usuario: limpio(f.celda('SESION DE USUARIO')),
      notas: notas.length ? notas.join(' | ') : null,
      // GARANTIA VENC. no se importa: está vacía en 126 de 126. Una columna que
      // nadie llenó nunca no es deuda de datos, es un campo sin uso.
    },
  };
}

const CATEGORIA_PERIFERICO: Record<string, Categoria> = {
  diademas: 'Diadema',
  diadema: 'Diadema',
  mouse: 'Mouse',
  teclado: 'Teclado',
  teclados: 'Teclado',
};

function candidataDePeriferico(f: Fila, serialesRepetidos: Set<string>): Candidata {
  const motivos: CodigoMotivo[] = [];
  const anota = (m: CodigoMotivo | null) => {
    if (m && !motivos.includes(m)) motivos.push(m);
  };

  const tipo = norm(f.celda('TIPO DE PERIFERICO'));
  const categoria = CATEGORIA_PERIFERICO[tipo] ?? 'Otro';
  if (categoria === 'Otro') anota('SIN_TIPO');

  const serial = limpio(f.celda('SERIAL EQUIPO'));
  if (!serial) anota('SIN_SERIAL');
  if (serial && serialesRepetidos.has(serial)) anota('SERIAL_REPETIDO_PERIFERICO');

  const ubicacionOriginal = f.celda('UBICACIÓN');
  const ubicacion = limpio(ubicacionOriginal);
  if (!ubicacion) anota('SIN_UBICACION');

  const condicionBruta = norm(f.celda('ESTADO DEL EQUIPO'));
  const condicion: Condicion | null =
    condicionBruta === 'nuevo' ? 'Nuevo' : condicionBruta === 'usado' ? 'Usado' : null;

  let estado: EstadoEquipo = norm(f.celda('DISPONIBILIDAD')) === 'asignado' ? 'Asignado' : 'Disponible';
  const respBruto = f.celda('USUARIO RESPONSABLE');
  let persona: string | null = null;
  let responsable: string | null = null;
  const notas: string[] = [];

  if (!respBruto) {
    if (estado === 'Asignado') {
      estado = 'Disponible';
      anota('ASIGNADO_SIN_RESPONSABLE');
    }
  } else if (esMarcador(respBruto) || norm(respBruto) === 'disponible') {
    anota('RESPONSABLE_NO_PERSONA');
    notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}"`);
    if (estado === 'Asignado') estado = 'Disponible';
  } else if (estado !== 'Asignado') {
    anota('RESPONSABLE_EN_ESTADO_NO_ASIGNADO');
    notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}"`);
    persona = respBruto;
  } else {
    persona = respBruto;
    responsable = respBruto;
  }

  return {
    hoja: HOJA_PERIFERICOS,
    fila: f.numero,
    motivos,
    rechazada: false,
    persona,
    responsable,
    cedula: limpio(f.celda('CEDULA USUARIO')),
    ubicacionOriginal,
    sedeNombre: ubicacion,
    datos: {
      categoria,
      // La hoja de periféricos no tiene columna de etiqueta. Su ausencia no es
      // un hueco de datos, así que no se marca.
      etiqueta: null,
      nombre_equipo: null,
      marca: limpio(f.celda('MARCA')),
      modelo: limpio(f.celda('MODELO')),
      serial,
      serial_cargador: null,
      propiedad: 'Empresa',
      sistema_operativo: null,
      licencia_tipo: null,
      licencia_serial_cifrado: null,
      bios_password_cifrado: null,
      tamano_pantalla: null,
      procesador: null,
      disco: null,
      ram: null,
      estado,
      condicion,
      sesion_usuario: null,
      notas: notas.length ? notas.join(' | ') : null,
    },
  };
}

/** Seriales que aparecen más de una vez dentro de una misma hoja. */
function repetidos(filas: Fila[], columna: string): Set<string> {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    const s = limpio(f.celda(columna));
    if (s) cuenta.set(s, (cuenta.get(s) ?? 0) + 1);
  }
  return new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([s]) => s));
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function campoCsv(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escribirReporte(candidatas: Candidata[]) {
  const conMotivo = candidatas.filter((c) => c.motivos.length > 0);

  // Agrupado por motivo y no por fila: la bandeja se ataca por bloques.
  // Una fila con 3 motivos aparece 3 veces, una por bloque.
  const porMotivo = new Map<CodigoMotivo, Candidata[]>();
  for (const c of conMotivo) {
    for (const m of c.motivos) {
      if (!porMotivo.has(m)) porMotivo.set(m, []);
      porMotivo.get(m)!.push(c);
    }
  }
  const ordenados = [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length);

  const lineas: string[] = [];
  lineas.push(
    [
      'motivo',
      'filas_con_este_motivo',
      'descripcion',
      'recomendacion',
      'resultado',
      'hoja',
      'fila_excel',
      'etiqueta',
      'serial',
      'ubicacion_origen',
      'otros_motivos_de_la_misma_fila',
    ].join(','),
  );

  for (const [motivo, filas] of ordenados) {
    for (const c of filas.sort((a, b) => a.fila - b.fila)) {
      lineas.push(
        [
          motivo,
          filas.length,
          MOTIVOS[motivo].descripcion,
          MOTIVOS[motivo].recomendacion,
          c.rechazada ? 'RECHAZADA' : 'IMPORTADA_CON_MARCA',
          c.hoja,
          c.fila,
          c.datos.etiqueta,
          c.datos.serial,
          c.ubicacionOriginal,
          c.motivos.filter((m) => m !== motivo).join(' '),
        ]
          .map(campoCsv)
          .join(','),
      );
    }
  }

  writeFileSync(RUTA_REPORTE, '﻿' + lineas.join('\r\n') + '\r\n', 'utf8');
  return { conMotivo: conMotivo.length, bloques: ordenados };
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function main() {
  const ruta = process.argv[2] ?? RUTA_POR_DEFECTO;

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(equipos);
  if (n > 0) {
    throw new Error(
      `La tabla equipos ya tiene ${n} filas. El importador no fusiona ni deduplica ` +
        `contra lo que ya está dentro: hay 15 filas sin etiqueta y 9 sin serial, ` +
        `así que no existe una llave natural fiable para reconciliarlas.\n` +
        `Para reimportar en limpio:\n` +
        `  npm run db:reset && npm run migrate && npm run seed && npm run import`,
    );
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);

  const filasEq = leerHoja(wb.getWorksheet(HOJA_EQUIPOS)!);
  const filasPe = leerHoja(wb.getWorksheet(HOJA_PERIFERICOS)!);

  const dupEq = repetidos(filasEq, 'SERIAL EQUIPO');
  const dupPe = repetidos(filasPe, 'SERIAL EQUIPO');

  const candidatas = [
    ...filasEq.map((f) => candidataDeEquipo(f, dupEq)),
    ...filasPe.map((f) => candidataDePeriferico(f, dupPe)),
  ];

  const aImportar = candidatas.filter((c) => !c.rechazada);

  // ------------------------------------------------------------- transacción
  let resumen = { equipos: 0, empleados: 0, movimientos: 0 };
  let empleadosSinEquipo: string[] = [];

  await db.transaction(async (tx) => {
    const sedesBd = await tx.select({ id: sedes.id, nombre: sedes.nombre }).from(sedes);
    const sedePorNombre = new Map(sedesBd.map((s) => [norm(s.nombre), s.id]));

    const [sistema] = await tx
      .select({ id: usuariosApp.id })
      .from(usuariosApp)
      .where(sql`${usuariosApp.email} = ${EMAIL_SISTEMA}`);
    if (!sistema) {
      throw new Error(`Falta el usuario ${EMAIL_SISTEMA}. Correr npm run seed antes.`);
    }

    // --- empleados: llave = nombre normalizado (regla 1). Sin fusión por
    //     similitud (regla 2): 0 colisiones y 0 pares con tokens compartidos en
    //     este archivo, y fusionar dos personas distintas no se detecta después.
    const porNombre = new Map<
      string,
      { nombre: string; cedula: string | null; sede_id: string | null }
    >();
    // Se recorren TODAS las candidatas, no solo las importables, y se usa
    // `persona` y no `responsable`: una persona nombrada en el archivo existe
    // aunque su equipo no se le pueda vincular, o aunque la fila entera se
    // rechace. Así el recuento de empleados cuadra con el del Excel, que es
    // mucho más auditable que "110 y otros tres en un campo de texto".
    for (const c of candidatas) {
      if (!c.persona) continue;
      const k = norm(c.persona);
      const sede = c.sedeNombre ? (sedePorNombre.get(norm(c.sedeNombre)) ?? null) : null;
      const previo = porNombre.get(k);
      if (!previo) {
        porNombre.set(k, { nombre: c.persona, cedula: c.cedula, sede_id: sede });
      } else {
        // La cédula se guarda cuando existe (regla 4) pero no decide el vínculo.
        if (!previo.cedula && c.cedula) previo.cedula = c.cedula;
        if (!previo.sede_id && sede) previo.sede_id = sede;
      }
    }

    const empleadoPorNombre = new Map<string, string>();
    if (porNombre.size > 0) {
      const insertados = await tx
        .insert(empleados)
        .values([...porNombre.values()])
        .returning({ id: empleados.id, nombre: empleados.nombre });
      for (const e of insertados) empleadoPorNombre.set(norm(e.nombre), e.id);
    }
    resumen.empleados = empleadoPorNombre.size;

    // Los que entran sin equipo a su nombre. No es un error: la tabla no exige
    // que una persona tenga equipos. Se listan porque son exactamente las
    // filas que alguien tiene que resolver.
    const vinculados = new Set(
      aImportar.filter((c) => c.responsable).map((c) => norm(c.responsable!)),
    );
    empleadosSinEquipo = [...porNombre.values()]
      .filter((e) => !vinculados.has(norm(e.nombre)))
      .map((e) => e.nombre);

    // --- equipos
    const valores = aImportar.map((c) => {
      const sede_id = c.sedeNombre ? (sedePorNombre.get(norm(c.sedeNombre)) ?? null) : null;
      // Una ubicación escrita pero que no corresponde a ninguna sede no se
      // adivina (regla 3 de CLAUDE.md): queda NULL y marcada.
      if (c.sedeNombre && !sede_id && !c.motivos.includes('UBICACION_FUERA_DE_SEDES')) {
        c.motivos.push('UBICACION_FUERA_DE_SEDES');
      }
      const empleado_id = c.responsable ? (empleadoPorNombre.get(norm(c.responsable)) ?? null) : null;
      return {
        ...c.datos,
        sede_id,
        empleado_id,
        requiere_revision: c.motivos.length > 0,
        motivos_revision: c.motivos as string[],
      };
    });

    const insertados = await tx
      .insert(equipos)
      .values(valores)
      .returning({ id: equipos.id, sede_id: equipos.sede_id, empleado_id: equipos.empleado_id });
    resumen.equipos = insertados.length;

    // --- movimientos: un Alta por equipo, atribuido al usuario de sistema (D4)
    await tx.insert(movimientos).values(
      insertados.map((e) => ({
        equipo_id: e.id,
        tipo: 'Alta' as const,
        sede_destino_id: e.sede_id,
        empleado_destino_id: e.empleado_id,
        usuario_app_id: sistema.id,
        observaciones: `Importación inicial desde ${ruta}`,
      })),
    );
    resumen.movimientos = insertados.length;
  });

  // ---------------------------------------------------------------- reporte
  const { conMotivo, bloques } = escribirReporte(candidatas);

  const rechazadas = candidatas.filter((c) => c.rechazada);
  console.log(`\nArchivo: ${ruta}`);
  console.log(`Filas leídas:        ${candidatas.length}`);
  console.log(`  equipos:           ${candidatas.filter((c) => c.hoja === HOJA_EQUIPOS).length}`);
  console.log(`  periféricos:       ${candidatas.filter((c) => c.hoja === HOJA_PERIFERICOS).length}`);
  console.log(`\nImportadas:          ${resumen.equipos}`);
  console.log(`  limpias:           ${resumen.equipos - (conMotivo - rechazadas.length)}`);
  console.log(`  con marca:         ${conMotivo - rechazadas.length}`);
  console.log(`Rechazadas:          ${rechazadas.length}`);
  for (const r of rechazadas) console.log(`  ${r.hoja} fila ${r.fila}: ${r.motivos.join(', ')}`);
  console.log(`\nEmpleados creados:   ${resumen.empleados}`);
  console.log(`  sin equipo:        ${empleadosSinEquipo.length}`);
  for (const e of empleadosSinEquipo) console.log(`     ${e}`);
  console.log(`Movimientos 'Alta':  ${resumen.movimientos}`);
  console.log(`\nMotivos (${bloques.reduce((a, [, f]) => a + f.length, 0)} en total):`);
  for (const [m, filas] of bloques) console.log(`  ${String(filas.length).padStart(3)}  ${m}`);
  console.log(`\nReporte: ${RUTA_REPORTE}`);
}

main()
  .catch((error) => {
    console.error('\nLa importación falló. La BD queda como estaba: nada se escribió a medias.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
