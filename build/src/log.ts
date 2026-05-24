// Minimal, dependency-free logger. Prefixes lines with a tag and an elapsed timer.

const t0 = Date.now();

function elapsed(): string {
  const sec = (Date.now() - t0) / 1000;
  return `${sec.toFixed(1).padStart(6, ' ')}s`;
}

function emit(tag: string, msg: string): void {
  process.stdout.write(`[${elapsed()}] ${tag.padEnd(8)} ${msg}\n`);
}

export const log = {
  info: (msg: string) => emit('info', msg),
  step: (msg: string) => emit('step', msg),
  warn: (msg: string) => emit('warn', msg),
  done: (msg: string) => emit('done', msg),
};
