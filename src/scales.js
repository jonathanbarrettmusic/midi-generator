/**
 * scales.js — Scale library for the MIDI melody generator.
 *
 * Every scale is defined relative to root 0 (C). The pcs array is the
 * canonical representation. Intervals are the semitone gaps between adjacent
 * notes (including the wrap back to the octave), always summing to 12.
 *
 * tag values: modal | diatonic | pentatonic | hexatonic | octatonic | exotic
 *
 * Transposition: (pc + rootOffset) % 12  applied to each element of pcs.
 */

export const PITCH_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── Group 1: Major Modes ──────────────────────────────────────────────────────

const MAJOR_MODES = [
  {
    name: 'Major',
    pcs: [0, 2, 4, 5, 7, 9, 11],
    intervals: [2, 2, 1, 2, 2, 2, 1],
    tag: 'modal',
    desc: 'Bright and stable — the archetypal Western scale, widely familiar.',
  },
  {
    name: 'Dorian',
    pcs: [0, 2, 3, 5, 7, 9, 10],
    intervals: [2, 1, 2, 2, 2, 1, 2],
    tag: 'modal',
    desc: 'Minor with a raised sixth — soulful and bluesy with an open, hopeful quality.',
  },
  {
    name: 'Phrygian',
    pcs: [0, 1, 3, 5, 7, 8, 10],
    intervals: [1, 2, 2, 2, 1, 2, 2],
    tag: 'modal',
    desc: 'Dark and Spanish-flavoured — the lowered second creates characteristic tension.',
  },
  {
    name: 'Lydian',
    pcs: [0, 2, 4, 6, 7, 9, 11],
    intervals: [2, 2, 2, 1, 2, 2, 1],
    tag: 'modal',
    desc: 'Dreamy and floating — the raised fourth gives a bright, ethereal lift.',
  },
  {
    name: 'Mixolydian',
    pcs: [0, 2, 4, 5, 7, 9, 10],
    intervals: [2, 2, 1, 2, 2, 1, 2],
    tag: 'modal',
    desc: 'Major with a lowered seventh — rockish, folk-like, and grounded.',
  },
  {
    name: 'Natural Minor',
    pcs: [0, 2, 3, 5, 7, 8, 10],
    intervals: [2, 1, 2, 2, 1, 2, 2],
    tag: 'modal',
    desc: 'The Aeolian mode — melancholic, deeply expressive, and widely used.',
  },
  {
    name: 'Locrian',
    pcs: [0, 1, 3, 5, 6, 8, 10],
    intervals: [1, 2, 2, 1, 2, 2, 2],
    tag: 'modal',
    desc: 'Unstable and tense — the diminished fifth makes it restless and unresolved.',
  },
];

// ── Group 2: Melodic Minor Modes ──────────────────────────────────────────────

const MELODIC_MINOR_MODES = [
  {
    name: 'Melodic Minor',
    pcs: [0, 2, 3, 5, 7, 9, 11],
    intervals: [2, 1, 2, 2, 2, 2, 1],
    tag: 'modal',
    desc: 'Minor with raised sixth and seventh — lyrical, bittersweet, and expressive.',
  },
  {
    name: 'Dorian b2',
    pcs: [0, 1, 3, 5, 7, 9, 10],
    intervals: [1, 2, 2, 2, 2, 1, 2],
    tag: 'modal',
    desc: 'Phrygian with a natural sixth — exotic and subtly mysterious.',
  },
  {
    name: 'Lydian Augmented',
    pcs: [0, 2, 4, 6, 8, 9, 11],
    intervals: [2, 2, 2, 2, 1, 2, 1],
    tag: 'modal',
    desc: 'Lydian with a raised fifth — ethereal, expansive, and otherworldly.',
  },
  {
    name: 'Lydian Dominant',
    pcs: [0, 2, 4, 6, 7, 9, 10],
    intervals: [2, 2, 2, 1, 2, 1, 2],
    tag: 'modal',
    desc: 'The tritone scale — jazz-inflected and dominant-flavoured with a bluesy edge.',
  },
  {
    name: 'Mixolydian b6',
    pcs: [0, 2, 4, 5, 7, 8, 10],
    intervals: [2, 2, 1, 2, 1, 2, 2],
    tag: 'modal',
    desc: 'Melodic major descending — a blend of major brightness and minor darkness.',
  },
  {
    name: 'Locrian #2',
    pcs: [0, 2, 3, 5, 6, 8, 10],
    intervals: [2, 1, 2, 1, 2, 2, 2],
    tag: 'modal',
    desc: 'Half-diminished feel with a natural second — tense but approachable.',
  },
  {
    name: 'Altered',
    pcs: [0, 1, 3, 4, 6, 8, 10],
    intervals: [1, 2, 1, 2, 2, 2, 2],
    tag: 'modal',
    desc: 'Super Locrian — every available tension, used over dominant chords in jazz.',
  },
];

// ── Group 3: Harmonic Scales ──────────────────────────────────────────────────

const HARMONIC_SCALES = [
  {
    name: 'Harmonic Minor',
    pcs: [0, 2, 3, 5, 7, 8, 11],
    intervals: [2, 1, 2, 2, 1, 3, 1],
    tag: 'diatonic',
    desc: 'Minor with a raised seventh — dramatic, with a characteristic augmented second.',
  },
  {
    name: 'Harmonic Major',
    pcs: [0, 2, 4, 5, 7, 8, 11],
    intervals: [2, 2, 1, 2, 1, 3, 1],
    tag: 'diatonic',
    desc: 'Major with a lowered sixth — warm and bright with a touch of exotic colour.',
  },
  {
    name: 'Phrygian Dominant',
    pcs: [0, 1, 4, 5, 7, 8, 10],
    intervals: [1, 3, 1, 2, 1, 2, 2],
    tag: 'diatonic',
    desc: 'Fifth mode of harmonic minor — Spanish, Flamenco, and Middle Eastern in character.',
  },
  {
    name: 'Double Harmonic Major',
    pcs: [0, 1, 4, 5, 7, 8, 11],
    intervals: [1, 3, 1, 2, 1, 3, 1],
    tag: 'diatonic',
    desc: 'Byzantine scale — symmetrical, ancient-sounding, and intensely exotic.',
  },
  {
    name: 'Hungarian Minor',
    pcs: [0, 2, 3, 6, 7, 8, 11],
    intervals: [2, 1, 3, 1, 1, 3, 1],
    tag: 'diatonic',
    desc: 'Harmonic minor with a raised fourth — vivid, dramatic, and folk-inflected.',
  },
  {
    name: 'Neapolitan Minor',
    pcs: [0, 1, 3, 5, 7, 8, 11],
    intervals: [1, 2, 2, 2, 1, 3, 1],
    tag: 'diatonic',
    desc: 'Lowered second and sixth — lush and Romantic with an operatic grandeur.',
  },
];

// ── Group 4: Pentatonic & Blues ───────────────────────────────────────────────

const PENTATONIC_BLUES = [
  {
    name: 'Major Pentatonic',
    pcs: [0, 2, 4, 7, 9],
    intervals: [2, 2, 3, 2, 3],
    tag: 'pentatonic',
    desc: 'Five notes of universal appeal — uplifting, singable, and consonant.',
  },
  {
    name: 'Minor Pentatonic',
    pcs: [0, 3, 5, 7, 10],
    intervals: [3, 2, 2, 3, 2],
    tag: 'pentatonic',
    desc: 'The blues and rock backbone — gritty, soulful, and endlessly versatile.',
  },
  {
    name: 'Blues',
    pcs: [0, 3, 5, 6, 7, 10],
    intervals: [3, 2, 1, 1, 3, 2],
    tag: 'hexatonic',
    desc: 'Minor pentatonic with the blue note — raw, expressive, and improvisatory.',
  },
  {
    name: 'Major Blues',
    pcs: [0, 2, 3, 4, 7, 9],
    intervals: [2, 1, 1, 3, 2, 3],
    tag: 'hexatonic',
    desc: 'Major pentatonic with the blue note — bright but with a country-blues inflection.',
  },
  {
    name: 'Hirajoshi',
    pcs: [0, 2, 3, 7, 8],
    intervals: [2, 1, 4, 1, 4],
    tag: 'pentatonic',
    desc: 'Japanese koto scale — sparse, introspective, and hauntingly beautiful.',
  },
  {
    name: 'Egyptian',
    pcs: [0, 2, 5, 7, 10],
    intervals: [2, 3, 2, 3, 2],
    tag: 'pentatonic',
    desc: 'Suspended pentatonic — ancient-feeling, open, and modal.',
  },
  {
    name: 'Insen',
    pcs: [0, 1, 5, 7, 10],
    intervals: [1, 4, 2, 3, 2],
    tag: 'pentatonic',
    desc: 'Japanese scale with a stark minor second — delicate and melancholic.',
  },
];

// ── Group 5: Symmetrical Scales ───────────────────────────────────────────────

const SYMMETRICAL = [
  {
    name: 'Whole Tone',
    pcs: [0, 2, 4, 6, 8, 10],
    intervals: [2, 2, 2, 2, 2, 2],
    tag: 'hexatonic',
    desc: 'Six equal steps — ambiguous and dreamlike with no tonal centre.',
  },
  {
    name: 'Diminished HW',
    pcs: [0, 1, 3, 4, 6, 7, 9, 10],
    intervals: [1, 2, 1, 2, 1, 2, 1, 2],
    tag: 'octatonic',
    desc: 'Half-whole diminished — tense and symmetrical, used in jazz and horror scores.',
  },
  {
    name: 'Diminished WH',
    pcs: [0, 2, 3, 5, 6, 8, 9, 11],
    intervals: [2, 1, 2, 1, 2, 1, 2, 1],
    tag: 'octatonic',
    desc: 'Whole-half diminished — dominant-flavoured, rich in colour tones.',
  },
  {
    name: 'Augmented',
    pcs: [0, 3, 4, 7, 8, 11],
    intervals: [3, 1, 3, 1, 3, 1],
    tag: 'hexatonic',
    desc: 'Alternating minor thirds and semitones — lush, unstable, harmonically rich.',
  },
  {
    name: 'Prometheus',
    pcs: [0, 2, 4, 6, 9, 10],
    intervals: [2, 2, 2, 3, 1, 2],
    tag: 'hexatonic',
    desc: "Scriabin's mystic scale — shimmering, modern, and harmonically ambiguous.",
  },
  {
    name: 'Tritone',
    pcs: [0, 1, 4, 6, 7, 10],
    intervals: [1, 3, 2, 1, 3, 2],
    tag: 'hexatonic',
    desc: 'Built from two interlocking tritones — sharp, angular, and dissonant.',
  },
];

// ── Group 6: Exotic & World Scales ────────────────────────────────────────────

const EXOTIC = [
  {
    name: 'Persian',
    pcs: [0, 1, 4, 5, 6, 8, 11],
    intervals: [1, 3, 1, 1, 2, 3, 1],
    tag: 'exotic',
    desc: 'Ancient Middle Eastern — two augmented seconds give an intense, searching character.',
  },
  {
    name: 'Romanian Minor',
    pcs: [0, 2, 3, 6, 7, 9, 10],
    intervals: [2, 1, 3, 1, 2, 1, 2],
    tag: 'exotic',
    desc: 'Dorian with a raised fourth — folk-flavoured, Eastern European, and vivid.',
  },
  {
    name: 'Neapolitan Major',
    pcs: [0, 1, 3, 5, 7, 9, 11],
    intervals: [1, 2, 2, 2, 2, 2, 1],
    tag: 'exotic',
    desc: 'Lowered second with an otherwise bright major feel — lush and Romantic.',
  },
  {
    name: 'Arabian',
    pcs: [0, 2, 4, 5, 6, 8, 10],
    intervals: [2, 2, 1, 1, 2, 2, 2],
    tag: 'exotic',
    desc: 'Middle Eastern character with a characteristic flattened fifth region.',
  },
  {
    name: 'Iwato',
    pcs: [0, 1, 5, 6, 10],
    intervals: [1, 4, 1, 4, 2],
    tag: 'exotic',
    desc: 'Austere Japanese scale built on fourths — sparse and meditative.',
  },
  {
    name: 'Balinese',
    pcs: [0, 1, 3, 7, 8],
    intervals: [1, 2, 4, 1, 4],
    tag: 'exotic',
    desc: 'Gamelan-inspired — wide intervals and a haunting, ceremonial character.',
  },
  {
    name: 'Chinese',
    pcs: [0, 4, 6, 7, 11],
    intervals: [4, 2, 1, 4, 1],
    tag: 'exotic',
    desc: 'Pentatonic with large leaps — bright, angular, and distinctly Eastern.',
  },
  {
    name: 'Hungarian Major',
    pcs: [0, 3, 4, 6, 7, 9, 10],
    intervals: [3, 1, 2, 1, 2, 1, 2],
    tag: 'exotic',
    desc: 'Bold and colourful — raised fourth and lowered seventh give it dramatic flair.',
  },
];

// ── Assembled Library ─────────────────────────────────────────────────────────

export const SCALES = [
  ...MAJOR_MODES,
  ...MELODIC_MINOR_MODES,
  ...HARMONIC_SCALES,
  ...PENTATONIC_BLUES,
  ...SYMMETRICAL,
  ...EXOTIC,
];

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Transpose a scale to a new root pitch class.
 * Returns a new pcs array with the root at rootPc.
 *
 * @param {object} scale  - A scale object from SCALES
 * @param {number} rootPc - Root pitch class (0–11)
 * @returns {number[]}
 */
export function transpose(scale, rootPc) {
  return scale.pcs.map(pc => (pc + rootPc) % 12);
}

/**
 * Look up a scale definition by name (case-insensitive).
 *
 * @param {string} name
 * @returns {object|null}
 */
export function getScale(name) {
  return SCALES.find(s => s.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/**
 * Return all scales with a given tag.
 *
 * @param {string} tag - modal | diatonic | pentatonic | hexatonic | octatonic | exotic
 * @returns {object[]}
 */
export function listByTag(tag) {
  return SCALES.filter(s => s.tag === tag);
}

/**
 * Return pitch names for a scale transposed to a given root.
 *
 * @param {object} scale
 * @param {number} rootPc
 * @returns {string[]}
 *
 * @example
 * scalePitchNames(getScale('Major'), 2) // → ['D','E','F#','G','A','B','C#']
 */
export function scalePitchNames(scale, rootPc = 0) {
  return transpose(scale, rootPc).map(pc => PITCH_NAMES[pc]);
}

/**
 * Validate that all scales in the library have internally consistent data.
 * Throws if any scale fails. Useful during development.
 */
export function validateLibrary() {
  for (const s of SCALES) {
    const intervalSum = s.intervals.reduce((a, b) => a + b, 0);
    if (intervalSum !== 12) {
      throw new Error(`${s.name}: intervals sum to ${intervalSum}, expected 12`);
    }
    if (s.intervals.length !== s.pcs.length) {
      throw new Error(`${s.name}: intervals.length (${s.intervals.length}) !== pcs.length (${s.pcs.length})`);
    }
    if (s.pcs[0] !== 0) {
      throw new Error(`${s.name}: pcs[0] must be 0 (root)`);
    }
    // Verify intervals derive from pcs
    for (let i = 0; i < s.pcs.length; i++) {
      const next = (i + 1 < s.pcs.length) ? s.pcs[i + 1] : s.pcs[0] + 12;
      const expected = next - s.pcs[i];
      if (expected !== s.intervals[i]) {
        throw new Error(`${s.name}: interval[${i}] should be ${expected}, got ${s.intervals[i]}`);
      }
    }
  }
  return true;
}
