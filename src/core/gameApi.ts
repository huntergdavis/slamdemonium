export interface GameInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

/** Stable automation surface; later work packages wire the runtime operations. */
export interface GameTestApi {
  ready: boolean;
  tuning: {
    get(key: string): number;
    set(key: string, value: number): void;
    applyPreset(name: string): void;
  };
  setInput(input: Partial<GameInput>): void;
  stepMany(steps: number): void;
  getTelemetry(): Readonly<Record<string, unknown>>;
  respawn(): void;
}

function unavailable(): never {
  throw new Error('The gameplay API is not wired yet (WP0 scaffold).');
}

export function createGameStub(): GameTestApi {
  return {
    ready: false,
    tuning: { get: unavailable, set: unavailable, applyPreset: unavailable },
    setInput: unavailable,
    stepMany: unavailable,
    getTelemetry: unavailable,
    respawn: unavailable,
  };
}

declare global {
  interface Window {
    __game: GameTestApi;
  }
}
