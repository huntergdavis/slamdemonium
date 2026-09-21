# Controller contract (WP19)

Standard-mapped controllers use RT/LT for throttle/brake, left stick for steer,
bottom (standard A) for handbrake, left (X) for boost, and top (Y) for respawn.
Start opens/closes the pause menu; View/Back opens Options directly. In UI, right
(B) always goes back. P remains the independent keyboard pause request.

Hold left bumper to reveal the command legend while driving:

| Second button                   | Action                                 |
| ------------------------------- | -------------------------------------- |
| D-pad Up / Right / Down / Left  | HUD / camera / slow motion / A-B swap  |
| Bottom (A) / Left (X) / Top (Y) | Telemetry CSV / gizmos / latency probe |

A fresh second-button press is required. Adding LB to an already-held face button
does not issue a command. A chord-owned face button stays suppressed until released,
even if LB is released first. B has no driving command. UI capture suppresses these
chords and pad driving before the script processor, without suppressing scripted
input itself. Keyboard editing/focus guards remain event-owned.

GamepadInput publishes monotonic presses and independent UI counters on one reused
state. InputMapper.sampleForStep() and sampleActions() share ONE consumption
history. UI reads the polled state and never calls navigator.getGamepads().
sampleActions() cannot sample scripts, physics, or latency statistics. Controller
latency uses a poll-to-rAF proxy, not a hardware event-to-display measurement.

Disconnection clears analog/held state and the actuator. Reconnecting/switching pads
requires release before command buttons can issue another edge. Meaningful button
presses or axis changes switch prompts to the pad; keyboard/pointer activity switches
them back. Small stick noise and connection alone do not switch the active prompts.

## Options

The same controller navigator owns the direct drawer and the pause-menu Options
view. Up/Down wraps through visible controls; Left/Right changes one schema step,
RB changes ten steps, and discrete parameters advance one allowed value. Logarithmic
sliders use parameter units, not their internal 0–1000 DOM coordinate. A activates,
B goes back, X resets the focused parameter, Y selects search, and LT/RT jump sections.

A on search or Save as opens an in-page controller keyboard. It is limited to search
and preset names, with Space, Backspace, Clear, Done and Cancel. It stays inside the
existing Options panel and makes its sibling sections inert; it owns no pause request.
Native file picker interaction remains browser/OS-owned. Keyboard and pointer users
retain their normal input controls and native preset-name prompt.

## Haptics

hapticsIntensity is schema-owned: Input group, range 0–1, step 0.05, default **0.35**,
not Quick Tune. It participates in presets, autosave, A/B, share and complete script
headers. Zero cancels all effects. Optional hardware failure never interrupts gameplay.

ControllerHaptics.afterStep(dtSeconds) reads live telemetry synchronously, including
wheelspin and **grounded** wheel contact coordinates passed to isOnKerb(x,z). The
world query owns the rendered kerb footprint. No colliders, grip values, surface IDs,
or duplicate ring dimensions are introduced by feedback.

Boot forwards its existing contact callback to onImpact(impulse, normalWorld, massKg).
The normal points from the other surface into our vehicle. A null impulse uses
pre-step vehicle velocity against a static obstacle: this is estimated approach
speed, not a measured solved contact impulse. Borrowed vectors are read immediately;
no past sample aliases live telemetry.

Browser dual-rumble requests happen only in RAF update, at most 20 Hz and at most
80 ms each. Pause/UI capture, reset, zero intensity, disconnect and disposal stop
feedback. Rejections/unsupported actuators show unavailable feedback and cannot
flood retries. API reference: https://www.w3.org/TR/gamepad/#gamepadhapticactuator-interface

## Boot composition

mountControllerSupport is in src/ui/controllerSupport.ts. Inject host, input,
tuning, options, pauseMenu, readTelemetry, readPaused, and isOnKerb.
Call update(nowMs) once after command polling and pauseMenu.update, including
paused frames; call afterStep(dtSeconds) after vehicle post-step/timing and before
script EOF. Call reset() on ordinary/script respawn, and dispose before Options and
PauseMenu. Boot remains the sole pause aggregator, action dispatcher and contact
subscriber. The physics adapter supports one contact callback; never replace it with
a haptics-only registration.
