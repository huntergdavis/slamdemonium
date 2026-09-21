import { node } from './paramControl';
import kenneyLicenseUrl from '../../assets/audio/KENNEY-LICENSE.txt?url&no-inline';
import howlerLicenseUrl from '../../assets/audio/HOWLER-LICENSE.txt?url&no-inline';

/** Player-visible attribution ships with the audio, inside the pad-scrollable
 * Controls view. Asset fetch dates, original hashes and exact transforms live
 * beside the shipped files in assets/audio/manifest.json. */
export function createAudioCredits(doc: Document): HTMLElement {
  const section = node(doc, 'section', 'sl-caption');
  section.setAttribute('aria-label', 'Sound credits');
  section.append(node(doc, 'h3', 'sl-heading', 'Sound credits'));
  const entry = (
    title: string,
    creators: string,
    source: string,
    license: string,
    licenseUrl: string,
    edits: string,
  ) => {
    const paragraph = node(doc, 'p');
    paragraph.append(
      node(doc, 'strong', '', title),
      doc.createTextNode(' — ' + creators + '. '),
      link(doc, 'Source', source),
      doc.createTextNode(' · '),
      link(doc, license, licenseUrl),
      doc.createTextNode('. ' + edits),
    );
    section.append(paragraph);
  };
  entry(
    'Car tire squeal skid loop',
    'audible-edge (Tom Haigh); loop edited by qubodup',
    'https://opengameart.org/content/car-tire-squeal-skid-loop',
    'CC BY 3.0',
    'https://creativecommons.org/licenses/by/3.0/',
    'Slamdemonium resamples the three-second loop to mono 48 kHz and encodes it as Ogg Vorbis. Playback pitch and volume vary in game.',
  );
  entry(
    'Impact Sounds',
    'Kenney',
    'https://kenney.nl/assets/impact-sounds',
    'CC0',
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'Selected impacts are resampled to mono 48 kHz and encoded as Ogg Vorbis.',
  );
  const kenneyNotice = node(doc, 'p');
  kenneyNotice.append(
    link(doc, 'Full Kenney licence notice', kenneyLicenseUrl),
  );
  section.append(kenneyNotice);
  entry(
    'Howler.js 2.2.4',
    'Copyright 2013–2020 James Simpson and GoldFire Studios, Inc.',
    'https://github.com/goldfire/howler.js',
    'MIT licence and full notice',
    howlerLicenseUrl,
    'Used without source modifications.',
  );
  return section;
}

function link(doc: Document, label: string, href: string): HTMLAnchorElement {
  const anchor = node(doc, 'a', '', label);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}
