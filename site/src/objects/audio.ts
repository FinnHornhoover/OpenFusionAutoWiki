import type { AudioBank, AudioRegion, AudioSettings, SoundEvent } from '../../../shared/objects';

export const SILENT: AudioSettings = { sound: false, ambience: false, music: false, volume: 0.35 };
export interface SoundHandle { stop(): void; volume(value: number): void }
export interface SoundController { sound(settings: AudioSettings, onError?: (message: string) => void): Promise<void> }

export class PreviewAudio implements SoundController {
  settings = { ...SILENT };
  bank?: AudioBank;
  onError: (message: string) => void = () => {};
  private context?: AudioContext;
  private master?: GainNode;
  private controller = new AbortController();
  private loading?: Promise<AudioBank>;
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer>>();
  private voices = new Set<SoundHandle>();
  private bytes = 0;
  private epoch = 0;
  private disposed = false;
  private visible = true;

  constructor(private baseUrl: string, private file: string) {}

  async sound(settings: AudioSettings, onError?: (message: string) => void): Promise<void> {
    this.settings = { ...settings };
    if (onError) this.onError = onError;
    if (this.disposed) return;
    const enabled = settings.sound || settings.ambience || settings.music;
    if (!enabled) { this.stop(); await this.context?.suspend(); return; }
    this.context ??= new AudioContext();
    if (!this.master) { this.master = this.context.createGain(); this.master.connect(this.context.destination); }
    this.master.gain.value = Math.max(0, Math.min(1, settings.volume));
    const resumed = this.context.resume();
    this.loading ??= fetch(new URL(`${this.baseUrl}/${this.file}`, location.href), { signal: this.controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(`Sound data failed (${response.status})`); return response.json() as Promise<AudioBank>; })
      .catch((error: unknown) => { this.loading = undefined; throw error; });
    const [bank] = await Promise.all([this.loading, resumed]);
    if (!this.disposed) this.bank = bank;
    if (!this.visible || !(this.settings.sound || this.settings.ambience || this.settings.music)) await this.context.suspend();
  }

  private cached(file: string): AudioBuffer | undefined {
    const cached = this.buffers.get(file);
    if (cached) { this.buffers.delete(file); this.buffers.set(file, cached); return cached; }
    return undefined;
  }

  private async buffer(file: string): Promise<AudioBuffer> {
    const cached = this.cached(file);
    if (cached) return cached;
    let pending = this.pending.get(file);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(new URL(`${this.baseUrl}/${file}`, location.href), { signal: this.controller.signal });
        if (!response.ok) throw new Error(`Sound download failed (${response.status})`);
        const decoded = await this.context!.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) throw new DOMException('Aborted', 'AbortError');
        const bytes = decoded.length * decoded.numberOfChannels * 4;
        if (bytes <= 16 * 1024 * 1024) {
          this.buffers.set(file, decoded); this.bytes += bytes;
          while (this.bytes > 16 * 1024 * 1024 || this.buffers.size > 32) {
            const [key, buffer] = this.buffers.entries().next().value!;
            this.bytes -= buffer.length * buffer.numberOfChannels * 4; this.buffers.delete(key);
          }
        }
        return decoded;
      })().finally(() => { this.pending.delete(file); });
      this.pending.set(file, pending);
    }
    return pending;
  }

  async prefetch(keys: string[]): Promise<void> {
    if (!this.context || !this.bank || this.disposed) return;
    const files = [...new Set(keys.flatMap((key) => this.bank?.sounds[key] ?? []))];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (next < files.length && !this.disposed) await this.buffer(files[next++]);
    }));
  }

  async play(key: string, volume = 1, loop = false, pitch = 1): Promise<SoundHandle | undefined> {
    if (this.disposed || !this.visible || !(loop ? this.settings.ambience : this.settings.sound) || !this.bank || !this.context) return;
    const choices = this.bank.sounds[key];
    if (!choices?.length || this.voices.size >= 24) return;
    const epoch = this.epoch, started = performance.now();
    try {
      const file = choices[Math.floor(Math.random() * choices.length)];
      const buffer = this.cached(file) ?? await this.buffer(file);
      if (this.disposed || !this.visible || epoch !== this.epoch || this.voices.size >= 24 || (!loop && performance.now() - started > 400)) return;
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer; source.loop = loop; source.playbackRate.value = pitch;
      gain.gain.value = volume; source.connect(gain); gain.connect(this.master!);
      let stopped = false;
      const handle: SoundHandle = {
        stop: () => { if (stopped) return; stopped = true; source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); gain.disconnect(); this.voices.delete(handle); },
        volume: (value) => { if (!stopped) gain.gain.setTargetAtTime(value, this.context!.currentTime, 0.08); },
      };
      source.onended = handle.stop; this.voices.add(handle); source.start();
      return handle;
    } catch (error) { if (!this.disposed && epoch === this.epoch) this.onError(error instanceof Error ? error.message : 'Could not play sound'); }
  }

  event(event: SoundEvent, attack?: () => void): void {
    if (event.functionName === 'sound' && event.audio) void this.play(event.audio);
    else if (event.functionName === 'attacksound') attack?.();
  }

  stop(): void { this.epoch++; for (const voice of [...this.voices]) voice.stop(); }

  visibility(visible: boolean): void {
    this.visible = visible;
    if (!visible) { this.stop(); void this.context?.suspend().catch(() => {}); }
    else if (this.settings.sound || this.settings.ambience || this.settings.music) void this.context?.resume().catch(() => {});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort(); this.stop(); this.buffers.clear(); this.pending.clear(); this.bytes = 0; this.bank = undefined; this.loading = undefined;
    void this.context?.close().catch(() => {}); this.onError = () => {};
  }
}

function contains(region: AudioRegion, x: number, z: number): boolean {
  if (region.instance || region.points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = region.points.length - 1; i < region.points.length; j = i++) {
    const [ax, az] = region.points[i], [bx, bz] = region.points[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

interface Channel { key: string; element: HTMLAudioElement; started: number; failed?: boolean }

export class MapAudio implements SoundController {
  private audio: PreviewAudio;
  private channels = new Map<'music' | 'ambience', Channel>();
  private ended = new Map<string, number>();
  private loops = new Map<string, SoundHandle>();
  private pending = new Set<string>();
  private visible = true;
  private disposed = false;
  private epoch = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(private baseUrl: string, file: string, private position: () => [number, number, number]) {
    this.audio = new PreviewAudio(baseUrl, file);
    this.timer = setInterval(() => this.update(), 250);
  }

  async sound(settings: AudioSettings, onError?: (message: string) => void): Promise<void> {
    for (const [kind, channel] of this.channels) if (channel.failed) this.clearChannel(kind);
    if (!settings.ambience) this.stopLoops();
    if (!settings.music) this.clearChannel('music');
    if (!settings.ambience) this.clearChannel('ambience');
    await this.audio.sound(settings, onError);
    this.update();
  }

  private clearChannel(kind: 'music' | 'ambience'): void {
    const channel = this.channels.get(kind);
    if (!channel) return;
    channel.element.onended = null; channel.element.onerror = null;
    channel.element.pause(); channel.element.removeAttribute('src'); channel.element.load(); this.channels.delete(kind);
  }

  private channel(kind: 'music' | 'ambience', region: AudioRegion | undefined): void {
    const key = region?.sound, now = performance.now();
    const current = this.channels.get(kind);
    if (!key) { this.clearChannel(kind); return; }
    if (current?.key === key) {
      if (current.failed) return;
      if (!current.element.ended) { current.element.volume = this.audio.settings.volume * Math.min(1, (now - current.started) / 500); return; }
      if (Date.now() < (this.ended.get(key) ?? 0) + region!.delay * 1000) return;
      this.clearChannel(kind);
    } else {
      this.clearChannel(kind);
      if (kind === 'music' && Date.now() < (this.ended.get(key) ?? 0) + region!.delay * 1000) return;
    }
    const choices = this.audio.bank?.sounds[key];
    if (!choices?.length) return;
    const element = new Audio(); element.crossOrigin = 'anonymous'; element.preload = 'auto'; element.loop = kind === 'ambience'; element.volume = 0;
    element.src = new URL(`${this.baseUrl}/${choices[Math.floor(Math.random() * choices.length)]}`, location.href).href;
    element.onended = () => { this.ended.set(key, Date.now()); };
    element.onerror = () => { const channel = this.channels.get(kind); if (channel?.element !== element) return; channel.failed = true; this.audio.onError('Could not load map audio'); };
    this.channels.set(kind, { key, element, started: now });
    void element.play().catch((error: unknown) => { const channel = this.channels.get(kind); if (!this.disposed && channel?.element === element) { channel.failed = true; this.audio.onError(error instanceof Error ? error.message : 'Could not play map audio'); } });
  }

  private update(): void {
    if (!this.visible || this.disposed || !this.audio.bank) return;
    const [x, y, z] = this.position(), bank = this.audio.bank;
    if (this.audio.settings.music) this.channel('music', bank.music.find((region) => contains(region, x, z)));
    if (!this.audio.settings.ambience) return;
    this.channel('ambience', bank.ambience.find((region) => contains(region, x, z)));
    const nearby = bank.emitters.map((emitter) => ({ emitter, distance: Math.hypot(x - emitter.position[0], y - emitter.position[1], z - emitter.position[2]) }))
      .filter(({ emitter, distance }) => distance < (this.loops.has(emitter.id) ? emitter.far : emitter.near)).sort((a, b) => a.distance - b.distance).slice(0, 8);
    const wanted = new Set(nearby.map(({ emitter }) => emitter.id));
    for (const [id, handle] of this.loops) if (!wanted.has(id)) { handle.stop(); this.loops.delete(id); }
    for (const { emitter, distance } of nearby) {
      const volume = emitter.volume * Math.max(0, 1 - distance / emitter.far) ** 2;
      const handle = this.loops.get(emitter.id);
      if (handle) { handle.volume(volume); continue; }
      if (this.pending.has(emitter.id)) continue;
      const epoch = this.epoch; this.pending.add(emitter.id);
      void this.audio.play(emitter.sound, volume, true, emitter.pitch).then((handle) => {
        if (!handle) return;
        const position = this.position();
        const distance = Math.hypot(...position.map((value, index) => value - emitter.position[index]));
        if (epoch !== this.epoch || !this.visible || this.disposed || !this.audio.settings.ambience || distance >= emitter.far) handle.stop();
        else this.loops.set(emitter.id, handle);
      }).finally(() => { this.pending.delete(emitter.id); });
    }
  }

  private stopLoops(): void { this.epoch++; this.loops.forEach((handle) => handle.stop()); this.loops.clear(); }
  visibility(visible: boolean): void {
    this.visible = visible;
    if (!visible) { this.stopLoops(); this.clearChannel('music'); this.clearChannel('ambience'); }
    this.audio.visibility(visible); if (visible) this.update();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; clearInterval(this.timer); this.stopLoops(); this.clearChannel('music'); this.clearChannel('ambience'); this.audio.dispose(); this.pending.clear(); this.ended.clear();
  }
}
