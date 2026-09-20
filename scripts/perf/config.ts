import { parseArgs } from 'node:util';

export function parseConfig(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'duration-seconds': { type: 'string', default: '300' },
      'baseline-seconds': { type: 'string', default: '60' },
      'warmup-replays': { type: 'string', default: '2' },
      'physics-p99-ms': { type: 'string', default: '2' },
      'heap-growth-percent': { type: 'string', default: '10' },
      scenario: { type: 'string' },
      'input-script': { type: 'string' },
      'script-tuning': { type: 'string' },
      'demo-steps': { type: 'string', default: '960' },
      'timeout-seconds': { type: 'string', default: '1800' },
      output: { type: 'string', default: 'test-results/perf.json' },
      port: { type: 'string', default: '0' },
      'skip-spike': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  function number(name: keyof typeof values, minimum: number): number {
    const value = Number(values[name]);
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      String(values[name]).trim() === ''
    )
      throw new RangeError(`--${name} must be a finite number >= ${minimum}.`);
    return value;
  }
  const durationSeconds = number('duration-seconds', 1);
  const baselineSeconds = number('baseline-seconds', 1);
  if (durationSeconds <= baselineSeconds)
    throw new RangeError('Duration must exceed the first memory checkpoint.');
  const port = number('port', 0);
  const demoSteps = number('demo-steps', 1);
  const warmupReplays = number('warmup-replays', 0);
  if (!Number.isSafeInteger(warmupReplays))
    throw new RangeError('--warmup-replays must be an integer.');
  if (!Number.isSafeInteger(demoSteps))
    throw new RangeError('--demo-steps must be an integer.');
  const scriptTuning = values['script-tuning'];
  if (
    scriptTuning !== undefined &&
    scriptTuning !== 'apply' &&
    scriptTuning !== 'verify'
  )
    throw new RangeError('--script-tuning must be apply or verify.');
  if (!!values['input-script'] !== !!scriptTuning)
    throw new RangeError(
      '--input-script and --script-tuning must be provided together.',
    );
  if (!Number.isInteger(port) || port > 65535)
    throw new RangeError('Invalid port.');
  return {
    durationSeconds,
    baselineSeconds,
    warmupReplays,
    limits: {
      physicsP99Ms: number('physics-p99-ms', 0),
      heapGrowthPercent: number('heap-growth-percent', 0),
    },
    scenario: values.scenario,
    inputScript: values['input-script'],
    scriptTuning: scriptTuning as 'apply' | 'verify' | undefined,
    demoSteps,
    timeoutSeconds: number('timeout-seconds', durationSeconds + 1),
    output: values.output!,
    port,
    skipSpike: values['skip-spike'],
    help: values.help,
  };
}

export const HELP = `npm run perf -- [options]
  --duration-seconds 300 --baseline-seconds 60 --warmup-replays 2
  --demo-steps 960 --timeout-seconds 1800
  --physics-p99-ms 2 --heap-growth-percent 10
  --scenario ./scripts/perf/scenarios/physics-demo.ts
  --input-script path/to/wp11.json --script-tuning apply|verify
  --output test-results/perf.json --port 0
  --skip-spike  Skip the separate WP1 baseline reproduction (smoke checks only).
Duration is a minimum soak interval; termination is always at complete replay EOF.
Physics gate uses manual stepMany full-step p99; RAF distributions are advisory.
Shortened runs are smoke checks, not the five-minute acceptance run.
No CI workflow is installed; a failed gate exits nonzero.`;
