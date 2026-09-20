export interface TimingSummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  standardDeviationMs: number;
}

export interface MemorySample {
  elapsedSeconds: number;
  jsUsedBytes: number;
  jsTotalBytes: number;
  backingStorageBytes: number;
  wasmHeapBytes: number;
  wasmFreeBytes: number;
  wasmUsedBytes: number;
}

export interface Limits {
  physicsP99Ms: number;
  heapGrowthPercent: number;
}

export function summarize(samples: readonly number[]): TimingSummary {
  if (
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error(
      'Missing or invalid timing samples; performance cannot pass.',
    );
  const sorted = [...samples].sort((a, b) => a - b);
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    meanMs,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1]!,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    standardDeviationMs: Math.sqrt(
      sorted.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) /
        sorted.length,
    ),
  };
}

export function growthPercent(first: number, last: number): number {
  if (
    !Number.isFinite(first) ||
    first <= 0 ||
    !Number.isFinite(last) ||
    last < 0
  )
    throw new Error('Invalid memory baseline; performance cannot pass.');
  return ((last - first) / first) * 100;
}

export function assess(
  physics: TimingSummary,
  first: MemorySample,
  last: MemorySample,
  limits: Limits,
  droppedSamples: number,
): { failures: string[]; growth: Record<string, number> } {
  const failures: string[] = [];
  if (physics.p99Ms > limits.physicsP99Ms)
    failures.push(
      `Physics p99 ${physics.p99Ms.toFixed(3)} ms exceeds ${limits.physicsP99Ms} ms.`,
    );
  if (droppedSamples > 0)
    failures.push(
      `Recorder overflow: ${droppedSamples} samples lost; percentiles are incomplete.`,
    );
  const growth = {
    jsUsedPercent: growthPercent(first.jsUsedBytes, last.jsUsedBytes),
    wasmUsedPercent: growthPercent(first.wasmUsedBytes, last.wasmUsedBytes),
    wasmCapacityPercent: growthPercent(first.wasmHeapBytes, last.wasmHeapBytes),
  };
  for (const [name, percent] of Object.entries(growth)) {
    if (percent > limits.heapGrowthPercent)
      failures.push(
        `${name} grew ${percent.toFixed(2)}%, exceeding ${limits.heapGrowthPercent}%.`,
      );
  }
  return { failures, growth };
}
