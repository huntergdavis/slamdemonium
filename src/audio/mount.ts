import { AudioPrompt } from '../ui/audioPrompt';
import { AudioDirector, type AudioDirectorOptions } from './director';
import { LazyAudioOutput } from './lazyOutput';
import { AudioSettings } from './settings';

export interface MountAudioOptions extends Omit<
  AudioDirectorOptions,
  'output' | 'settings'
> {
  /** Mount after ControllerSupport so the prompt shares its existing overlay. */
  host: HTMLElement;
}

/** Boot owns the loop, pause aggregation and single contact subscriber. Supply
 * F0 resolveGroundedSurface directly, never a geometry-based audio resolver. */
export function mountAudioDirector(deps: MountAudioOptions): AudioDirector {
  return new MountedAudioDirector(deps);
}

class MountedAudioDirector extends AudioDirector {
  private readonly prompt: AudioPrompt;
  private readonly releaseTuning: () => void;

  constructor(deps: MountAudioOptions) {
    let storage: Storage | null = null;
    try {
      storage = deps.host.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      /* Muting still works in memory. */
    }
    const output = new LazyAudioOutput(deps.engine);
    super({ ...deps, output, settings: new AudioSettings(storage) });
    this.prompt = new AudioPrompt(deps.host, this);
    this.releaseTuning = deps.tuning.onChange((change) => {
      if (change.key === 'sfxVolume' && change.new === 0) output.reset();
    });
  }
  override update(nowMs: number): void {
    super.update(nowMs);
    this.prompt.update();
  }
  override dispose(): void {
    this.releaseTuning();
    this.prompt.dispose();
    super.dispose();
  }
}
