/**
 * Cliente HTTP contra la API.
 *
 * La cookie de sesión es `httpOnly`, así que el navegador la manda sola —
 * siempre que se pida con `credentials: 'include'`. Ese es todo el manejo de
 * sesión que hay en el frontend: no hay token que guardar ni que refrescar, y
 * eso es exactamente lo que se buscaba al no usar JWT en `localStorage`.
 */

import type {
  ActaEmitida,
  ActaResumen,
  CatalogoTransiciones,
  DatosEmpleado,
  EstadoParteAbierto,
  Mantenimiento,
  EmpleadoConConteo,
  EquipoFirmable,
  EquipoConMotivos,
  EquipoResumen,
  MantenimientoConEquipo,
  CierreEnBloque,
  ItemChequeo,
  Licencia,
  ResumenLicencias,
  Movimiento,
  Prestatario,
  ModoActa,
  MovimientoConNombres,
  NuevoEquipo,
  Pagina,
  ResumenEquipos,
  Sede,
  SedeConConteos,
  TipoActa,
  TrasladoAbierto,
  UsuarioSesion,
} from '../types';

/** Serializa filtros a query string, saltándose los vacíos. */
function consulta(f: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Error con el estado HTTP a la vista, para que la interfaz pueda distinguir. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }

  /** 401: no hay sesión, o dejó de valer mientras la pestaña estaba abierta. */
  get esSesionCaducada() {
    return this.estado === 401;
  }

  /** 0: no hubo respuesta. Servidor caído o red cortada. */
  get esSinConexion() {
    return this.estado === 0;
  }

  /**
   * 5xx: el servidor contestó, pero no pudo. Es lo que llega cuando Postgres
   * está apagado — comprobado apagando el contenedor con la app abierta.
   * Se distingue del resto porque reintentar sí tiene sentido.
   */
  get esFalloDelServidor() {
    return this.estado >= 500;
  }
}

async function pedir<T>(camino: string, opciones: RequestInit = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(camino, {
      ...opciones,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...opciones.headers },
    });
  } catch {
    // `fetch` solo rechaza cuando no hubo respuesta. Un 500 no llega aquí.
    throw new ErrorApi(0, 'No se pudo contactar con el servidor.');
  }

  if (!respuesta.ok) {
    let mensaje = `Error ${respuesta.status}`;
    try {
      const cuerpo = (await respuesta.json()) as { error?: string };
      if (cuerpo.error) mensaje = cuerpo.error;
    } catch {
      // Un error sin cuerpo JSON. El estado ya dice lo suficiente.
    }
    throw new ErrorApi(respuesta.status, mensaje);
  }

  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

export interface ConteoMotivo {
  codigo: string;
  equipos: number;
}

export interface FiltrosEquipos {
  estado?: string;
  categoria?: string;
  sede?: string;
  /** Incluye lo que esa empresa tiene PRESTADO, no solo lo suyo (D31). */
  empresa?: string;
  q?: string;
  motivo?: string;
  pagina?: number;
  porPagina?: number;
}

export const api = {
  yo: () => pedir<{ usuario: UsuarioSesion }>('/api/auth/me'),

  entrar: (email: string, password: string) =>
    pedir<{ usuario: UsuarioSesion }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  salir: () => pedir<void>('/api/auth/logout', { method: 'POST' }),

  sedes: () => pedir<{ sedes: Sede[] }>('/api/sedes'),

  sedesConConteos: () =>
    pedir<{ sedes: SedeConConteos[]; equipos_sin_sede: number }>('/api/sedes?conteos=1'),

  /** La bandeja: además del listado, cuántos equipos tiene cada motivo. */
  revision: (f: FiltrosEquipos = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    }
    const cadena = p.toString();
    return pedir<
      Pagina<EquipoConMotivos> & {
        conteos: ConteoMotivo[];
        conteos_empresa: Record<string, number>;
      }
    >(
      `/api/equipos/revision${cadena ? `?${cadena}` : ''}`,
    );
  },

  equipos: (f: FiltrosEquipos = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    }
    const cadena = p.toString();
    return pedir<Pagina<EquipoConMotivos> & { conteos_empresa: Record<string, number> }>(
      `/api/equipos${cadena ? `?${cadena}` : ''}`,
    );
  },

  /** Cerrar un motivo de la bandeja. Con el último, la marca baja sola. */
  cerrarMotivo: (equipoId: string, codigo: string) =>
    pedir<{ equipo: EquipoConMotivos }>(`/api/equipos/${equipoId}/motivos/${codigo}`, {
      method: 'DELETE',
    }),

  /** Quién tiene en la mano un equipo prestado. Solo si está Prestado. */
  fijarTenedor: (equipoId: string, empleado_id: string | null) =>
    pedir<{ equipo: EquipoConMotivos }>(`/api/equipos/${equipoId}/tenedor`, {
      method: 'POST',
      body: JSON.stringify({ empleado_id }),
    }),

  equipo: (id: string) => pedir<{ equipo: EquipoConMotivos }>(`/api/equipos/${id}`),

  /**
   * Editar la FICHA. `estado`, `empleado_id` y `sede_id` los rechaza el
   * servidor con 409 (D19): esos salen de una operación, no de un formulario.
   */
  actualizarEquipo: (id: string, cambios: Partial<Omit<NuevoEquipo, 'estado'>>) =>
    pedir<{ equipo: EquipoConMotivos }>(`/api/equipos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios),
    }),

  /** Los agregados del dashboard, contados en Postgres y no aquí. */
  resumenEquipos: () => pedir<ResumenEquipos>('/api/equipos/resumen'),

  /**
   * Alta de un equipo. El servidor escribe la fila y su movimiento `Alta` en
   * la misma transacción; aquí solo se manda lo que el formulario recogió.
   */
  crearEquipo: (datos: NuevoEquipo) =>
    pedir<{ equipo: EquipoConMotivos }>('/api/equipos', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  /**
   * El listado trae además `conteos_empresa`, con las tres claves siempre —
   * incluida «Sin clasificar» en cero si no queda ninguna. Es lo que hace que
   * las 113 sin revisar se vean sin ir a buscarlas (D28).
   */
  empleados: (
    f: {
      q?: string;
      sede?: string;
      empresa?: string;
      activo?: boolean;
      pagina?: number;
      porPagina?: number;
    } = {},
  ) =>
    pedir<Pagina<EmpleadoConConteo> & { conteos_empresa: Record<string, number> }>(
      `/api/empleados${consulta(f)}`,
    ),

  crearEmpleado: (datos: DatosEmpleado) =>
    pedir<{ empleado: EmpleadoConConteo }>('/api/empleados', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  /** Las licencias, con su resumen. La key NO viene aquí (D43). */
  licencias: (f: Record<string, string | number | boolean | undefined> = {}) =>
    pedir<{
      filas: Licencia[];
      total: number;
      pagina: number;
      porPagina: number;
      resumen: ResumenLicencias;
    }>(`/api/licencias${consulta(f)}`),

  /**
   * La key en claro. **Admin, de una en una, y queda registrada.**
   *
   * Se pide explícitamente y nunca viene con el listado: es la misma regla que
   * `bios_password`. Cada llamada escribe su fila en `auditoria` antes de
   * responder.
   */
  keyLicencia: (id: string) => pedir<{ key: string | null }>(`/api/licencias/${id}/key`),

  /** Activar la licencia en un equipo, o soltarla con `equipo_id: null`. */
  activarLicencia: (id: string, equipo_id: string | null) =>
    pedir<{ licencia: Licencia }>(`/api/licencias/${id}/activar`, {
      method: 'POST',
      body: JSON.stringify({ equipo_id }),
    }),

  /** Cierra la marca de revisión de una licencia, con su constancia. */
  licenciaRevisada: (id: string, nota: string | null) =>
    pedir<{ licencia: Licencia }>(`/api/licencias/${id}/revisada`, {
      method: 'POST',
      body: JSON.stringify({ nota }),
    }),

  /**
   * Cierra un motivo en todo su bloque. Devuelve cuántas entraron y, con
   * nombre, las que no.
   */
  cerrarMotivoEnBloque: (motivo: string, nota: string | null) =>
    pedir<CierreEnBloque>('/api/equipos/revision/cerrar-en-bloque', {
      method: 'POST',
      body: JSON.stringify({ motivo, nota }),
    }),

  actualizarEmpleado: (id: string, cambios: Partial<DatosEmpleado>) =>
    pedir<{ empleado: EmpleadoConConteo }>(`/api/empleados/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios),
    }),

  /**
   * Abrir un parte manda el equipo al taller: las dos cosas en una sola
   * transacción del lado del servidor (D29).
   */
  abrirParte: (datos: {
    equipo_id: string;
    tipo: string;
    descripcion?: string | null;
    responsable?: string | null;
    proveedor?: string | null;
  }) =>
    pedir<{ parte: Mantenimiento }>('/api/mantenimientos', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  actualizarParte: (
    id: string,
    cambios: { estado?: EstadoParteAbierto; descripcion?: string | null; proveedor?: string | null; costo?: string | null },
  ) =>
    pedir<{ parte: Mantenimiento }>(`/api/mantenimientos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios),
    }),

  /** Cerrar es un gesto: cierra el parte y saca el equipo del taller. */
  cerrarParte: (id: string, desenlace: 'retorno' | 'baja') =>
    pedir<{ parte: Mantenimiento }>(`/api/mantenimientos/${id}/cerrar`, {
      method: 'POST',
      body: JSON.stringify({ desenlace }),
    }),

  equiposDe: (id: string) =>
    pedir<{ equipos: EquipoResumen[] }>(`/api/empleados/${id}/equipos`),

  mantenimientos: (f: { equipo?: string; estado?: string; porPagina?: number } = {}) =>
    pedir<Pagina<MantenimientoConEquipo>>(`/api/mantenimientos${consulta(f)}`),

  /**
   * Las mutaciones de estado. Cada una escribe `equipos`, `movimientos` y
   * `auditoria` en una sola transacción; qué transición es legal lo decide el
   * servidor (`db/transiciones.ts`) y lo explica en el 409.
   */
  asignar: (equipoId: string, empleadoId: string) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/asignar`,
      { method: 'POST', body: JSON.stringify({ empleado_id: empleadoId }) },
    ),

  devolver: (equipoId: string, observaciones?: string | null) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/devolver`,
      { method: 'POST', body: JSON.stringify({ observaciones: observaciones ?? null }) },
    ),

  trasladar: (
    equipoId: string,
    sedeDestinoId: string,
    extra: { transportadora?: string | null; guia?: string | null; fecha_estimada?: string | null } = {},
  ) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/trasladar`,
      {
        method: 'POST',
        body: JSON.stringify({
          sede_destino_id: sedeDestinoId,
          transportadora: extra.transportadora ?? null,
          guia: extra.guia ?? null,
          fecha_estimada: extra.fecha_estimada ?? null,
        }),
      },
    ),

  /**
   * Las que no necesitan más datos que el equipo. Una sola función porque la
   * diferencia entre ellas está en el servidor, no aquí: si esta capa supiera
   * qué hace cada una, sería otra copia de la tabla de transiciones.
   */
  /**
   * Reasignar es `devolver` + `asignar`: dos movimientos en una transacción.
   * La composición la decide la tabla del servidor, no esta llamada.
   */
  reasignar: (equipoId: string, empleado_id: string, observaciones?: string | null) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/reasignar`,
      { method: 'POST', body: JSON.stringify({ empleado_id, observaciones }) },
    ),

  /** Prestar exige a quién. El servidor responde 400 si falta (D32). */
  prestar: (equipoId: string, prestado_a: Prestatario) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/prestar`,
      { method: 'POST', body: JSON.stringify({ prestado_a }) },
    ),

  operacionSimple: (
    equipoId: string,
    operacion: 'reservar' | 'liberar' | 'baja' | 'recuperar_prestamo',
  ) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/${operacion}`,
      { method: 'POST', body: '{}' },
    ),

  /** La tabla de transiciones. Se pide una vez y vale para todos los equipos. */
  transiciones: () => pedir<CatalogoTransiciones>('/api/transiciones'),

  /** Historial con nombres resueltos, y el traslado abierto si lo hay. */
  historial: (equipoId: string) =>
    pedir<{ movimientos: MovimientoConNombres[]; traslado_abierto: TrasladoAbierto | null }>(
      `/api/equipos/${equipoId}/historial`,
    ),

  /**
   * Emitir un acta sobre operaciones **que ya ocurrieron**. El servidor busca
   * el movimiento que documenta cada equipo y responde 409 si no existe.
   */
  emitirActa: (datos: {
    tipo: TipoActa;
    /** Siempre explícito desde la pantalla: el servidor asume `firmar` si falta. */
    modo: ModoActa;
    empleado_id: string;
    equipos: string[];
    observaciones?: string | null;
    /**
     * La sección 5 (D41). Los cuatro items van SIEMPRE en las entregas, con
     * `instalado: null` en lo que nadie contestó: el PDF pinta las cuatro
     * filas y la instantánea tiene que decir lo mismo que el documento.
     */
    chequeo?: ItemChequeo[] | null;
  }) =>
    pedir<{ acta: ActaEmitida }>('/api/actas', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  /** Los equipos con una operación de esa persona pendiente de firmar. */
  actasFirmables: (empleado: string, tipo: TipoActa) =>
    pedir<{ equipos: EquipoFirmable[] }>(
      `/api/actas/firmables${consulta({ empleado, tipo })}`,
    ),

  acta: (id: string) => pedir<{ acta: ActaEmitida }>(`/api/actas/${id}`),

  actas: (f: { empleado?: string } = {}) =>
    pedir<{ actas: ActaResumen[] }>(`/api/actas${consulta(f)}`),

  /** Desactivar a alguien. 409 si tiene equipos a su nombre. */
  desactivarEmpleado: (id: string) =>
    pedir<{ empleado: EmpleadoConConteo }>(`/api/empleados/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false }),
    }),

  /** Los traslados en curso. La otra cara del badge del sidebar. */
  trasladosAbiertos: () => pedir<{ traslados: TrasladoAbierto[] }>('/api/traslados'),

  /**
   * Confirmar la llegada. El servidor cierra el movimiento y mueve el equipo a
   * la sede destino en la misma transacción; aquí solo se manda el id.
   */
  confirmarTraslado: (movimientoId: string) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/movimientos/${movimientoId}/confirmar`,
      { method: 'POST', body: '{}' },
    ),
};
