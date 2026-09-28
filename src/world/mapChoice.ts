import { DEFAULT_MAP_NAME, isMapName, type MapName } from './maps';

/** The level select's memory (NS2). The CTO asked to pick from a list; the
 * PM's rule is that booting straight into driving stays: the first boot
 * ever offers the list once, every boot after that goes to the map he last
 * chose, and the list is one press away in the pause menu. */
export const MAP_CHOICE_KEY = 'slamdemonium.map';

export interface MapChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage may throw (private windows, blocked storage): treat that as
 * no memory rather than a boot failure. */
export function readStoredMapName(
  storage: MapChoiceStorage | null,
): MapName | undefined {
  try {
    const value = storage?.getItem(MAP_CHOICE_KEY);
    return isMapName(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function storeMapName(
  storage: MapChoiceStorage | null,
  name: MapName,
): void {
  try {
    storage?.setItem(MAP_CHOICE_KEY, name);
  } catch {
    // Nothing to remember with; the URL still says.
  }
}

/** `?map=` in the URL wins, then the build's default (the e2e build), then
 * the remembered choice, then the proving ground. */
export function chooseMapName(
  search: string,
  buildDefault: unknown,
  stored: MapName | undefined,
): MapName {
  const requested = new URLSearchParams(search).get('map');
  if (isMapName(requested)) return requested;
  if (isMapName(buildDefault)) return buildDefault;
  return stored ?? DEFAULT_MAP_NAME;
}

/** Offer the list at boot only when nothing has chosen a map: no URL switch,
 * no build default, nothing remembered. After the first pick, never. */
export function shouldOfferMapsAtBoot(
  search: string,
  buildDefault: unknown,
  stored: MapName | undefined,
): boolean {
  const requested = new URLSearchParams(search).get('map');
  return (
    !isMapName(requested) && !isMapName(buildDefault) && stored === undefined
  );
}

/** The page URL that boots a map, keeping the path and dropping other query. */
export function mapUrl(pathname: string, name: MapName): string {
  return `${pathname}?map=${encodeURIComponent(name)}`;
}
