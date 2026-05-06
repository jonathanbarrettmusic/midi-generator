/**
 * chords.js — Chord progression engine.
 *
 * Builds diatonic chords from any scale and generates a functional chord
 * progression that ends with one of the four classical cadences.
 *
 * For 7-note (heptatonic) scales: full diatonic triads (I ii iii IV V vi vii°)
 * with Roman-numeral labels and standard functional voice-leading transitions.
 *
 * For all other scales: chord tones are derived from consonance relative to
 * each chord root using the same HARMONIC_TENSION table — notes within a
 * tension threshold of 0.4 (unison, fifth, third, sixth) become chord tones.
 * This produces usable "chord" groupings for pentatonic, hexatonic, etc.
 *
 * Cadences (final two chord slots):
 *   Authentic   V → I     (most conclusive, perfect cadence)
 *   Plagal      IV → I    (the "Amen" cadence)
 *   Half        x → V     (unresolved, ends on dominant)
 *   Deceptive   V → vi    (resolves to submediant instead of tonic)
 *
 * ChordDef:  { degree, rootPc, chordPcs: Set<number>, label }
 * Segment:   { startBar, endBar, chord: ChordDef }
 *
 * Exports:
 *   CADENCE_TYPES
 *   CADENCE_LABELS
 *   buildScaleChords(transposedPcs) → ChordDef[]
 *   buildProgression(chords, transposedPcs, bars, cadenceType) → Segment[]
 *   getActiveChord(progression, tick, barTicks) → ChordDef
 *   progressionLabel(progression) → string
 */

import { HARMONIC_TENSION } from './harmony.js';
import { PITCH_NAMES }      from './scales.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export const CADENCE_TYPES = ['authentic', 'plagal', 'half', 'deceptive'];

export const CADENCE_LABELS = {
  authentic: 'Authentic  (V → I)',
  plagal:    'Plagal  (IV → I)',
  half:      'Half  (→ V)',
  deceptive: 'Deceptive  (V → vi)',
};

// Functional category for each degree of a 7-note scale (0-indexed)
const FUNC_7 = [
  'tonic',        // I
  'subdominant',  // ii
  'tonic',        // iii  (weak tonic — can move to any function)
  'subdominant',  // IV
  'dominant',     // V
  'tonic',        // vi   (target of deceptive cadence)
  'dominant',     // vii°
];

// From each functional category, which scale degrees may follow?
// These represent common voice-leading moves in tonal music.
const TRANSITIONS_7 = {
  tonic:       [3, 1, 5, 4],  // → IV, ii, vi, V
  subdominant: [4, 6],         // → V, vii°
  dominant:    [0, 2, 5],      // → I, iii, vi
};

// Cadence degree pairs for heptatonic scales: [penultimate, final].
// null penultimate = take from the body progression naturally.
const CADENCES_7 = {
  authentic: [4, 0],
  plagal:    [3, 0],
  half:      [null, 4],
  deceptive: [4, 5],
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Find the scale degree whose root is closest to a target semitone interval
 * above degree 0. Used to find dominant/subdominant equivalents in non-heptatonic scales.
 */
function nearestDegree(transposedPcs, semitoneInterval) {
  const target = (transposedPcs[0] + semitoneInterval) % 12;
  let bestDeg = 1, bestDist = Infinity;
  transposedPcs.forEach((pc, i) => {
    if (i === 0) return;
    const dist = Math.min((pc - target + 12) % 12, (target - pc + 12) % 12);
    if (dist < bestDist) { bestDist = dist; bestDeg = i; }
  });
  return bestDeg;
}

/**
 * For non-heptatonic scales, approximate the degrees of dominant, subdominant,
 * and submediant by finding which scale degree root is nearest in pitch.
 */
function approxFunctionalDegrees(transposedPcs) {
  return {
    dominant:    nearestDegree(transposedPcs, 7),  // fifth above tonic
    subdominant: nearestDegree(transposedPcs, 5),  // fourth above tonic
    submediant:  nearestDegree(transposedPcs, 9),  // sixth above tonic
  };
}

/**
 * Return the [penultimate, final] cadence degree pair for any scale.
 */
function cadencePair(cadenceType, n, transposedPcs) {
  if (n === 7) return CADENCES_7[cadenceType] ?? CADENCES_7.authentic;
  const { dominant, subdominant, submediant } = approxFunctionalDegrees(transposedPcs);
  const map = {
    authentic: [dominant,    0],
    plagal:    [subdominant, 0],
    half:      [null,        dominant],
    deceptive: [dominant,    submediant],
  };
  return map[cadenceType] ?? map.authentic;
}

/**
 * Generate the body chord degrees (all slots before the cadence) using
 * functional voice-leading transitions.
 */
function generateBodyDegrees(count, n, transposedPcs) {
  if (count <= 0) return [];
  const degrees = [0]; // always start on tonic

  for (let i = 1; i < count; i++) {
    const prev = degrees[i - 1];
    if (n === 7) {
      const func       = FUNC_7[prev] ?? 'tonic';
      const candidates = TRANSITIONS_7[func].filter(d => d < n && d !== prev);
      const pick       = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
      degrees.push(pick);
    } else {
      // Non-heptatonic: alternate between tonic and near-dominant
      degrees.push(prev === 0 ? nearestDegree(transposedPcs, 7) : 0);
    }
  }
  return degrees;
}

// ── Chord building ────────────────────────────────────────────────────────────

/**
 * Build one ChordDef for a given scale degree.
 */
function buildChordDef(transposedPcs, degree) {
  const n      = transposedPcs.length;
  const rootPc = transposedPcs[degree % n];
  let chordPcs, label;

  if (n === 7) {
    // Diatonic triad: stack two thirds from this scale degree
    const root  = transposedPcs[degree];
    const third = transposedPcs[(degree + 2) % 7];
    const fifth = transposedPcs[(degree + 4) % 7];
    chordPcs = new Set([root, third, fifth]);

    // Determine chord quality from interval sizes
    const thirdInt = (third - root + 12) % 12;
    const fifthInt = (fifth - root + 12) % 12;
    let roman = ROMAN[degree];
    if (thirdInt === 3) roman = roman.toLowerCase();             // minor third → lowercase
    if (thirdInt === 3 && fifthInt === 6) roman += '°';          // dim fifth → diminished
    else if (thirdInt === 4 && fifthInt === 8) roman += '+';     // aug fifth → augmented
    label = roman;
  } else {
    // Non-heptatonic: chord tones = scale notes consonant with this root
    const tones = transposedPcs.filter(pc => {
      const interval = (pc - rootPc + 12) % 12;
      return HARMONIC_TENSION[interval] < 0.4;
    });
    chordPcs = new Set(tones.length ? tones : [rootPc]);
    label    = PITCH_NAMES[rootPc];
  }

  return { degree: degree % n, rootPc, chordPcs, label };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a ChordDef for every degree of the scale.
 *
 * @param {number[]} transposedPcs - Scale pitch classes transposed to the root
 * @returns {ChordDef[]}
 */
export function buildScaleChords(transposedPcs) {
  return transposedPcs.map((_, i) => buildChordDef(transposedPcs, i));
}

/**
 * Generate a chord progression ending with the specified cadence.
 *
 * Harmonic rhythm: 2 bars per chord for pieces of 5+ bars, 1 bar per chord
 * for shorter pieces. The final two chord slots are always reserved for the
 * cadence.
 *
 * @param {ChordDef[]} chords        - From buildScaleChords
 * @param {number[]}   transposedPcs - Scale pitch classes transposed to root
 * @param {number}     bars          - Total bars in the piece
 * @param {string}     cadenceType   - 'authentic' | 'plagal' | 'half' | 'deceptive'
 * @returns {Segment[]}
 */
export function buildProgression(chords, transposedPcs, bars, cadenceType = 'authentic') {
  const n            = transposedPcs.length;
  const barsPerChord = bars <= 4 ? 1 : 2;
  const numSlots     = Math.max(2, Math.floor(bars / barsPerChord));

  const [preDeg, finalDeg] = cadencePair(cadenceType, n, transposedPcs);

  // Body: fill all slots before the last two with functional progressions
  const bodyDegrees     = generateBodyDegrees(numSlots - 2, n, transposedPcs);
  const penultimateDeg  = preDeg !== null
    ? preDeg % n
    : (bodyDegrees.at(-1) ?? 0);  // half cadence: body supplies penultimate chord

  const allDegrees = [...bodyDegrees, penultimateDeg, finalDeg % n];

  return allDegrees.map((deg, i) => ({
    startBar: i * barsPerChord,
    endBar:   Math.min((i + 1) * barsPerChord, bars),
    chord:    chords[deg % n],
  }));
}

/**
 * Return the active chord for a given absolute tick position.
 *
 * @param {Segment[]} progression
 * @param {number}    tick
 * @param {number}    barTicks  - Ticks per bar from computeBarTicks()
 * @returns {ChordDef}
 */
export function getActiveChord(progression, tick, barTicks) {
  const bar = Math.floor(tick / barTicks);
  const seg = progression.find(s => bar >= s.startBar && bar < s.endBar);
  return (seg ?? progression[progression.length - 1]).chord;
}

/**
 * Format a progression as a readable label, e.g. "I → vi → IV → V → I".
 *
 * @param {Segment[]} progression
 * @returns {string}
 */
export function progressionLabel(progression) {
  return progression.map(s => s.chord.label).join(' → ');
}
