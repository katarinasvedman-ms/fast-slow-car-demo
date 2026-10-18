import type { CockpitEvent, CockpitView } from './model.js';

export class CockpitAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private engine: OscillatorNode | undefined;
  private engineGain: GainNode | undefined;
  private brake: OscillatorNode | undefined;
  private brakeGain: GainNode | undefined;
  private cues = new Set<OscillatorNode>();
  private muted = false;

  async start(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.12;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
  }

  toggle(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.12, this.context.currentTime, 0.02);
    }
    return this.muted;
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.muted) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    this.cues.add(oscillator);
    oscillator.onended = () => {
      this.cues.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(now + duration);
  }

  update(view: CockpitView, events: CockpitEvent[]): void {
    if (events.some((event) => event.type === 'reset')) this.reset();
    const { world, started } = view.snapshot;
    if (!started || world.outcome !== 'running') this.stopEngine();
    else if (this.context?.state === 'running' && this.master) {
      if (!this.engine) {
        this.engine = this.context.createOscillator();
        this.engine.type = 'triangle';
        this.engineGain = this.context.createGain();
        this.engineGain.gain.value = 0.14;
        this.engine.connect(this.engineGain).connect(this.master);
        this.engine.start();
        this.brake = this.context.createOscillator();
        this.brake.type = 'sawtooth';
        this.brake.frequency.value = 55;
        this.brakeGain = this.context.createGain();
        this.brakeGain.gain.value = 0;
        this.brake.connect(this.brakeGain).connect(this.master);
        this.brake.start();
      }
      this.engine.frequency.setTargetAtTime(30 + world.speedKmh * 0.65, this.context.currentTime, 0.2);
      this.brakeGain?.gain.setTargetAtTime(world.braking ? 0.025 : 0, this.context.currentTime, 0.15);
    }
    for (const event of events) {
      if (event.type === 'tick' && world.outcome === 'running') this.tone(900, 0.025, 0.08);
      if (event.type === 'gate') {
        if (!event.record.decision.allowed) this.tone(140, 0.25, 0.25, 'triangle');
        else if (event.record.phase === 'application') this.tone(740, 0.35, 0.3);
      }
      if (event.type === 'outcome' && event.outcome === 'collision') this.tone(42, 0.4, 0.6);
    }
  }

  private stopEngine(): void {
    this.engine?.stop();
    this.engine?.disconnect();
    this.engineGain?.disconnect();
    this.brake?.stop();
    this.brake?.disconnect();
    this.brakeGain?.disconnect();
    this.engine = undefined;
    this.engineGain = undefined;
    this.brake = undefined;
    this.brakeGain = undefined;
  }

  reset(): void {
    this.stopEngine();
    for (const cue of this.cues) cue.stop();
    this.cues.clear();
  }

  async dispose(): Promise<void> {
    this.reset();
    await this.context?.close();
  }
}
