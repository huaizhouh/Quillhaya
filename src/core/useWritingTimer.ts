import { useCallback, useEffect, useRef, useState } from 'react';

export function useWritingTimer() {
  const clock = useRef({ startedAt: null as number | null, accumulated: 0, phase: 'idle' as 'idle' | 'running' | 'paused' });
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const update = useCallback(() => {
    const c = clock.current;
    setElapsed(Math.floor((c.accumulated + (c.startedAt === null ? 0 : Date.now() - c.startedAt)) / 1000));
  }, []);
  useEffect(() => { const timer = setInterval(update, 250); return () => clearInterval(timer); }, [update]);
  const start = useCallback(() => {
    if (clock.current.phase === 'running') return;
    clock.current.startedAt = Date.now(); clock.current.phase = 'running'; setRunning(true);
  }, []);
  const onInput = useCallback(() => { if (clock.current.phase === 'idle') start(); }, [start]);
  const toggle = useCallback(() => {
    const c = clock.current;
    if (c.phase !== 'running') { start(); return; }
    c.accumulated += Date.now() - c.startedAt!; c.startedAt = null; c.phase = 'paused'; setRunning(false); update();
  }, [start, update]);
  const reset = useCallback((newDocument = false) => {
    clock.current = { startedAt: null, accumulated: 0, phase: newDocument ? 'idle' : 'paused' };
    setElapsed(0); setRunning(false);
  }, []);
  return { elapsed, running, onInput, toggle, reset };
}
