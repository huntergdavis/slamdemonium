import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../src/tuning/presets';
import { DEFAULT_VALUES, PARAM_BY_KEY, PARAM_DEFS, isParamKey } from '../src/tuning/schema';

describe('tuning schema: design sections 7.2 and 13.1', () => {
  it('has all 69 unique keys, valid ranges, labels, units, and help', () => {
    expect(PARAM_DEFS).toHaveLength(69);
    expect(new Set(PARAM_DEFS.map((definition) => definition.key)).size).toBe(69);
    for (const definition of PARAM_DEFS) {
      expect(definition.default).toBeGreaterThanOrEqual(definition.min);
      expect(definition.default).toBeLessThanOrEqual(definition.max);
      expect(definition.step).toBeGreaterThan(0);
      expect(definition.label.trim()).not.toBe('');
      expect(definition.help.trim()).not.toBe('');
    }
  });

  it('matches every documented value, unit, flag and help string exactly', () => {
    const brief = readFileSync(new URL('../docs/vertical-slice-design.md', import.meta.url), 'utf8');
    const table = brief.split('### 7.2 The parameters')[1]?.split('The `quick` set')[0] ?? '';
    const rows = table.split('\n').filter((row) => /^\| [a-z]/.test(row));
    expect(rows).toHaveLength(69);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
      const [key = '', group, unit, initial, min, max, step, flags = '', help] = cells;
      expect(isParamKey(key)).toBe(true);
      if (!isParamKey(key)) continue;
      const definition = PARAM_BY_KEY[key];
      expect(definition).toMatchObject({ key, group, unit, default: Number(initial), min: Number(min), max: Number(max), help });
      expect(definition.quick === true).toBe(flags.includes('Q'));
      expect(definition.needsRebuild === true).toBe(flags.includes('R'));
      expect(definition.advanced === true).toBe(flags.includes('A'));
      if (step !== 'discrete') expect(definition.step).toBe(Number(step));
    }
    expect(PARAM_BY_KEY.physicsHz.discrete).toEqual([60, 90, 120, 180, 240]);
  });

  it('pins exactly the 14 specified Quick Tune controls', () => {
    expect(PARAM_DEFS.filter((definition) => definition.quick).map((definition) => definition.key)).toEqual([
      'gravity', 'accel0', 'topSpeed', 'brakeDecel', 'handbrakeRearGrip', 'gripFront', 'gripRear',
      'slideGripRatio', 'slipFalloffRate', 'downforceAtTopSpeed', 'steerMaxTopSpeed',
      'countersteerAssist', 'yawAssist', 'fovSpeedGain',
    ]);
  });

  it('ships Default, Grip, Drifty and Raw with known, in-range overrides', () => {
    expect(Object.keys(BUILTIN_PRESETS)).toEqual(['Default', 'Grip', 'Drifty', 'Raw']);
    expect(BUILTIN_PRESETS.Default).toEqual({});
    for (const preset of Object.values(BUILTIN_PRESETS)) {
      for (const [key, value] of Object.entries(preset)) {
        expect(isParamKey(key)).toBe(true);
        if (!isParamKey(key)) continue;
        expect(value).toBeGreaterThanOrEqual(PARAM_BY_KEY[key].min);
        expect(value).toBeLessThanOrEqual(PARAM_BY_KEY[key].max);
      }
    }
    expect(Object.keys(DEFAULT_VALUES)).toHaveLength(69);
    expect(isParamKey('__proto__')).toBe(false);
    expect(isParamKey('constructor')).toBe(false);
  });
});
