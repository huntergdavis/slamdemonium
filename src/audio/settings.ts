export const MASTER_MUTE_KEY = 'slamdemonium.audio.master-muted.v1';

/** A room preference, deliberately outside tuning/presets/shares/replay headers.
 * Storage failure never changes what the mute control does in this session. */
export class AudioSettings {
  private value = false;
  persistenceAvailable = true;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  ) {
    try {
      this.value = storage?.getItem(MASTER_MUTE_KEY) === 'true';
      this.persistenceAvailable = storage !== null;
    } catch {
      this.persistenceAvailable = false;
    }
  }

  get masterMuted(): boolean {
    return this.value;
  }

  setMasterMuted(value: boolean): void {
    this.value = value;
    try {
      this.storage?.setItem(MASTER_MUTE_KEY, String(value));
      this.persistenceAvailable = this.storage !== null;
    } catch {
      this.persistenceAvailable = false;
    }
  }
}
