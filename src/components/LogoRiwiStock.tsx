import React from 'react';

/**
 * La marca de la APLICACIÓN. Etapa 5g.
 *
 * ============================================================================
 * ESTE LOGO NO ENTRA EN NINGÚN ACTA.
 * ============================================================================
 *
 * El logo de un acta es el de la empresa que la emite —RIWI o BBL Labs— y se
 * lee de `assets/logos/` en el servidor (D39). Sus bytes forman parte del hash
 * del PDF, así que colar aquí cualquier cosa que acabe en el documento haría
 * que `recalcularHash` acusara de manipuladas a las actas ya firmadas.
 *
 * Por eso esto es un componente de React y no un fichero en `assets/`: vive del
 * lado del navegador y no hay ningún camino por el que llegue a pdfkit.
 *
 * Sustituye al cuadro «FP» del prototipo, que eran las iniciales de FirstPlug.
 *
 * ---------------------------------------------------------------------------
 * Por qué este dibujo
 *
 * Un bloque partido en diagonal con la R calada. Los dos colores son los de la
 * paleta y no otros: `nav` (#1D1C4A) y `brand` (#5B4FE0), que son también los
 * dos con los que RIWI construye su marca.
 *
 * Se eligió por cómo aguanta el tamaño pequeño, que es donde vive un logo de
 * aplicación interna: 32 px en la barra lateral y 16 px en la pestaña del
 * navegador. No tiene ningún detalle que se pierda al encogerse — las variantes
 * que se descartaron dependían de corchetes finos y de una barra de dos tramos,
 * y las dos cosas se empastan a 16 px.
 */

interface LogoRiwiStockProps {
  /** Lado del cuadrado en píxeles. 32 en la barra lateral, 28 en la cabecera. */
  tamano?: number;
  /**
   * Sobre qué fondo se va a pintar.
   *
   * `claro` es el bloque en sus colores, para la cabecera blanca. `nav` lo
   * aclara, porque sobre el azul oscuro de la barra lateral el bloque en `nav`
   * desaparecería contra su propio fondo — el logo quedaría como una R suelta.
   */
  sobre?: 'claro' | 'nav';
  className?: string;
}

export const LogoRiwiStock: React.FC<LogoRiwiStockProps> = ({
  tamano = 32,
  sobre = 'claro',
  className = '',
}) => {
  const enNav = sobre === 'nav';
  // Dos identificadores distintos por variante: dos `clipPath` con el mismo id
  // en la misma página hacen que el segundo se recorte con la forma del
  // primero, y el logo de la cabecera se llevaría el de la barra lateral.
  const idRecorte = enNav ? 'logo-riwistock-nav' : 'logo-riwistock-claro';

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="RiwiStock"
    >
      <defs>
        <clipPath id={idRecorte}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${idRecorte})`}>
        <rect width="64" height="64" fill={enNav ? '#5B4FE0' : '#1D1C4A'} />
        <path d="M64 0v64H16z" fill={enNav ? '#7C71F0' : '#5B4FE0'} />
      </g>
      {/* La R, calada en blanco. `evenodd` abre el hueco del ojo sin necesidad
          de una segunda forma del color del fondo, que se vería como un parche
          en cuanto el bloque cambie de color. */}
      <path
        fillRule="evenodd"
        fill="#FFFFFF"
        d="M19 15h13a8 8 0 0 1 0 16h-1.8l7 18h-6.4l-6.3-17v17H19zm5 4.6v7h7a3.5 3.5 0 0 0 0-7z"
      />
    </svg>
  );
};
