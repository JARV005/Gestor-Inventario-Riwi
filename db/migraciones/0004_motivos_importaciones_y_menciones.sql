-- Etapa 2, segunda ronda de esquema. Todo aditivo; la 0005 retira lo viejo.
--
-- 1. `motivos_revision`: catalogo de codigos. Tabla y no CHECK con lista
--    literal porque los codigos crecen —la etapa 2 ya anadio uno no previsto—
--    y con CHECK cada uno costaria una migracion.
-- 2. `equipos_motivos_revision`: puente con PK compuesta. Un text[] no tiene
--    integridad referencial: 'SIN_SERAIL' con la errata entraba sin protestar.
--    La PK compuesta ademas hace imposible el duplicado interno.
-- 3. `importaciones`: la reconciliacion 187 = 186 + 1 la observa el importador
--    y se evapora al terminar. Sin esta tabla nadie puede responder dentro de
--    tres meses cuantas filas tenia el archivo sin reabrir el Excel. El
--    hash_sha256 delata que se reimporto una version distinta con el mismo
--    nombre. Su aritmetica si cabe en una fila, asi que va como CHECK.
-- 4. `equipos.empleado_mencionado_id`: "esta fila menciona a esta persona pero
--    no le esta asignada". Sustituye a dejar el nombre suelto en notas.
-- 5. `equipos.importacion_id`: de que corrida vino cada fila.
CREATE TABLE "equipos_motivos_revision" (
	"equipo_id" uuid NOT NULL,
	"motivo_codigo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipos_motivos_revision_equipo_id_motivo_codigo_pk" PRIMARY KEY("equipo_id","motivo_codigo")
);
--> statement-breakpoint
CREATE TABLE "importaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archivo" text NOT NULL,
	"hash_sha256" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_app_id" uuid NOT NULL,
	"filas_leidas" integer NOT NULL,
	"filas_insertadas" integer NOT NULL,
	"filas_rechazadas" integer NOT NULL,
	"filas_marcadas" integer NOT NULL,
	CONSTRAINT "importaciones_cuadran" CHECK (filas_leidas = filas_insertadas + filas_rechazadas),
	CONSTRAINT "importaciones_marcadas_caben" CHECK (filas_marcadas <= filas_insertadas)
);
--> statement-breakpoint
CREATE TABLE "motivos_revision" (
	"codigo" text PRIMARY KEY NOT NULL,
	"descripcion" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "empleado_mencionado_id" uuid;--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "importacion_id" uuid;--> statement-breakpoint
ALTER TABLE "equipos_motivos_revision" ADD CONSTRAINT "equipos_motivos_revision_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipos_motivos_revision" ADD CONSTRAINT "equipos_motivos_revision_motivo_codigo_motivos_revision_codigo_fk" FOREIGN KEY ("motivo_codigo") REFERENCES "public"."motivos_revision"("codigo") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importaciones" ADD CONSTRAINT "importaciones_usuario_app_id_usuarios_app_id_fk" FOREIGN KEY ("usuario_app_id") REFERENCES "public"."usuarios_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_motivos_por_codigo" ON "equipos_motivos_revision" USING btree ("motivo_codigo");--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_empleado_mencionado_id_empleados_id_fk" FOREIGN KEY ("empleado_mencionado_id") REFERENCES "public"."empleados"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_importacion_id_importaciones_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones"("id") ON DELETE restrict ON UPDATE no action;