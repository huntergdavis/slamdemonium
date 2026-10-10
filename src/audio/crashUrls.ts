/** URL imports do not fetch audio; Howler loads core clips only after activation. */
import clip_light_ogg from '../../assets/audio/crash-light.ogg?url&no-inline';
import clip_light_mp3 from '../../assets/audio/crash-light.mp3?url&no-inline';
import clip_tick_ogg from '../../assets/audio/crash-tick.ogg?url&no-inline';
import clip_tick_mp3 from '../../assets/audio/crash-tick.mp3?url&no-inline';
import clip_attack_ogg from '../../assets/audio/crash-attack.ogg?url&no-inline';
import clip_attack_mp3 from '../../assets/audio/crash-attack.mp3?url&no-inline';
import clip_bend_ogg from '../../assets/audio/crash-bend.ogg?url&no-inline';
import clip_bend_mp3 from '../../assets/audio/crash-bend.mp3?url&no-inline';
import clip_can_ogg from '../../assets/audio/crash-can.ogg?url&no-inline';
import clip_can_mp3 from '../../assets/audio/crash-can.mp3?url&no-inline';
import clip_heavy_ogg from '../../assets/audio/crash-heavy.ogg?url&no-inline';
import clip_heavy_mp3 from '../../assets/audio/crash-heavy.mp3?url&no-inline';
import clip_glass_ogg from '../../assets/audio/crash-glass.ogg?url&no-inline';
import clip_glass_mp3 from '../../assets/audio/crash-glass.mp3?url&no-inline';
import clip_scrape_ogg from '../../assets/audio/crash-scrape.ogg?url&no-inline';
import clip_scrape_mp3 from '../../assets/audio/crash-scrape.mp3?url&no-inline';
import clip_rattle_ogg from '../../assets/audio/crash-rattle.ogg?url&no-inline';
import clip_rattle_mp3 from '../../assets/audio/crash-rattle.mp3?url&no-inline';
import clip_bass_ogg from '../../assets/audio/crash-bass.ogg?url&no-inline';
import clip_bass_mp3 from '../../assets/audio/crash-bass.mp3?url&no-inline';
import clip_creak_ogg from '../../assets/audio/crash-creak.ogg?url&no-inline';
import clip_creak_mp3 from '../../assets/audio/crash-creak.mp3?url&no-inline';
import clip_hard_alt_ogg from '../../assets/audio/crash-hard-alt.ogg?url&no-inline';
import clip_hard_alt_mp3 from '../../assets/audio/crash-hard-alt.mp3?url&no-inline';
import clip_wall_tail_ogg from '../../assets/audio/crash-wall-tail.ogg?url&no-inline';
import clip_wall_tail_mp3 from '../../assets/audio/crash-wall-tail.mp3?url&no-inline';
import clip_distant_ogg from '../../assets/audio/crash-distant.ogg?url&no-inline';
import clip_distant_mp3 from '../../assets/audio/crash-distant.mp3?url&no-inline';

export const CRASH_URLS = {
  light: [clip_light_ogg, clip_light_mp3],
  tick: [clip_tick_ogg, clip_tick_mp3],
  attack: [clip_attack_ogg, clip_attack_mp3],
  bend: [clip_bend_ogg, clip_bend_mp3],
  can: [clip_can_ogg, clip_can_mp3],
  heavy: [clip_heavy_ogg, clip_heavy_mp3],
  glass: [clip_glass_ogg, clip_glass_mp3],
  scrape: [clip_scrape_ogg, clip_scrape_mp3],
  rattle: [clip_rattle_ogg, clip_rattle_mp3],
  bass: [clip_bass_ogg, clip_bass_mp3],
  creak: [clip_creak_ogg, clip_creak_mp3],
  'hard-alt': [clip_hard_alt_ogg, clip_hard_alt_mp3],
  'wall-tail': [clip_wall_tail_ogg, clip_wall_tail_mp3],
  distant: [clip_distant_ogg, clip_distant_mp3],
} as const;
export type CrashClip = keyof typeof CRASH_URLS;
