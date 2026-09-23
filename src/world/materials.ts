import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { createAsphaltTexture } from '../../assets/procedural/asphalt';
import type { AsphaltOptions } from '../../assets/procedural/asphalt';
import type { TrackConfig } from './trackConfig';
import { getKnownSurfaceDefinition } from '../content/surfaces';
import type { SurfaceId } from '../content/surfaces';

export const WORLD_COLORS = Object.freeze({
  paint: 0xf2f4ec,
  curbRed: 0xce3545,
  postCyan: 0x3ed8ee,
  fog: 0xb8c7cc,
  ground: 0x6d7779,
  // Saturated so it survives multiplication by the grey asphalt texture and
  // reads as a different surface from 380 m away in the fog.
  stickyAsphalt: 0x4fb0ff,
});

/** CPU generation occurs once here; renderer uploads on first render. */
export function createTrackMaterials(
  config: Readonly<TrackConfig>,
  maxAnisotropy: number,
  asphaltOptions: AsphaltOptions = {},
) {
  if (!Number.isFinite(maxAnisotropy) || maxAnisotropy < 1)
    throw new RangeError('maxAnisotropy must be at least one');
  const pixels = createAsphaltTexture(asphaltOptions);
  const map = new DataTexture(
    pixels.data,
    pixels.width,
    pixels.height,
    RGBAFormat,
    UnsignedByteType,
  );
  map.name = 'track.asphalt';
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.set(
    (2 * config.pavedRadius) / config.tileMeters,
    (2 * config.pavedRadius) / config.tileMeters,
  );
  map.generateMipmaps = true;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.anisotropy = maxAnisotropy;
  map.needsUpdate = true;
  const materials = {
    asphalt: new MeshStandardMaterial({
      map,
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    }),
    ground: new MeshStandardMaterial({
      color: WORLD_COLORS.ground,
      roughness: 1,
    }),
    // The sticky loop surface: the same asphalt texture with a visible tint,
    // so the driver can see where the extra grip is.
    stickyAsphalt: new MeshStandardMaterial({
      map,
      color: WORLD_COLORS.stickyAsphalt,
      emissive: WORLD_COLORS.stickyAsphalt,
      emissiveIntensity: 0.12,
      roughness: 0.8,
      metalness: 0,
    }),
    paint: new MeshBasicMaterial({
      color: WORLD_COLORS.paint,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    skidpad: new MeshBasicMaterial({
      color: WORLD_COLORS.paint,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    curb: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    post: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    barrier: new MeshStandardMaterial({
      color: WORLD_COLORS.ground,
      roughness: 0.95,
    }),
  };
  const surfaceMaterials = {
    asphalt: materials.asphalt,
    kerb: materials.curb,
    concrete: materials.barrier,
    stickyAsphalt: materials.stickyAsphalt,
  };
  let disposed = false;
  return {
    ...materials,
    map,
    /** Shared content selects a renderer-owned object, never the reverse. */
    forSurface(id: SurfaceId): MeshStandardMaterial {
      return surfaceMaterials[getKnownSurfaceDefinition(id).visual.materialKey];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) material.dispose();
      map.dispose();
    },
  };
}
