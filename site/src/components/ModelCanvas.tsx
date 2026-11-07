import { useEffect, useId, useRef, useState } from 'react';
import type { AnimationChoice, PreviewVariant } from '../../../shared/objects';
import { mountViewer, type PlaybackState, type Viewer } from '../objects/viewer';

const INITIAL: PlaybackState = { time: 0, duration: 0, paused: false, speed: 1, loop: true };

function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

export default function ModelCanvas({ variant, baseUrl }: { variant: PreviewVariant; baseUrl: string }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const controller = new AbortController();
    const paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setError('');
    setAnimationError('');
    setLoadingAnimation(false);
    setReady(false);
    setPlayback({ ...INITIAL, paused });
    void mountViewer(container.current, variant, baseUrl, controller.signal, {
      paused,
      onPlayback: (state) => { if (!controller.signal.aborted) { playbackRef.current = state; setPlayback(state); } },
    }).then((instance) => {
      if (controller.signal.aborted) { instance.dispose(); return; }
      viewer.current = instance;
      setChoices(instance.animations);
      setSelected(instance.selected);
      setHasMotion(instance.hasMotion);
      setReady(true);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load preview');
    });
    return () => { animationRequest.current++; controller.abort(); viewer.current?.dispose(); viewer.current = undefined; };
  }, [variant, baseUrl, attempt]);

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

  const beginScrub = (): void => {
    if (resumeAfterScrub.current !== null) return;
    resumeAfterScrub.current = !playbackRef.current.paused;
    viewer.current?.pause(true);
  };
  const endScrub = (): void => {
    const state = playbackRef.current;
    if (resumeAfterScrub.current && (state.loop || state.time < state.duration)) viewer.current?.pause(false);
    resumeAfterScrub.current = null;
  };
  const groups = [...new Set(choices.map((choice) => choice.group))];
  const ended = playback.duration > 0 && playback.time >= playback.duration;

  return (
    <div className={`model-canvas${ready ? ' model-canvas-ready' : ''}`}>
      <div className="model-preview-stage" ref={container}>
        {!ready && !error && <span className="model-preview-status" role="status">Loading model…</span>}
      </div>
      {error && <p className="model-preview-error" role="alert">Preview unavailable: {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {ready && <div className="model-preview-controls">
        {choices.length > 0 && <>
          <label className="model-preview-animation">Animation
            <select ref={animationSelect} className="styled-select" aria-label="Animation" value={selected} onChange={(event) => select(event.target.value)}>
              {groups.map((group) => <optgroup key={group} label={group}>{choices.filter((choice) => choice.group === group).map((choice) => <option key={choice.name} value={choice.name}>{choice.label}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="model-preview-timeline">
            <label htmlFor={timeId}>Playback position <output>{clock(playback.time)} / {clock(playback.duration)}</output></label>
            <input id={timeId} type="range" aria-label="Playback position" aria-valuetext={`${clock(playback.time)} of ${clock(playback.duration)}`}
              min={0} max={playback.duration || 1} step="any" value={playback.time} disabled={!playback.duration || loadingAnimation}
              onPointerDown={beginScrub} onPointerUp={endScrub} onPointerCancel={endScrub} onBlur={endScrub}
              onKeyDown={(event) => { if (/^(Arrow|Home|End|Page)/.test(event.key)) beginScrub(); }}
              onKeyUp={endScrub} onChange={(event) => viewer.current?.seek(Number(event.target.value))} />
          </div>
        </>}
        {hasMotion && <>
          <div className="model-preview-transport">
            <button onClick={() => viewer.current?.pause(!playback.paused)}>{playback.paused ? ended ? 'Replay' : 'Play' : 'Pause'}</button>
            <button onClick={() => { viewer.current?.seek(0); viewer.current?.pause(false); }}>Restart</button>
            <button onClick={() => viewer.current?.reset()}>Reset view</button>
          </div>
          <div className="model-preview-settings">
            <label>Speed <select className="styled-select" aria-label="Playback speed" value={playback.speed} onChange={(event) => viewer.current?.speed(Number(event.target.value))}>
              {[0.25, 0.5, 1, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
            </select></label>
            {choices.length > 0 && <label className="model-preview-loop"><input type="checkbox" checked={playback.loop} onChange={(event) => viewer.current?.loop(event.target.checked)} /> Loop</label>}
          </div>
          {loadingAnimation && <span className="muted" role="status">Loading animation…</span>}
          {animationError && <p role="alert">{animationError} <button onClick={() => { select(selected); animationSelect.current?.focus({ preventScroll: true }); }}>Retry animation</button></p>}
        </>}
        {!hasMotion && <button className="model-preview-reset" onClick={() => viewer.current?.reset()}>Reset view</button>}
        <p className="muted model-preview-help">Drag to rotate. Pinch or scroll to zoom.</p>
      </div>}
    </div>
  );
}
