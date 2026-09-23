import { describe, expect, it, vi } from 'vitest';
import { ImpactFeedback } from '../src/core/impactFeedback';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../src/core/impactSeverity';

function setup() {
  const camera = { addImpact: vi.fn() };
  const haptics = { onImpact: vi.fn() };
  const audio = { onImpact: vi.fn() };
  const feedback = new ImpactFeedback<'asphalt' | 'concrete'>({
    camera,
    haptics,
    audio,
  });
  const impact = estimateImpactSeverity(
    null,
    { x: 0, y: -6, z: -20 },
    { x: 0, y: 1, z: 0 },
    1300,
    createImpactSeverity(),
  );
  return { camera, haptics, audio, feedback, impact };
}

describe('impact feedback seam', () => {
  it('fires a landing once when nothing else reported this step', () => {
    const r = setup();
    expect(r.feedback.onLanding(7, 'asphalt', r.impact)).toBe(true);
    expect(r.camera.addImpact).toHaveBeenCalledTimes(1);
    expect(r.haptics.onImpact).toHaveBeenCalledTimes(1);
    expect(r.audio.onImpact).toHaveBeenCalledWith(7, 'asphalt', r.impact);
  });
  it('does not double-fire when a chassis contact already reported the same step', () => {
    const r = setup();
    r.feedback.onContact(7, 'concrete', r.impact); // Inside the step.
    expect(r.feedback.onLanding(7, 'asphalt', r.impact)).toBe(false); // After it.
    expect(r.camera.addImpact).toHaveBeenCalledTimes(1);
    expect(r.haptics.onImpact).toHaveBeenCalledTimes(1);
    expect(r.audio.onImpact).toHaveBeenCalledTimes(1);
    r.feedback.endStep();
    expect(r.feedback.onLanding(7, 'asphalt', r.impact)).toBe(true); // Next step is clean.
    expect(r.camera.addImpact).toHaveBeenCalledTimes(2);
  });
  it('lets every contact through: two wall hits in one step are two events', () => {
    const r = setup();
    r.feedback.onContact(7, 'concrete', r.impact);
    r.feedback.onContact(8, 'concrete', r.impact);
    expect(r.audio.onImpact).toHaveBeenCalledTimes(2);
  });
});
