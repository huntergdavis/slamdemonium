import type { TuningStore } from '../tuning/store';

export interface MassRebuildState {
  status: 'idle' | 'pending' | 'error' | 'unavailable';
  error: string | null;
}

/** Boot owns the only store subscription that applies mass changes. UI observes state. */
export class DebouncedMassRebuild {
  private readonly current: MassRebuildState;
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private disposed = false;

  constructor(
    store: TuningStore,
    private readonly apply?: () => void,
  ) {
    this.current = { status: apply ? 'idle' : 'unavailable', error: null };
    this.unsubscribe = store.onChange((change) => {
      if (!change.needsRebuild) return;
      clearTimeout(this.timer);
      this.pending = true;
      this.current.status = this.apply ? 'pending' : 'unavailable';
      this.current.error = null;
      if (this.apply)
        this.timer = setTimeout(() => {
          try {
            this.flush();
          } catch (error) {
            console.error('Mass update failed.', error);
          }
        }, 100);
    });
  }
  get state(): Readonly<MassRebuildState> {
    return this.current;
  }
  /** Synchronous: scripts/manual stepping call this before step zero. Failures propagate. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending || this.disposed) return;
    if (!this.apply) throw new Error('Mass updates are unavailable.');
    try {
      this.apply();
      this.pending = false;
      this.current.status = 'idle';
      this.current.error = null;
    } catch (error) {
      this.current.status = 'error';
      this.current.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  /** Discard queued work; a caller that changes simulation state must rebuild explicitly. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.current.status = this.apply && !this.disposed ? 'idle' : 'unavailable';
    this.current.error = null;
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.cancel();
  }
}
