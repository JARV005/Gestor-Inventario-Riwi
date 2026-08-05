CREATE TYPE "public"."categoria_equipo" AS ENUM('Portátil', 'Desktop', 'Monitor', 'Teclado', 'Mouse', 'Diadema', 'Celular', 'Otro');--> statement-breakpoint
CREATE TYPE "public"."condicion_equipo" AS ENUM('Nuevo', 'Excelente', 'Bueno', 'Requiere reparación');--> statement-breakpoint
CREATE TYPE "public"."estado_empleado" AS ENUM('Activo', 'Onboarding', 'Offboarding', 'Inactivo');--> statement-breakpoint
CREATE TYPE "public"."estado_equipo" AS ENUM('Disponible', 'Asignado', 'En mantenimiento', 'En tránsito', 'Reservado', 'De baja');--> statement-breakpoint
CREATE TYPE "public"."estado_mantenimiento" AS ENUM('Pendiente', 'En taller', 'Completado', 'Devuelto');--> statement-breakpoint
CREATE TYPE "public"."licencia_tipo" AS ENUM('RETAIL', 'OEM', 'Sin licencia', 'No aplica');--> statement-breakpoint
CREATE TYPE "public"."propiedad_equipo" AS ENUM('Empresa', 'Cliente', 'Empleado');--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('admin', 'tecnico');--> statement-breakpoint
CREATE TYPE "public"."tipo_acta" AS ENUM('Entrega', 'Devolución');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento" AS ENUM('Alta', 'Asignación', 'Devolución', 'Traslado', 'Envío a mantenimiento', 'Retorno de mantenimiento', 'Baja');--> statement-breakpoint
CREATE TABLE "actas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consecutivo" text NOT NULL,
	"tipo" "tipo_acta" NOT NULL,
	"empleado_id" uuid NOT NULL,
	"equipos_ids" uuid[] NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"generada_por" uuid NOT NULL,
	"pdf_path" text,
	"hash_sha256" text,
	"firmada" boolean DEFAULT false NOT NULL,
	"fecha_firma" timestamp with time zone,
	CONSTRAINT "actas_consecutivo_unique" UNIQUE("consecutivo")
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tabla" text NOT NULL,
	"registro_id" uuid NOT NULL,
	"accion" text NOT NULL,
	"usuario_app_id" uuid,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "empleados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nombre" text NOT NULL,
	"cedula" text,
	"email_corporativo" text,
	"cargo" text,
	"area" text,
	"sede_id" uuid,
	"estado" "estado_empleado" DEFAULT 'Activo' NOT NULL,
	"fecha_ingreso" date,
	"telefono" text,
	"direccion" text,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "empleados_cedula_unique" UNIQUE("cedula")
);
--> statement-breakpoint
CREATE TABLE "equipos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"categoria" "categoria_equipo" NOT NULL,
	"etiqueta" text,
	"nombre_equipo" text,
	"marca" text,
	"modelo" text,
	"serial" text,
	"serial_cargador" text,
	"propiedad" "propiedad_equipo" DEFAULT 'Empresa' NOT NULL,
	"sistema_operativo" text,
	"licencia_tipo" "licencia_tipo",
	"licencia_serial_cifrado" "bytea",
	"bios_password_cifrado" "bytea",
	"tamano_pantalla" text,
	"procesador" text,
	"disco" text,
	"ram" text,
	"estado" "estado_equipo" NOT NULL,
	"condicion" "condicion_equipo",
	"sede_id" uuid,
	"empleado_id" uuid,
	"sesion_usuario" text,
	"fecha_compra" date,
	"garantia_vence" date,
	"costo" numeric(14, 2),
	"notas" text,
	"requiere_revision" boolean DEFAULT false NOT NULL,
	"motivo_revision" text,
	CONSTRAINT "equipos_asignado_implica_empleado" CHECK ((estado = 'Asignado') = (empleado_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mantenimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"equipo_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"descripcion" text,
	"estado" "estado_mantenimiento" DEFAULT 'Pendiente' NOT NULL,
	"fecha_reporte" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_cierre" timestamp with time zone,
	"responsable" text,
	"proveedor" text,
	"costo" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "movimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"equipo_id" uuid NOT NULL,
	"tipo" "tipo_movimiento" NOT NULL,
	"empleado_origen_id" uuid,
	"empleado_destino_id" uuid,
	"sede_origen_id" uuid,
	"sede_destino_id" uuid,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_app_id" uuid NOT NULL,
	"acta_id" uuid,
	"observaciones" text,
	"fecha_confirmacion" timestamp with time zone,
	"transportadora" text,
	"guia" text,
	"fecha_estimada" date
);
--> statement-breakpoint
CREATE TABLE "sedes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nombre" text NOT NULL,
	"ciudad" text,
	"direccion" text,
	"responsable" text,
	"contacto_email" text,
	"contacto_telefono" text,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sedes_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "usuarios_app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"password_hash" text,
	"rol" "rol_usuario" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"ultimo_acceso" timestamp with time zone,
	CONSTRAINT "usuarios_app_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "actas" ADD CONSTRAINT "actas_empleado_id_empleados_id_fk" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actas" ADD CONSTRAINT "actas_generada_por_usuarios_app_id_fk" FOREIGN KEY ("generada_por") REFERENCES "public"."usuarios_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_app_id_usuarios_app_id_fk" FOREIGN KEY ("usuario_app_id") REFERENCES "public"."usuarios_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_sede_id_sedes_id_fk" FOREIGN KEY ("sede_id") REFERENCES "public"."sedes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_sede_id_sedes_id_fk" FOREIGN KEY ("sede_id") REFERENCES "public"."sedes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_empleado_id_empleados_id_fk" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_empleado_origen_id_empleados_id_fk" FOREIGN KEY ("empleado_origen_id") REFERENCES "public"."empleados"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_empleado_destino_id_empleados_id_fk" FOREIGN KEY ("empleado_destino_id") REFERENCES "public"."empleados"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_sede_origen_id_sedes_id_fk" FOREIGN KEY ("sede_origen_id") REFERENCES "public"."sedes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_sede_destino_id_sedes_id_fk" FOREIGN KEY ("sede_destino_id") REFERENCES "public"."sedes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuario_app_id_usuarios_app_id_fk" FOREIGN KEY ("usuario_app_id") REFERENCES "public"."usuarios_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_acta_id_actas_id_fk" FOREIGN KEY ("acta_id") REFERENCES "public"."actas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auditoria_registro" ON "auditoria" USING btree ("tabla","registro_id");--> statement-breakpoint
CREATE INDEX "idx_auditoria_fecha" ON "auditoria" USING btree ("fecha" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_empleados_sede" ON "empleados" USING btree ("sede_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipos_serial_uk" ON "equipos" USING btree ("serial") WHERE serial IS NOT NULL AND requiere_revision = false;--> statement-breakpoint
CREATE UNIQUE INDEX "equipos_etiqueta_uk" ON "equipos" USING btree ("etiqueta") WHERE etiqueta IS NOT NULL AND requiere_revision = false;--> statement-breakpoint
CREATE INDEX "idx_equipos_estado" ON "equipos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_equipos_sede" ON "equipos" USING btree ("sede_id");--> statement-breakpoint
CREATE INDEX "idx_equipos_empleado" ON "equipos" USING btree ("empleado_id");--> statement-breakpoint
CREATE INDEX "idx_equipos_categoria" ON "equipos" USING btree ("categoria");--> statement-breakpoint
CREATE INDEX "idx_equipos_revision" ON "equipos" USING btree ("id") WHERE requiere_revision;--> statement-breakpoint
CREATE INDEX "idx_mantenimientos_equipo" ON "mantenimientos" USING btree ("equipo_id");--> statement-breakpoint
CREATE INDEX "idx_mantenimientos_estado" ON "mantenimientos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_movimientos_equipo" ON "movimientos" USING btree ("equipo_id","fecha" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_movimientos_traslado_abierto" ON "movimientos" USING btree ("equipo_id") WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL;