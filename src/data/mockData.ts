/**
 * Datos de relleno TEMPORALES para las vistas que aún no están conectadas.
 *
 * **Este fichero se borra en la etapa 4b.** No añadir nada aquí: lo que haga
 * falta se pide a la API.
 *
 * Bajó de 20 KB a esto a propósito. Antes traía 26 equipos y 12 empleados
 * inventados para que el prototipo pareciera lleno; los datos reales son ahora
 * 186 equipos en Postgres, y mantener a mano un segundo inventario falso en el
 * formato nuevo no compra nada. Queda lo justo para que las vistas sin conectar
 * pinten algo mientras les llega el turno.
 */

import type { Empleado, Equipo, Mantenimiento, Sede } from '../types';

const AHORA = '2026-08-01T10:00:00.000Z';

const SEDE_MEDELLIN = '11111111-1111-4111-8111-111111111111';
const SEDE_BARRANQUILLA = '22222222-2222-4222-8222-222222222222';

const EMP_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const EMP_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const EMP_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

export const SEDES_DEMO: Sede[] = [
  {
    id: SEDE_MEDELLIN,
    nombre: 'Medellín',
    ciudad: 'Medellín',
    direccion: null,
    responsable: null,
    contacto_email: null,
    contacto_telefono: null,
    activa: true,
    created_at: AHORA,
    updated_at: AHORA,
  },
  {
    id: SEDE_BARRANQUILLA,
    nombre: 'Barranquilla',
    ciudad: 'Barranquilla',
    direccion: null,
    responsable: null,
    contacto_email: null,
    contacto_telefono: null,
    activa: true,
    created_at: AHORA,
    updated_at: AHORA,
  },
];

function empleado(id: string, nombre: string, cargo: string, sede: string): Empleado {
  return {
    id,
    nombre,
    cedula: null,
    email_corporativo: null,
    cargo,
    area: 'Tecnología',
    sede_id: sede,
    estado: 'Activo',
    fecha_ingreso: null,
    telefono: null,
    direccion: null,
    activo: true,
    created_at: AHORA,
    updated_at: AHORA,
  };
}

export const EMPLEADOS_DEMO: Empleado[] = [
  empleado(EMP_1, 'Ana Restrepo', 'Desarrolladora', SEDE_MEDELLIN),
  empleado(EMP_2, 'Carlos Mejía', 'Analista de datos', SEDE_MEDELLIN),
  empleado(EMP_3, 'Luisa Fernández', 'Diseñadora', SEDE_BARRANQUILLA),
];

function equipo(parcial: Partial<Equipo> & Pick<Equipo, 'id' | 'categoria' | 'estado'>): Equipo {
  return {
    etiqueta: null,
    nombre_equipo: null,
    marca: null,
    modelo: null,
    serial: null,
    serial_cargador: null,
    propiedad: 'Empresa',
    sistema_operativo: null,
    licencia_tipo: null,
    tamano_pantalla: null,
    procesador: null,
    disco: null,
    ram: null,
    condicion: null,
    sede_id: null,
    empleado_id: null,
    empleado_mencionado_id: null,
    importacion_id: null,
    sesion_usuario: null,
    fecha_compra: null,
    garantia_vence: null,
    costo: null,
    notas: null,
    requiere_revision: false,
    created_at: AHORA,
    updated_at: AHORA,
    ...parcial,
  };
}

export const EQUIPOS_DEMO: Equipo[] = [
  equipo({
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    categoria: 'Portátil',
    estado: 'Asignado',
    etiqueta: 'BBL-0001',
    marca: 'Dell',
    modelo: 'Latitude 5420',
    serial: 'DEMO-8M79494',
    procesador: 'Intel i7-1165G7',
    ram: '16 GB',
    disco: '512GB SSD',
    sistema_operativo: 'Windows 11 Pro',
    licencia_tipo: 'OEM',
    sede_id: SEDE_MEDELLIN,
    empleado_id: EMP_1,
  }),
  equipo({
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    categoria: 'Portátil',
    estado: 'Disponible',
    etiqueta: 'BBL-0002',
    marca: 'Lenovo',
    modelo: 'ThinkPad T14',
    serial: 'DEMO-CQ6JDW3',
    ram: '16 GB',
    sede_id: SEDE_MEDELLIN,
  }),
  equipo({
    id: 'bbbbbbbb-0000-4000-8000-000000000003',
    categoria: 'Portátil',
    estado: 'En mantenimiento',
    etiqueta: 'BBL-0003',
    marca: 'Apple',
    modelo: 'MacBook Air',
    serial: 'DEMO-FNJ5D9TC7F',
    sede_id: SEDE_BARRANQUILLA,
  }),
  equipo({
    id: 'bbbbbbbb-0000-4000-8000-000000000004',
    categoria: 'Diadema',
    estado: 'Asignado',
    marca: 'Logitech',
    modelo: 'H390',
    serial: 'DEMO-JNZMR0117',
    condicion: 'Usado',
    sede_id: SEDE_MEDELLIN,
    empleado_id: EMP_2,
  }),
  equipo({
    id: 'bbbbbbbb-0000-4000-8000-000000000005',
    categoria: 'Portátil',
    estado: 'Disponible',
    requiere_revision: true,
    notas: 'Fila de ejemplo con datos incompletos',
    sede_id: SEDE_BARRANQUILLA,
  }),
];

export const MANTENIMIENTOS_DEMO: Mantenimiento[] = [
  {
    id: 'cccccccc-0000-4000-8000-000000000001',
    equipo_id: 'bbbbbbbb-0000-4000-8000-000000000003',
    tipo: 'Cambio de batería',
    descripcion: 'La batería no retiene carga más de 40 minutos.',
    estado: 'En taller',
    fecha_reporte: AHORA,
    fecha_cierre: null,
    responsable: 'Soporte TI',
    proveedor: 'Servicio Apple Medellín',
    costo: null,
    created_at: AHORA,
    updated_at: AHORA,
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000002',
    equipo_id: 'bbbbbbbb-0000-4000-8000-000000000001',
    tipo: 'Reinstalación de sistema',
    descripcion: 'Equipo lento tras actualización.',
    estado: 'Completado',
    fecha_reporte: AHORA,
    fecha_cierre: AHORA,
    responsable: 'Soporte TI',
    proveedor: null,
    costo: null,
    created_at: AHORA,
    updated_at: AHORA,
  },
];
