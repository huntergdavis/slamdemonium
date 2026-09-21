import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const backend = vi.hoisted(() => ({
  construct: vi.fn(),
  unlock: vi.fn(),
  mute: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../src/audio/howlerOutput', () => ({
  HowlerOutput: class {
    state = {
      status: 'locked',
      activeVoices: 0,
      peakVoices: 0,
      droppedVoices: 0,
      error: null,
    };
    constructor() {
      backend.construct();
    }
    unlock = backend.unlock;
    setMasterMuted = backend.mute;
    dispose = backend.dispose;
  },
}));
import { LazyAudioOutput } from '../src/audio/lazyOutput';
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
function paintFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
describe('audio activation fetch boundary', () => {
  it('leaves boot idle and loads once after activation and a paint opportunity, preserving room mute', async () => {
    const output = new LazyAudioOutput();
    output.setMasterMuted(true);
    await vi.dynamicImportSettled();
    expect(output.state.status).toBe('locked');
    expect(frames.size).toBe(0);
    expect(backend.construct).not.toHaveBeenCalled();
    output.unlock();
    output.unlock();
    expect(frames.size).toBe(1);
    paintFrame();
    await vi.dynamicImportSettled();
    expect(backend.construct).not.toHaveBeenCalled();
    paintFrame();
    await vi.dynamicImportSettled();
    expect(backend.construct).toHaveBeenCalledTimes(1);
    expect(backend.mute).toHaveBeenCalledWith(true);
    expect(backend.unlock).toHaveBeenCalledTimes(1);
    output.unlock(); // Browser rejection remains retryable with a new gesture.
    expect(backend.unlock).toHaveBeenCalledTimes(2);
    output.dispose();
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])(
    'cancels pending loading when disposed after %i frames',
    async (count) => {
      const output = new LazyAudioOutput();
      output.unlock();
      for (let i = 0; i < count; i++) paintFrame();
      output.dispose();
      output.unlock();
      paintFrame();
      await vi.dynamicImportSettled();
      expect(frames.size).toBe(0);
      expect(backend.construct).not.toHaveBeenCalled();
    },
  );
});
