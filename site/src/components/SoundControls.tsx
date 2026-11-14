import { useEffect, useRef, useState } from 'react';
import type { AudioSettings } from '../../../shared/objects';
import { SILENT, type SoundController } from '../objects/audio';

export default function SoundControls({ controller, map = false }: { controller: () => SoundController | undefined; map?: boolean }) {
  const [settings, setSettings] = useState<AudioSettings>({ ...SILENT });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const enabled = settings.sound || settings.ambience || settings.music;
  const channels = useRef({ ambience: true, music: false });
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const change = (next: AudioSettings): void => {
    if (next.ambience || next.music) channels.current = { ambience: next.ambience, music: next.music };
    setSettings(next); setError(''); setLoading(true);
    const request = ++generation.current;
    void controller()?.sound(next, (message) => { if (request === generation.current) setError(message); }).catch((reason: unknown) => {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : 'Could not enable audio');
    }).finally(() => { if (request === generation.current) setLoading(false); });
  };
  const toggle = (): void => change(map
    ? { ...settings, ...(enabled ? { ambience: false, music: false } : channels.current) }
    : { ...settings, sound: !settings.sound });
  return <div className="model-preview-sound">
    {map && <div className="model-preview-transport">
      {(['ambience', 'music'] as const).map((kind) => <button key={kind} aria-pressed={settings[kind]} onClick={() => change({ ...settings, [kind]: !settings[kind] })}>{kind === 'ambience' ? 'Ambience' : 'Music'}</button>)}
    </div>}
    <div className="model-preview-volume">
      <button type="button" className="model-preview-sound-toggle" aria-label={enabled ? 'Mute audio' : 'Enable audio'} title={enabled ? 'Mute audio' : 'Enable audio'} aria-pressed={enabled} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4Z" />
        {enabled && settings.volume > 0 ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}
      </svg>
      </button>
      <input type="range" aria-label="Sound volume" disabled={!enabled} min="0" max="1" step="0.01" value={settings.volume} onChange={(event) => change({ ...settings, volume: Number(event.target.value) })} />
    </div>
    {loading && <span className="muted" role="status">Loading audio…</span>}
    {error && <p role="alert">{error} <button onClick={() => change(settings)}>Retry audio</button></p>}
  </div>;
}
