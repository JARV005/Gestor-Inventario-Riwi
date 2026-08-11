-- Etapa 5b — el PDF, y de qué plantilla salió.
--
-- `hash_sha256` verifica que los bytes guardados son los que se guardaron. Eso
-- detecta corrupción y manipulación del binario, y es la mitad fácil.
--
-- La otra mitad —**recalcular** el hash desde los datos, que es lo que D16
-- pedía— necesita saber con qué plantilla se generó. Un acta es reproducible
-- byte a byte solo frente a la plantilla que la produjo: en cuanto alguien
-- corrija una cláusula, las actas nuevas cambian de bytes y las viejas no, y
-- sin esta columna no habría forma de saber cuál de las dos redacciones
-- regenera cada una.
--
-- Es el mismo argumento de la instantánea (D23) aplicado al documento en vez de
-- a los datos: lo que se firmó no cambia porque cambie lo que se firmaría hoy.

ALTER TABLE "actas" ADD COLUMN "plantilla_version" text;--> statement-breakpoint

COMMENT ON COLUMN "actas"."plantilla_version" IS
  'Versión de la plantilla que generó el PDF. Sin ella, el hash solo verifica '
  'los bytes guardados; con ella se puede regenerar el documento y comprobar que '
  'da el mismo hash. Ver decisiones-04 D26.';--> statement-breakpoint

-- Las tres van juntas. El CHECK de la 0008 emparejaba `pdf` y `hash_sha256`;
-- ahora la plantilla entra en el mismo grupo, porque un PDF cuya plantilla no
-- se sabe es un PDF que no se puede volver a comprobar.
ALTER TABLE "actas" DROP CONSTRAINT "actas_pdf_con_hash";--> statement-breakpoint

ALTER TABLE "actas" ADD CONSTRAINT "actas_pdf_con_hash"
  CHECK (
    ("pdf" IS NULL) = ("hash_sha256" IS NULL)
    AND ("pdf" IS NULL) = ("plantilla_version" IS NULL)
  );
