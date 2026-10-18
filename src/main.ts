import { loadConfig } from './config.js';
import { createApp } from './server.js';
import { Simulation } from './simulation.js';
import { createLiveModels } from './models/live.js';
import { createStubModels } from './models/stub.js';
import type { ModelServices } from './models/live.js';

const config = loadConfig();
let models: ModelServices;
if (config.stub) models = await createStubModels();
else {
  const live = createLiveModels(config);
  await live.ready();
  models = live;
}
const simulation = new Simulation(config, models);
const server = createApp(simulation).listen(config.port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    console.log(`${config.stub ? 'Recorded offline' : 'Live Foundry'} demo: http://127.0.0.1:${address.port}`);
  }
});
server.on('close', () => simulation.dispose());
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`HTTP server failed: ${error.code ?? 'unknown error'}.`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    simulation.dispose();
    server.close();
    server.closeAllConnections();
  });
}
