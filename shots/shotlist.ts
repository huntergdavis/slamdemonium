import type { BuiltinPresetName } from '../src/tuning/presets';

/** Fixed capture size for every documentation screenshot. */
export const VIEWPORT = { width: 1280, height: 720 } as const;

/** Simulated seconds the scene settles after respawn before a 'rest' capture. */
export const SETTLE_SECONDS = 3;

export type ScenarioName =
  | 'rest' // respawn, let the body settle, capture with the current camera
  | 'ring-chase' // pending: WP3 ring + WP6 chase camera preset
  | 'drift-hold' // pending: WP5 vehicle model + scripted drift input
  | 'options-open' // pending: WP7 options panel hook
  | 'hud-full' // pending: WP8 HUD hook
  | 'tire-curve'; // pending: WP7 tire-curve plot

export interface Shot {
  /** Stable filename under docs/screenshots/. Never rename without updating the docs that embed it. */
  file: string;
  /** What the picture is meant to show, one sentence. Mirrored in docs/screenshots/README.md. */
  shows: string;
  preset: BuiltinPresetName;
  scenario: ScenarioName;
  /** 'live' captures now; 'pending' is skipped and reported until its dependency lands. */
  status: 'live' | 'pending';
  /** What has to exist before a pending shot can go live. */
  needs?: string;
}

export const SHOTS: readonly Shot[] = [
  {
    file: 'scene-boot.png',
    shows:
      'The WP1 proof scene: the orange chassis box at rest on the grey pad with the thin CCD test wall behind it.',
    preset: 'Default',
    scenario: 'rest',
    status: 'live',
  },
  {
    file: 'lab-overview.png',
    shows:
      'The driving-feel lab from the chase camera: car on the painted ring, posts, fog, full HUD. The README hero image.',
    preset: 'Default',
    scenario: 'ring-chase',
    status: 'pending',
    needs: 'WP3 ring and WP6 camera preset hook on window.__game',
  },
  {
    file: 'drift-hold.png',
    shows:
      'The car held mid-drift on the ring with skid marks, slide angle gauge out and drift meter charging.',
    preset: 'Drifty',
    scenario: 'drift-hold',
    status: 'pending',
    needs:
      'WP5 vehicle model, WP6 skid marks, scripted input via setInput/stepMany',
  },
  {
    file: 'options-quick-tune.png',
    shows:
      'The Options page open over the running game, Quick Tune section at the top.',
    preset: 'Default',
    scenario: 'options-open',
    status: 'pending',
    needs: 'WP7 options panel and a hook to open it from the test surface',
  },
  {
    file: 'tire-curve-plot.png',
    shows:
      'The live tire-curve plot in the Tires group with the front and rear operating dots.',
    preset: 'Drifty',
    scenario: 'tire-curve',
    status: 'pending',
    needs: 'WP7 tire-curve plot and a hook to scroll the panel to it',
  },
  {
    file: 'hud-full.png',
    shows:
      'The full HUD at speed: speedometer, slide angle gauge, G-G diagram, per-wheel bars, graphs.',
    preset: 'Default',
    scenario: 'hud-full',
    status: 'pending',
    needs: 'WP8 HUD and a hook to set HUD mode from the test surface',
  },
];
