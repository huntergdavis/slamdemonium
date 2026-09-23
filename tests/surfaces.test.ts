import { describe, expect, it } from 'vitest';
import {
  SURFACE_DEFINITIONS,
  SURFACE_IDS,
  SURFACE_UV_REFERENCES,
  getSurfaceDefinition,
  getKnownSurfaceDefinition,
  resolveGroundedSurface,
  validateSurfaceCatalog,
} from '../src/content/surfaces';
import { resolveTrackConfig } from '../src/world/trackConfig';

describe('shared surface content', () => {
  it('keeps stable identities and behaviour-neutral ground grip, with no pretend wall grip', () => {
    expect(SURFACE_IDS).toEqual({
      asphalt: 0,
      kerb: 1,
      concrete: 2,
      stickyAsphalt: 3,
    });
    expect(() => validateSurfaceCatalog()).not.toThrow();
    for (const definition of SURFACE_DEFINITIONS) {
      expect(getSurfaceDefinition(definition.id)).toBe(definition);
      expect(getKnownSurfaceDefinition(definition.id)).toBe(definition);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.visual)).toBe(true);
      // Sounds and effects follow the material family: sticky asphalt is
      // still asphalt to the ear.
      const family =
        definition.key === 'stickyAsphalt' ? 'asphalt' : definition.key;
      expect(definition.audioProfile).toBe(family);
      expect(definition.fxProfile).toBe(family);
      expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    }
    expect(resolveGroundedSurface(true, 0)?.gripMultiplier).toBe(1);
    expect(resolveGroundedSurface(true, 1)?.gripMultiplier).toBe(1);
    expect(getSurfaceDefinition(2)).toMatchObject({
      context: 'contact',
      gripMultiplier: null,
    });
    expect(resolveGroundedSurface(true, 2)).toBeNull();
    expect(
      SURFACE_UV_REFERENCES[getSurfaceDefinition(0).visual.uvKey].tileMeters,
    ).toBe(8);
    expect(resolveTrackConfig().tileMeters).toBe(8);
  });

  it('separates strict startup failures from nullable, nonthrowing per-step resolution', () => {
    for (const invalid of [-1, 0.5, 4, 100, NaN, Infinity, -Infinity]) {
      expect(() => getSurfaceDefinition(invalid)).toThrow(RangeError);
      expect(() => resolveTrackConfig({ surfaceId: invalid })).toThrow(
        RangeError,
      );
      expect(resolveGroundedSurface(true, invalid)).toBeNull();
      expect(resolveGroundedSurface(false, invalid)).toBeNull();
    }
    expect(() => resolveTrackConfig({ surfaceId: 2 })).toThrow(
      /ground surface/,
    );
    expect(resolveGroundedSurface(true, null)).toBeNull();
    expect(resolveGroundedSurface(false, 1)).toBeNull();
  });
});
