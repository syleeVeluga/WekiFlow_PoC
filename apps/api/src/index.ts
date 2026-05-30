import { buildServer } from './server.js';

const app = buildServer();
const port = Number(process.env.PORT ?? 4000);

await app.listen({ port, host: '0.0.0.0' });
console.log(`WekiFlow API listening on http://localhost:${port}`);
