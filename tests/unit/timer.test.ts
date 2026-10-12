// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWritingTimer } from '../../src/core/useWritingTimer';

describe('writing timer controls', () => {
  afterEach(() => vi.useRealTimers());
  it('starts on first input, excludes paused time and keeps reset paused until resumed', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const parent = document.createElement('div'), root = createRoot(parent); let timer!: ReturnType<typeof useWritingTimer>;
    function Harness() { timer = useWritingTimer(); return null; }
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { timer.onInput(); await vi.advanceTimersByTimeAsync(2400); }); expect(timer.elapsed).toBe(2);
    await act(async () => timer.toggle());
    await act(async () => { timer.onInput(); await vi.advanceTimersByTimeAsync(5000); }); expect(timer.elapsed).toBe(2); expect(timer.running).toBe(false);
    await act(async () => { timer.toggle(); await vi.advanceTimersByTimeAsync(1700); }); expect(timer.elapsed).toBe(4);
    await act(async () => timer.reset());
    await act(async () => { timer.onInput(); await vi.advanceTimersByTimeAsync(3000); }); expect(timer.elapsed).toBe(0); expect(timer.running).toBe(false);
    await act(async () => { timer.reset(true); timer.onInput(); await vi.advanceTimersByTimeAsync(1250); }); expect(timer.elapsed).toBe(1);
    await act(async () => root.unmount());
  });
});
