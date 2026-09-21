/** Content identities are persistent: append IDs, never reorder or reuse them. */
export const SURFACE_IDS = Object.freeze({
  asphalt: 0,
  kerb: 1,
  concrete: 2,
} as const);
export type SurfaceId = (typeof SURFACE_IDS)[keyof typeof SURFACE_IDS];
export type SurfaceKey = keyof typeof SURFACE_IDS;
export type SurfaceProfileKey = 'asphalt' | 'kerb' | 'concrete';

/** UV content is in metres; actual texture/material objects belong to rendering. */
export const SURFACE_UV_REFERENCES = Object.freeze({
  'asphalt-world': Object.freeze({
    mapping: 'world-xz',
    tileMeters: 8,
  } as const),
  untextured: Object.freeze({ mapping: 'none', tileMeters: null } as const),
});

interface SurfaceCommon {
  readonly id: SurfaceId;
  readonly key: SurfaceKey;
  readonly visual: Readonly<{
    materialKey: SurfaceKey;
    uvKey: keyof typeof SURFACE_UV_REFERENCES;
  }>;
  readonly audioProfile: SurfaceProfileKey;
  readonly fxProfile: SurfaceProfileKey;
  readonly hapticProfile: 'smooth' | 'kerb' | 'solid';
}
export interface GroundSurfaceDefinition extends SurfaceCommon {
  readonly context: 'ground';
  /** Multiplies, never replaces, the live global surfaceGrip tuning control. */
  readonly gripMultiplier: number;
}
export interface ContactSurfaceDefinition extends SurfaceCommon {
  readonly context: 'contact';
  /** Impact/scrape material only. A tyre grip setting has no meaning here. */
  readonly gripMultiplier: null;
}
export type SurfaceDefinition =
  GroundSurfaceDefinition | ContactSurfaceDefinition;

/** Frozen plain data. No renderer, physics or audio implementation objects. */
export const SURFACE_DEFINITIONS: readonly SurfaceDefinition[] = Object.freeze([
  Object.freeze({
    id: SURFACE_IDS.asphalt,
    key: 'asphalt',
    context: 'ground',
    gripMultiplier: 1,
    visual: Object.freeze({ materialKey: 'asphalt', uvKey: 'asphalt-world' }),
    audioProfile: 'asphalt',
    fxProfile: 'asphalt',
    hapticProfile: 'smooth',
  } as const),
  Object.freeze({
    id: SURFACE_IDS.kerb,
    key: 'kerb',
    context: 'ground',
    gripMultiplier: 1,
    visual: Object.freeze({ materialKey: 'kerb', uvKey: 'untextured' }),
    audioProfile: 'kerb',
    fxProfile: 'kerb',
    hapticProfile: 'kerb',
  } as const),
  Object.freeze({
    id: SURFACE_IDS.concrete,
    key: 'concrete',
    context: 'contact',
    gripMultiplier: null,
    visual: Object.freeze({ materialKey: 'concrete', uvKey: 'untextured' }),
    audioProfile: 'concrete',
    fxProfile: 'concrete',
    hapticProfile: 'solid',
  } as const),
]);

/** SETUP ONLY. Check authored content before constructing the simulation. */
export function validateSurfaceCatalog(): void {
  const keys = new Set<string>();
  for (let id = 0; id < SURFACE_DEFINITIONS.length; id++) {
    const surface = SURFACE_DEFINITIONS[id]!;
    if (
      surface.id !== id ||
      SURFACE_IDS[surface.key] !== id ||
      keys.has(surface.key)
    )
      throw new RangeError(
        'Surface IDs must be unique, dense and match their stable keys',
      );
    keys.add(surface.key);
    if (!(surface.visual.uvKey in SURFACE_UV_REFERENCES))
      throw new RangeError('Unknown surface UV reference');
    if (
      surface.context === 'ground'
        ? !Number.isFinite(surface.gripMultiplier) || surface.gripMultiplier < 0
        : surface.gripMultiplier !== null
    )
      throw new RangeError(
        'Ground grip must be finite and nonnegative; contact grip must be null',
      );
  }
}
validateSurfaceCatalog();

/** SETUP/DIAGNOSTICS ONLY: invalid IDs throw. Never call in a physics step. */
export function getSurfaceDefinition(id: number): SurfaceDefinition {
  if (!Number.isInteger(id) || id < 0 || id >= SURFACE_DEFINITIONS.length)
    throw new RangeError('Unknown surface ID: ' + id);
  return SURFACE_DEFINITIONS[id]!;
}

/** HOT PATH: indexed read for an ID proven by the validated catalog/body registry.
 * Do not cast a raw physics number to SurfaceId to bypass that proof. */
export function getKnownSurfaceDefinition(id: SurfaceId): SurfaceDefinition {
  return SURFACE_DEFINITIONS[id]!;
}

/** HOT PATH: no throw/allocation/fallback. Airborne never consults a stale ID.
 * null means no tyre surface: airborne, unresolved ID, or impact-only material.
 * The wheel grounded flag and resolver diagnostics distinguish those cases. */
export function resolveGroundedSurface(
  grounded: boolean,
  id: number | null,
): GroundSurfaceDefinition | null {
  if (
    !grounded ||
    id === null ||
    !Number.isInteger(id) ||
    id < 0 ||
    id >= SURFACE_DEFINITIONS.length
  )
    return null;
  const surface = SURFACE_DEFINITIONS[id]!;
  return surface.context === 'ground' ? surface : null;
}

/** Structural view of a borrowed physics ray result; all distances in metres. */
export interface SurfaceHit {
  readonly distance: number;
  readonly bodyId: number;
  /** Raw engine metadata is deliberately not trusted by the world resolver. */
  readonly surfaceId: number;
  readonly point: Readonly<{ x: number; y: number; z: number }>;
  readonly normal: Readonly<{ x: number; y: number; z: number }>;
}
export type SurfaceResolutionStatus =
  'resolved' | 'airborne' | 'unknown-body' | 'invalid-hit' | 'disposed';
/** Readonly LIVE record, reused by the resolver; copy scalars for history. */
export interface SurfaceResolverDiagnostics {
  /** MOST RECENT synchronous call across ALL wheels, not a per-wheel status. */
  readonly lastStatus: SurfaceResolutionStatus;
  /** Latched only on the first unknown body, never overwritten per step. */
  readonly unknownBodySeen: boolean;
  readonly firstUnknownBodyId: number | null;
  readonly invalidHitSeen: boolean;
}
export interface SurfaceResolver {
  (grounded: boolean, hit: Readonly<SurfaceHit>): SurfaceId | null;
  readonly diagnostics: SurfaceResolverDiagnostics;
  /** Immediately marks retained diagnostic references disposed; idempotent. */
  dispose(): void;
}
