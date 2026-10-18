import express from 'express';
import { fileURLToPath } from 'node:url';
import type { Simulation } from './simulation.js';

export function createApp(simulation: Simulation): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', backend: simulation.snapshot().backend });
  });
  app.get('/api/state', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json(simulation.snapshot());
  });
  app.get('/api/events', (_request, response) => {
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });
    response.flushHeaders();
    const send = (snapshot: ReturnType<Simulation['snapshot']>) => {
      if (response.destroyed || response.writableEnded) return;
      if (!response.write(`data: ${JSON.stringify(snapshot)}\n\n`)) response.destroy();
    };
    send(simulation.snapshot());
    const unsubscribe = simulation.subscribe(send);
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) response.destroy();
    }, 15_000);
    response.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.post('/api/control', (request, response) => {
    const body: unknown = request.body;
    if (!body || typeof body !== 'object' || !('command' in body)) {
      response.status(400).json({ error: 'A control command is required.' });
      return;
    }
    const origin = request.get('origin');
    if (origin && origin !== `http://${request.get('host')}`) {
      response.status(403).json({ error: 'Cross-origin control requests are not allowed.' });
      return;
    }
    const { command } = body;
    if (command === 'start') {
      if (simulation.snapshot().world.outcome !== 'running') {
        response.status(409).json({ error: 'Reset before starting a completed run.' });
        return;
      }
      simulation.start();
    }
    else if (command === 'reset') simulation.reset();
    else if (command === 'speed' && 'value' in body && typeof body.value === 'number') {
      if (!Number.isFinite(body.value) || body.value < 50 || body.value > 130) {
        response.status(400).json({ error: 'Speed must be between 50 and 130 km/h.' });
        return;
      }
      simulation.setSpeed(body.value);
    } else if (
      command === 'hazard' && 'value' in body &&
      (body.value === 'elk' || body.value === 'small_animal' || body.value === 'ambiguous')
    ) {
      const snapshot = simulation.snapshot();
      if (snapshot.started || snapshot.world.tick !== 0) {
        response.status(409).json({ error: 'Reset before changing the hazard.' });
        return;
      }
      simulation.setHazard(body.value);
    } else if (command === 'threshold' && 'value' in body && typeof body.value === 'number') {
      if (!Number.isFinite(body.value) || body.value < 0 || body.value > 1) {
        response.status(400).json({ error: 'Threshold must be between 0 and 1.' });
        return;
      }
      simulation.setThreshold(body.value);
    } else if (command === 'staleness' && 'value' in body && typeof body.value === 'number') {
      if (!Number.isInteger(body.value) || body.value < 0 || body.value > 1000) {
        response.status(400).json({ error: 'Staleness limit must be an integer between 0 and 1000 ticks.' });
        return;
      }
      simulation.setStalenessLimit(body.value);
    } else if (
      command === 'mode' && 'value' in body &&
      (body.value === 'fast_only' || body.value === 'blocking' || body.value === 'async_gated')
    ) {
      const snapshot = simulation.snapshot();
      if (snapshot.started || snapshot.world.tick !== 0) {
        response.status(409).json({ error: 'Reset before changing mode.' });
        return;
      }
      simulation.setMode(body.value);
    } else {
      response.status(400).json({ error: 'Unknown command or invalid value.' });
      return;
    }
    response.json(simulation.snapshot());
  });
  app.get('/main.js', (_request, response) => {
    response.sendFile(fileURLToPath(new URL('../client/main.js', import.meta.url)));
  });
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid JSON body.' });
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body too large.' });
    } else {
      console.error('Unexpected HTTP request failure.', error instanceof Error ? error.name : 'unknown');
      response.status(500).json({ error: 'Internal request failure.' });
    }
  });
  return app;
}
