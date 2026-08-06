/**
 * Arranca solo la API, sin Vite. `npm run api`
 *
 * Sirve para probarla con curl o Postman contra la base de desarrollo. El
 * servidor de desarrollo completo —API más frontend— es `npm run dev`.
 */

import 'dotenv/config';

import { crearApp } from './app.js';

const puerto = Number(process.env.PORT ?? 3001);

crearApp().listen(puerto, () => {
  console.log(`API en http://localhost:${puerto}`);
  console.log(`Base: ${new URL(process.env.DATABASE_URL!).pathname.slice(1)}`);
});
