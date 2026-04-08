import { DEFAULT_BROWSER_PORT } from './config.js';
import { startStaticServer } from './http-server.js';

const port = Number(process.env.PORT ?? DEFAULT_BROWSER_PORT);
const server = await startStaticServer(port);
console.log(`wasml-llama bench server: ${server.origin}/`);
console.log('Press Ctrl+C to stop.');

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
