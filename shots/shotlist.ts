import type { BuiltinPresetName } from '../src/tuning/presets';
import type { CameraPreset } from '../src/render/cameraRig';
import type { HudMode } from '../src/ui/hud';

/** Default capture size. A shot may override it when the full HUD needs more height. */
export const VIEWPORT = { width: 1280, height: 720 } as const;
export const TALL_VIEWPORT = { width: 1280, height: 1000 } as const;

/**
 * Every scenario runs with the simulation paused and advances physics only through
 * window.__game.stepMany, so the state at capture time depends on the build alone.
 */
export type Scenario =
  | {
      /** Respawn, hold a fixed input for a fixed number of physics steps. */
      kind: 'drive';
      steps: number;
      input: {
        throttle: number;
        brake?: number;
        steer: number;
        handbrake?: boolean;
        boost?: boolean;
      };
    }
  | {
      /** Replay a shipped input script (src/input/examples) up to a given step. */
      kind: 'replay';
      script: 'standing-start' | 'handbrake-turn' | 'ring-lap';
      steps: number;
    };

export interface Shot {
  /** Stable filename under docs/screenshots/. Never rename without updating the docs that embed it. */
  file: string;
  /** What the picture is meant to show, one sentence. Mirrored in docs/screenshots/README.md. */
  shows: string;
  /** Applied via window.__game.tuning.applyPreset before the scenario. A replay's header overrides it. */
  preset: BuiltinPresetName;
  scenario: Scenario;
  camera: CameraPreset;
  hud: HudMode;
  optionsOpen: boolean;
  /** Capture size; defaults to VIEWPORT. */
  viewport?: { readonly width: number; readonly height: number };
  /** <details> summaries inside the Options panel to click shut before scrolling (as a user would). */
  collapse?: readonly string[];
  /** CSS selector inside the Options panel to scroll into view (centred) before capture. */
  scrollTo?: string;
  /** 'live' captures now; 'pending' is skipped and reported until its dependency lands. */
  status: 'live' | 'pending';
  /** What has to exist before a pending shot can go live. */
  needs?: string;
}

const RING_DRIVE: Scenario = {
  kind: 'drive',
  steps: 540, // 4.5 s at 120 Hz: about 46 m/s, still on the 130 m centre line (r = 130.5 m)
  input: { throttle: 1, steer: 0.11 },
};

export const SHOTS: readonly Shot[] = [
  {
    file: 'lab-overview.png',
    shows:
      'The driving-feel lab from the chase camera: car at speed on the painted ring, posts and fog, minimal HUD. The README hero image.',
    preset: 'Default',
    scenario: RING_DRIVE,
    camera: 'chase',
    hud: 'minimal',
    optionsOpen: false,
    status: 'live',
  },
  {
    file: 'lab-overview-clean.png',
    shows:
      'Same moment as lab-overview.png with the HUD off: the car, the ring, posts and fog with nothing over them.',
    preset: 'Default',
    scenario: RING_DRIVE,
    camera: 'chase',
    hud: 'off',
    optionsOpen: false,
    status: 'live',
  },
  {
    file: 'options-quick-tune.png',
    shows:
      'The Options page open over the running game, Quick Tune section at the top.',
    preset: 'Default',
    scenario: RING_DRIVE,
    camera: 'chase',
    hud: 'minimal',
    optionsOpen: true,
    status: 'live',
  },
  {
    file: 'hud-full.png',
    shows:
      'The full HUD at speed: speedometer, slide angle gauge, G-G diagram, per-wheel grip bars, scrolling graphs.',
    preset: 'Default',
    scenario: RING_DRIVE,
    camera: 'chase',
    hud: 'full',
    optionsOpen: false,
    viewport: TALL_VIEWPORT,
    status: 'live',
  },
  {
    file: 'drift-hold.png',
    shows:
      'The car mid-slide after a handbrake turn, skid marks behind it, slide angle gauge out. Replays the shipped handbrake-turn script to step 372.',
    preset: 'Default',
    scenario: { kind: 'replay', script: 'handbrake-turn', steps: 372 },
    camera: 'chase',
    hud: 'full',
    optionsOpen: false,
    viewport: TALL_VIEWPORT,
    status: 'live',
  },
  {
    file: 'tire-curve-plot.png',
    shows:
      'The live tire-curve plot in the Tires group of the Options page, with the front and rear operating dots.',
    preset: 'Drifty',
    scenario: RING_DRIVE,
    camera: 'chase',
    hud: 'minimal',
    optionsOpen: true,
    viewport: TALL_VIEWPORT,
    collapse: ['.sl-options__quick > summary'],
    scrollTo: '.sl-graph--tire',
    status: 'live',
  },
  {
    file: 'scene-boot.png',
    shows:
      'Historical: the WP1 proof scene before the track and car existed. Kept for the changelog; not embedded.',
    preset: 'Default',
    scenario: { kind: 'drive', steps: 360, input: { throttle: 0, steer: 0 } },
    camera: 'chase',
    hud: 'off',
    optionsOpen: false,
    status: 'pending',
    needs:
      'nothing; retired. The proof scene no longer exists on main, so this file is frozen as captured.',
  },
];
