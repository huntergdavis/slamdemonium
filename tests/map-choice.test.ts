import { describe, expect, it } from 'vitest';
import {
  chooseMapName,
  MAP_CHOICE_KEY,
  mapUrl,
  readStoredMapName,
  shouldOfferMapsAtBoot,
  storeMapName,
} from '../src/world/mapChoice';

function memory(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(MAP_CHOICE_KEY, initial);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    store,
  };
}

describe('the level select memory', () => {
  it('reads only real map names, and survives storage that throws or is missing', () => {
    expect(readStoredMapName(memory('circuit'))).toBe('circuit');
    expect(readStoredMapName(memory('nonsense'))).toBeUndefined();
    expect(readStoredMapName(null)).toBeUndefined();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredMapName(broken)).toBeUndefined();
    expect(() => storeMapName(broken, 'circuit')).not.toThrow();
    const m = memory();
    storeMapName(m, 'circuit');
    expect(m.store.get(MAP_CHOICE_KEY)).toBe('circuit');
  });

  it('chooses the URL first, then the build default, then the memory, then the proving ground', () => {
    expect(chooseMapName('?map=lab', 'circuit', 'circuit')).toBe('lab');
    expect(chooseMapName('', 'lab', 'circuit')).toBe('lab');
    expect(chooseMapName('', undefined, 'circuit')).toBe('circuit');
    expect(chooseMapName('', undefined, undefined)).toBe('proving-ground');
    expect(chooseMapName('?map=bogus', undefined, undefined)).toBe(
      'proving-ground',
    );
  });

  it('offers the list at boot only on a first boot with nothing chosen', () => {
    expect(shouldOfferMapsAtBoot('', undefined, undefined)).toBe(true);
    expect(shouldOfferMapsAtBoot('', undefined, 'circuit')).toBe(false);
    expect(shouldOfferMapsAtBoot('?map=circuit', undefined, undefined)).toBe(
      false,
    );
    expect(shouldOfferMapsAtBoot('', 'lab', undefined)).toBe(false); // The e2e build never prompts.
  });

  it('builds the boot URL for a map', () => {
    expect(mapUrl('/slamdemonium/', 'circuit')).toBe(
      '/slamdemonium/?map=circuit',
    );
  });
});
