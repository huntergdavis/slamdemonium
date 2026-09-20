import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PerfInputSource } from './scenario.ts';

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function inputSource(options: {
  inputScript: string | undefined;
  scriptTuning: 'apply' | 'verify' | undefined;
  demoSteps: number;
}): Promise<PerfInputSource> {
  if (options.inputScript) {
    const source = await readFile(options.inputScript, 'utf8');
    const script: unknown = JSON.parse(source);
    const tuning = options.scriptTuning;
    if (!tuning)
      throw new Error(
        '--input-script requires explicit --script-tuning apply|verify.',
      );
    return {
      identity: `wp11:sha256:${fingerprint(source)}`,
      async prepare(page) {
        return page.evaluate(
          ({ script, tuning }) => {
            const game = window.__game;
            if (!game.scripts)
              throw new Error(
                'WP11 scripts API is not wired in this build; no fallback parser/player is used.',
              );
            game.perf!.setStepDriver(undefined);
            game.releaseInput();
            game.scripts.load(script, { tuning });
            const progress = game.scripts.progress();
            if (progress.completedSteps !== 0 || progress.done)
              throw new Error(
                'Replay must arm at step zero while simulation is paused.',
              );
            return progress.totalSteps;
          },
          { script, tuning },
        );
      },
    };
  }
  return {
    identity: `vehicle-procedural-v1:${options.demoSteps}-steps`,
    async prepare(page) {
      await page.evaluate(() => {
        const game = window.__game;
        const input = {
          throttle: 0,
          brake: 0,
          steer: 0,
          handbrake: false,
          boost: false,
        };
        game.perf!.setStepDriver((step) => {
          const phase = step % 960;
          input.throttle = phase < 720 ? 1 : 0;
          input.brake = phase >= 720 ? 1 : 0;
          input.steer = phase < 360 ? 0.5 : -0.5;
          game.setInput(input);
        });
      });
      return options.demoSteps;
    },
  };
}
