import { ControllerHaptics } from '../input/haptics';
import type { InputMapper } from '../input/mapper';
import type { V3 } from '../physics/adapter';
import type { TuningStore } from '../tuning/store';
import type { VehicleTelemetry } from '../vehicle/telemetry';
import { ControllerOptions } from './controllerOptions';
import { ControllerPrompts } from './controllerPrompts';
import type { OptionsPanel } from './optionsPanel';
import type { PauseMenu } from './pauseMenu';

export interface ControllerSupportOptions {
  host: HTMLElement;
  input: InputMapper;
  tuning: TuningStore;
  options: OptionsPanel;
  pauseMenu: PauseMenu;
  readTelemetry: () => Readonly<VehicleTelemetry>;
  readPaused: () => boolean;
  /** World X/Z meters. Grounded-wheel gating belongs to the haptic consumer. */
  isOnKerb: (x: number, z: number) => boolean;
}

export function mountControllerSupport(
  deps: ControllerSupportOptions,
): ControllerSupport {
  return new ControllerSupport(deps);
}

/** UI and feedback composition only; boot remains the sole command dispatcher,
 * pause aggregator, physics-loop owner and contact subscriber. */
export class ControllerSupport {
  private readonly haptics: ControllerHaptics;
  private readonly navigation: ControllerOptions;
  private readonly prompts: ControllerPrompts;
  private readonly releaseCapture: () => void;
  private readonly releaseNavigation: () => void;

  constructor(private readonly deps: ControllerSupportOptions) {
    this.releaseCapture = deps.input.attachUiCapture(this.captured);
    this.releaseNavigation = deps.pauseMenu.attachOptionsNavigation();
    this.navigation = new ControllerOptions(
      deps.options,
      () => deps.input.gamepad.state,
      () => {
        if (deps.pauseMenu.isOpen) deps.pauseMenu.navigateBack();
        else deps.options.setOpen(false);
      },
    );
    this.haptics = new ControllerHaptics({
      readTelemetry: deps.readTelemetry,
      readActuator: () => deps.input.gamepad.state.actuator,
      readIntensity: () => deps.tuning.get('hapticsIntensity'),
      readPaused: () => deps.readPaused() || this.captured(),
      isOnKerb: deps.isOnKerb,
    });
    this.prompts = new ControllerPrompts(
      deps.host,
      deps.options.element,
      deps.pauseMenu.element,
    );
  }

  /** Once per RAF, after action polling and pauseMenu.update, including pause. */
  update(nowMs: number): void {
    this.haptics.update(nowMs);
    this.prompts.update(
      this.deps.input.gamepad.state,
      this.captured(),
      this.haptics.state,
    );
    const optionsActive =
      this.deps.options.isOpen &&
      (!this.deps.pauseMenu.isOpen ||
        this.deps.pauseMenu.element.contains(this.deps.options.element));
    this.navigation.keyboard.setInputDevice(this.prompts.device);
    this.navigation.update(
      nowMs,
      optionsActive,
      this.prompts.device === 'gamepad',
    );
  }

  /** After vehicle.postStep/timing and before scripts.afterStep; seconds. */
  afterStep(dtSeconds: number): void {
    this.haptics.afterStep(dtSeconds);
  }
  /** Called from boot's existing vehicle-contact callback; normal points into car. */
  onImpact(
    impulse: number | null,
    normalWorld: Readonly<V3>,
    massKg: number,
  ): void {
    this.haptics.onImpact(impulse, normalWorld, massKg);
  }
  /** Ordinary/script respawn clears feedback history. */
  reset(): void {
    this.haptics.reset();
  }
  /** Before PauseMenu/Options disposal. */
  dispose(): void {
    this.releaseCapture();
    this.releaseNavigation();
    this.haptics.dispose();
    this.navigation.dispose();
    this.prompts.dispose();
  }
  private readonly captured = (): boolean =>
    this.deps.pauseMenu.isOpen || this.deps.options.isOpen;
}
