import { EventTracker, mapSnapshot, parseSnapshot } from './model.js';
import type { CockpitEvent, CockpitView } from './model.js';

export function connect(
  onState: (view: CockpitView, events: CockpitEvent[]) => void,
  onConnection: (status: string) => void,
  onError: (error: string) => void,
): () => void {
  const tracker = new EventTracker();
  const source = new EventSource('/api/events');
  source.onopen = () => {
    tracker.reconnect();
    onConnection('CONNECTED');
  };
  source.onerror = () => onConnection('RECONNECTING');
  source.onmessage = (event: MessageEvent<string>) => {
    let snapshot;
    try {
      snapshot = parseSnapshot(event.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Invalid cockpit state.');
      return;
    }
    onState(mapSnapshot(snapshot), tracker.update(snapshot));
  };
  return () => source.close();
}
