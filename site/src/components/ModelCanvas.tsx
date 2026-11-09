import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AnimationChoice, PreviewVariant } from '../../../shared/objects';
import { mountViewer, type PlaybackState, type Viewer, type ViewState } from '../objects/viewer';

const INITIAL: PlaybackState = { time: 0, duration: 0, paused: false };

function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

export default function ModelCanvas({ variant, baseUrl, preserveView = false, options }: { variant: PreviewVariant; baseUrl: string; preserveView?: boolean; options?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const savedView = useRef<ViewState>();
  const animationSelect = useRef<HTMLSelectElement>(null);
  const animationRequest = useRef(0);
  const resumeAfterScrub = useRef<boolean | null>(null);
  const playbackRef = useRef<PlaybackState>(INITIAL);
  const timeId = useId();
  const [choices, setChoices] = useState<AnimationChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL);
  const [ready, setReady] = useState(false);
  const [hasMotion, setHasMotion] = useState(false);
  const [error, setError] = useState('');
  const [animationError, setAnimationError] = useState('');
  const [loadingAnimation, setLoadingAnimation] = useState(false);
  const [hasTrails, setHasTrails] = useState(false);
  const [trails, setTrails] = useState(true);
  const [shot, setShot] = useState(0);
  const [firing, setFiring] = useState(false);
  const [fireError, setFireError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const controller = new AbortController();
    const paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setError('');
    setShot(0); setFiring(false); setFireError(''); setHasTrails(false); setTrails(true);
    setAnimationError('');
    setLoadingAnimation(false);
    setReady(false);
    setPlayback({ ...INITIAL, paused });
    void mountViewer(container.current, variant, baseUrl, controller.signal, {
      paused,
      view: preserveView ? savedView.current : undefined,
      onPlayback: (state) => { if (!controller.signal.aborted) { playbackRef.current = state; setPlayback(state); } },
    }).then((instance) => {
      if (controller.signal.aborted) { instance.dispose(); return; }
      viewer.current = instance;
      setChoices(instance.animations);
      setSelected(instance.selected);
      setHasMotion(instance.hasMotion);
      setHasTrails(instance.hasVehicleTrails);
      setReady(true);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load preview');
    });
    return () => {
      if (preserveView && viewer.current) savedView.current = viewer.current.getView();
      animationRequest.current++;
      controller.abort();
      viewer.current?.dispose();
      viewer.current = undefined;
    };
  }, [variant, baseUrl, attempt, preserveView]);

  const select = (name: string): void => {
    const request = ++animationRequest.current;
    setSelected(name);
    setLoadingAnimation(true);
    setAnimationError('');
    void viewer.current?.play(name).then(() => {
      if (request === animationRequest.current) setLoadingAnimation(false);
    }).catch((reason: unknown) => {
      if (request !== animationRequest.current) return;
      setLoadingAnimation(false);
      setAnimationError(reason instanceof Error ? reason.message : 'Could not load animation');
    });
  };

  const fire = (): void => {
    const instance = viewer.current;
    if (!instance) return;
    setFiring(true); setFireError('');
    void instance.fire(shot).catch((reason: unknown) => {
      if (viewer.current === instance) setFireError(reason instanceof Error ? reason.message : 'Could not load weapon effects');
    }).finally(() => { if (viewer.current === instance) setFiring(false); });
  };

  const beginScrub = (): void => {
    if (resumeAfterScrub.current !== null) return;
    resumeAfterScrub.current = !playbackRef.current.paused;
    viewer.current?.pause(true);
  };
  const endScrub = (): void => {
    if (resumeAfterScrub.current) viewer.current?.pause(false);
    resumeAfterScrub.current = null;
  };
  const groups = [...new Set(choices.map((choice) => choice.group))];

  return (
    <div className={`model-canvas${ready ? ' model-canvas-ready' : ''}`}>
      <div className="model-preview-stage" ref={container}>
        {!ready && !error && <span className="model-preview-status" role="status">Loading model…</span>}
      </div>
      {error && <p className="model-preview-error" role="alert">Preview unavailable: {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {ready && <section className="model-preview-controls" aria-label="3D viewing options">
        {options}
        {!!variant.weaponShots?.length && <div className="model-preview-weapon">
          {variant.weaponShots.length > 1 && <label>Shot
            <select className="styled-select" aria-label="Weapon shot" value={shot} disabled={firing} onChange={(event) => setShot(Number(event.target.value))}>
              {variant.weaponShots.map((entry, index) => <option key={index} value={index}>{entry.label}</option>)}
            </select>
          </label>}
          <button disabled={firing || loadingAnimation} onClick={fire}>{firing ? 'Firing…' : 'Fire weapon'}</button>
          {fireError && <p role="alert">{fireError}</p>}
        </div>}
        {hasTrails && <button className="model-preview-vehicle-trails" aria-pressed={trails} onClick={() => { viewer.current?.trails(!trails); setTrails(!trails); }}>Vehicle trails</button>}
        {choices.length > 0 && <>
          <label className="model-preview-animation">Animation
            <select ref={animationSelect} className="styled-select" aria-label="Animation" disabled={firing} value={selected} onChange={(event) => select(event.target.value)}>
              {groups.map((group) => <optgroup key={group} label={group}>{choices.filter((choice) => choice.group === group).map((choice) => <option key={choice.name} value={choice.name}>{choice.label}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="model-preview-timeline">
            <label htmlFor={timeId}>Playback position <output>{clock(playback.time)} / {clock(playback.duration)}</output></label>
            <input id={timeId} type="range" aria-label="Playback position" aria-valuetext={`${clock(playback.time)} of ${clock(playback.duration)}`}
              min={0} max={playback.duration || 1} step="any" value={playback.time} disabled={!playback.duration || loadingAnimation || firing}
              onPointerDown={beginScrub} onPointerUp={endScrub} onPointerCancel={endScrub} onBlur={endScrub}
              onKeyDown={(event) => { if (/^(Arrow|Home|End|Page)/.test(event.key)) beginScrub(); }}
              onKeyUp={endScrub} onChange={(event) => viewer.current?.seek(Number(event.target.value))} />
          </div>
        </>}
        {hasMotion && <>
          <div className="model-preview-transport">
            <button disabled={firing} onClick={() => viewer.current?.pause(!playback.paused)}>{playback.paused ? 'Play' : 'Pause'}</button>
            <button onClick={() => viewer.current?.reset()}>Reset view</button>
          </div>
          {loadingAnimation && <span className="muted" role="status">Loading animation…</span>}
          {animationError && <p role="alert">{animationError} <button onClick={() => { select(selected); animationSelect.current?.focus({ preventScroll: true }); }}>Retry animation</button></p>}
        </>}
        {!hasMotion && <button className="model-preview-reset" onClick={() => viewer.current?.reset()}>Reset view</button>}
        <p className="muted model-preview-help">Drag to rotate. Pinch or scroll to zoom.</p>
      </section>}
    </div>
  );
}
