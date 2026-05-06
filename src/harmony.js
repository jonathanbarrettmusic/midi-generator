/**
 * harmony.js — Harmonic region engine.
 *
 * Each pitch class in the scale is assigned a tension value from
 * HARMONIC_TENSION (0 = most consonant, 1 = most dissonant relative to root).
 * This works for any scale size — pentatonic through octatonic — because it is
 * indexed by semitone interval above the root, not by scale degree.
 *
 * The melodic arc:
 *   targetTension(position) = sin(position × π)
 *
 *   position 0   → target 0   (prefer stable tonic tones)
 *   position 0.5 → target 1   (prefer tense subdominant / dominant tones)
 *   position 1   → target 0   (resolve back to stable tones)
 *
 * The regions described in the design (tonic / subdominant / dominant) map
 * naturally onto the tension weights:
 *   tonic tones     (root, third, fifth)  → tension 0.00 – 0.25
 *   subdominant     (fourth, sixth)       → tension 0.35 – 0.55
 *   dominant        (seventh, second)     → tension 0.50 – 0.75
 *   colour tones    (minor 2nd, tritone)  → tension 0.90 – 0.95
 *
 * Note selection weights three factors:
 *   tensionMatch  — how closely the note's tension matches the arc target
 *   proximity     — prefer notes near the previous note (stepWeight 0–1)
 *   register      — Gaussian pull toward the centre of the octave range
 *
 * Exports:
 *   buildHarmonyMap(scale, rootPc, options) → HarmonyMap
 *   selectNote(harmonyMap, position, context) → midiNote
 *   computeArc(position) → number (0–1)
 *   regionName(position) → 'tonic' | 'subdominant' | 'dominant'
 *   midiNoteName(midi) → string  e.g. "D#5"
 */

import { transpose } from './scales.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// C4 (middle C) = MIDI 60.  Formula: midi = (octave + 1) * 12 + pc
const MIDI_C4 = 60;

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Tension of each semitone interval above the root (0–11).
// 0 = perfectly consonant (tonic), 1 = maximally dissonant.
// Exported so chords.js can use the same table for chord-tone classification.
export const HARMONIC_TENSION = [
  0.00,  //  0 — unison / octave  (root — most stable)
  0.90,  //  1 — minor second     (very dissonant)
  0.50,  //  2 — major second     (moderate)
  0.25,  //  3 — minor third      (fairly stable)
  0.20,  //  4 — major third      (stable)
  0.55,  //  5 — perfect fourth   (mild tension, needs resolution)
  0.95,  //  6 — tritone          (most tense)
  0.10,  //  7 — perfect fifth    (stable)
  0.40,  //  8 — minor sixth      (moderate)
  0.35,  //  9 — major sixth      (fairly stable)
  0.65,  // 10 — minor seventh    (tense)
  0.75,  // 11 — major seventh    (tense, strong leading-tone pull)
];

// ── Internal helpers ──────────────────────────────────────────────────────────

function weightedRandom(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Build the sorted note pool — all MIDI notes in [minMidi, maxMidi] whose
 * pitch class belongs to the transposed scale.
 */
function buildNotePool(transposedPcs, minMidi, maxMidi) {
  const pcSet = new Set(transposedPcs);
  const pool  = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (pcSet.has(midi % 12)) pool.push(midi);
  }
  return pool; // already ascending
}

// ── Public utilities ──────────────────────────────────────────────────────────

/**
 * The melodic tension arc — a sine curve peaking at the midpoint.
 *
 * @param {number} position - 0–1 position within the melody
 * @returns {number} 0–1
 */
export function computeArc(position) {
  return Math.sin(clamp(position, 0, 1) * Math.PI);
}

/**
 * Descriptive harmonic region at a given position.
 *
 * @param {number} position - 0–1
 * @returns {'tonic'|'subdominant'|'dominant'}
 */
export function regionName(position) {
  const p = clamp(position, 0, 1);
  if (p < 0.15 || p > 0.85) return 'tonic';
  if (p < 0.35 || p > 0.65) return 'subdominant';
  return 'dominant';
}

/**
 * Convert a MIDI note number to a human-readable name.
 *
 * @param {number} midi
 * @returns {string}  e.g. "D#5"
 */
export function midiNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const pc     = midi % 12;
  return `${NOTE_NAMES[pc]}${octave}`;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Build the harmony map for a scale transposed to a root pitch class.
 *
 * @param {object} scale   - Scale object from scales.js
 * @param {number} rootPc  - Root pitch class (0–11)
 * @param {object} [options]
 * @param {number[]} [options.octaveRange] - [minOctave, maxOctave] default [4, 6]
 * @returns {HarmonyMap}
 *
 * HarmonyMap: {
 *   notePool:  number[],             // sorted MIDI notes available
 *   tensions:  number[],             // tension[i] for notePool[i]
 *   rootPc:    number,
 *   minMidi:   number,
 *   maxMidi:   number,
 *   centerMidi:number,
 * }
 */
export function buildHarmonyMap(scale, rootPc, { octaveRange = [2, 6] } = {}) {
  const [minOct, maxOct] = octaveRange;
  const minMidi    = (minOct + 1) * 12;       // C of minOct  (e.g. C2 = 36)
  const maxMidi    = (maxOct + 1) * 12;       // C of maxOct  (e.g. C6 = 84)
  const centerMidi = Math.round((minMidi + maxMidi) / 2);

  const transposedPcs = transpose(scale, rootPc);
  const notePool      = buildNotePool(transposedPcs, minMidi, maxMidi);

  // Assign tension to each MIDI note via its interval above the root
  const tensions = notePool.map(midi => {
    const interval = (midi % 12 - rootPc + 12) % 12;
    return HARMONIC_TENSION[interval];
  });

  return { notePool, tensions, rootPc, minMidi, maxMidi, centerMidi, scale, transposedPcs };
}

/**
 * Select a MIDI note for a given position in the melody.
 *
 * @param {object} harmonyMap  - From buildHarmonyMap
 * @param {number} position    - 0–1 position within the melody
 * @param {object} [context]
 * @param {number|null} [context.prevNote]     - Previous MIDI note (null for first)
 * @param {number}      [context.stepWeight]   - 0–1 stepwise preference (default 0.75)
 * @param {boolean}     [context.forceRoot]    - Force selection of the piece root pitch class
 * @param {number|null} [context.snapToPc]     - Force selection of a specific pitch class
 *                                               (overrides forceRoot — use for cadence targets)
 * @param {number}      [context.prevInterval] - Signed semitones of the last move (default 0)
 * @param {Set|null}    [context.chordPcs]          - Pitch-class Set of current chord tones
 * @param {number}      [context.chordAdherence]    - 0–1 chord-tone preference (default 0.7)
 * @param {object|null} [context.pendingResolution] - When set, a previous non-chord tone is
 *                                                    awaiting resolution. From computeResolution().
 * @returns {number} MIDI note number
 */
export function selectNote(harmonyMap, position, context = {}) {
  const {
    prevNote           = null,
    stepWeight         = 0.75,
    forceRoot          = false,
    snapToPc           = null,
    prevInterval       = 0,
    chordPcs           = null,
    chordAdherence     = 0.7,
    pendingResolution  = null,
  } = context;

  const { notePool, tensions, rootPc, minMidi, maxMidi, centerMidi } = harmonyMap;

  if (notePool.length === 0) {
    throw new Error('harmony.js: note pool is empty — check octave range and scale');
  }

  // ── Snap to a specific pitch class (cadence target or piece root) ─────────
  // snapToPc takes priority over forceRoot — used for cadence endings where
  // the target note is the chord root (e.g. A for deceptive vi, G for half V).
  const snapTarget = snapToPc !== null ? snapToPc : (forceRoot ? rootPc : null);
  if (snapTarget !== null) {
    const snapNotes = notePool.filter(m => m % 12 === snapTarget);
    if (snapNotes.length > 0) {
      const anchor = prevNote ?? centerMidi;
      return snapNotes.reduce((best, m) =>
        Math.abs(m - anchor) < Math.abs(best - anchor) ? m : best
      );
    }
  }

  // ── Target tension — capped at 0.65 so the arc never prefers tritones ─────
  // The arc still shapes the melody but stays in musical territory (≤ minor 7th).
  const target = computeArc(position) * 0.65;

  // ── Weigh each candidate ──────────────────────────────────────────────────
  const rangeSpan = maxMidi - minMidi;

  const weights = notePool.map((midi, i) => {
    // 1. Tension match — squared for contrast (0–1)
    const tMatch = Math.pow(1 - Math.abs(tensions[i] - target), 2);

    // 2. Proximity — sharper decay than before (0.32 vs 0.28) keeps steps tight
    const dist      = prevNote !== null ? Math.abs(midi - prevNote) : 0;
    const proximity = prevNote !== null
      ? Math.exp(-dist * stepWeight * 0.32)
      : 1;

    // 3. Same-note penalty — avoid melodic stagnation
    const samePenalty = (prevNote !== null && midi === prevNote) ? 0.2 : 1;

    // 4. Register gravity — pull melody toward centre to create natural arch shapes.
    //    When above centre, prefer candidates that move downward, and vice versa.
    const prevPos       = prevNote ?? centerMidi;
    const awayFromCentre = prevPos - centerMidi;
    const candidateDiff  = midi - prevPos;
    const gravityWeight  = awayFromCentre !== 0
      ? 1 + 0.45 * (Math.sign(-awayFromCentre) === Math.sign(candidateDiff) ? 1 : -1)
      : 1;

    // 5. Leap resolution — after a large interval, prefer stepwise in opposite direction.
    //    Continuing in the same direction after a leap is penalised.
    let leapWeight = 1;
    if (prevNote !== null && Math.abs(prevInterval) > 4) {
      const oppDir = -Math.sign(prevInterval);
      const diff   = midi - prevNote;
      if (Math.sign(diff) === oppDir && Math.abs(diff) <= 3) {
        leapWeight = 2.5;  // stepwise resolution in opposite direction
      } else if (Math.sign(diff) === Math.sign(prevInterval) && Math.abs(diff) > 2) {
        leapWeight = 0.2;  // penalise continuing the leap
      }
    }

    // 6. Register — Gaussian pull toward centre of octave range
    const normalised = (midi - centerMidi) / (rangeSpan * 0.5);
    const register   = Math.exp(-normalised * normalised * 2.2);

    // 7. Chord-tone weight (when a chord progression is active).
    //    chordAdherence=0 → no preference (both get 1.0)
    //    chordAdherence=1 → chord tones ×2.5, non-chord tones scaled by arc tension
    const isChordTone = chordPcs && chordPcs.has(midi % 12);
    const chordBoost  = !chordPcs ? 1.0
      : isChordTone
        ? 1 + 1.5 * chordAdherence
        : 1.0 + (Math.max(0.1, target * 0.85) - 1.0) * chordAdherence;

    // 8. Dissonance resolution weight — when the previous note was a non-chord tone
    //    and needs to resolve, steer the next note toward a proper resolution.
    //
    //    Ideal resolution  : chord tone, right direction, within maxInterval  → ×8
    //    Acceptable        : chord tone, any stepwise motion                  → ×2.5
    //    Chord tone by leap: allowed but not preferred                        → ×1
    //    Another NCT       : strongly discouraged — avoid chained dissonances → ×0.1
    let resolutionWeight = 1.0;
    if (pendingResolution !== null && prevNote !== null) {
      const { direction, maxInterval, targetMidi } = pendingResolution;
      const diff = midi - prevNote;
      if (isChordTone) {
        const idealDir  = Math.sign(diff) === direction;
        const idealDist = Math.abs(diff) <= maxInterval;
        const exactHit  = targetMidi !== null && midi === targetMidi;
        resolutionWeight = (exactHit || (idealDir && idealDist)) ? 8.0
                         : Math.abs(diff) <= 2                   ? 2.5
                         : 1.0;
      } else {
        resolutionWeight = 0.1; // penalise chaining unresolved dissonances
      }
    }

    return tMatch * proximity * samePenalty * gravityWeight * leapWeight * register * chordBoost * resolutionWeight;
  });

  return weightedRandom(notePool, weights);
}

// ── Dissonance resolution ─────────────────────────────────────────────────────

/**
 * Called after a non-chord tone is selected. Analyses the musical context
 * (how the dissonance was approached) and returns a resolution instruction
 * for the next call to selectNote.
 *
 * Recognised contexts:
 *   Passing tone  — stepwise approach, continuing same direction to chord tone
 *   Neighbor tone — stepped away from a chord tone; returns to same chord tone
 *   Suspension    — above chord tone on a relatively strong position; resolves down
 *   Appoggiatura  — leaped to; resolves stepwise to nearest chord tone
 *
 * @param {number}      nonChordMidi  - The non-chord MIDI note that was selected
 * @param {number|null} prevMidi      - The note before it (null if first)
 * @param {Set}         chordPcs      - Current chord pitch-class Set
 * @param {number[]}    notePool      - Full sorted MIDI pool from buildHarmonyMap
 * @returns {{ direction:number, maxInterval:number, targetMidi:number|null, type:string } | null}
 */
export function computeResolution(nonChordMidi, prevMidi, chordPcs, notePool) {
  // Find the nearest chord tones immediately above and below in the pool
  const below = notePool.filter(m => chordPcs.has(m % 12) && m < nonChordMidi);
  const above  = notePool.filter(m => chordPcs.has(m % 12) && m > nonChordMidi);
  const nearestBelow = below.length ? below[below.length - 1] : null;
  const nearestAbove = above.length ? above[0]                : null;
  const distBelow    = nearestBelow !== null ? nonChordMidi - nearestBelow : Infinity;
  const distAbove    = nearestAbove !== null ? nearestAbove - nonChordMidi : Infinity;

  if (distBelow === Infinity && distAbove === Infinity) return null; // no chord tones to aim for

  const isStepApproach  = prevMidi !== null && Math.abs(nonChordMidi - prevMidi) <= 2;
  const approachDir     = prevMidi !== null ? Math.sign(nonChordMidi - prevMidi) : 0;
  const prevIsChordTone = prevMidi !== null && chordPcs.has(prevMidi % 12);

  // ── Passing tone: approached by step, resolve in same direction to chord tone ──
  if (isStepApproach && approachDir > 0 && distAbove <= 2) {
    return { direction: 1,  maxInterval: distAbove, targetMidi: nearestAbove, type: 'passing' };
  }
  if (isStepApproach && approachDir < 0 && distBelow <= 2) {
    return { direction: -1, maxInterval: distBelow, targetMidi: nearestBelow, type: 'passing' };
  }

  // ── Neighbor tone: stepped away from a chord tone, return to same chord tone ──
  if (isStepApproach && prevIsChordTone) {
    const returnDir = Math.sign(prevMidi - nonChordMidi); // back where we came from
    if (returnDir > 0) {
      return { direction: 1,  maxInterval: Math.max(distAbove, 2), targetMidi: nearestAbove, type: 'neighbor' };
    } else {
      return { direction: -1, maxInterval: Math.max(distBelow, 2), targetMidi: nearestBelow, type: 'neighbor' };
    }
  }

  // ── Suspension / appoggiatura: resolve downward if a chord tone is close below,
  //    otherwise upward. Downward resolution is the classical norm.
  if (distBelow <= 3) {
    return { direction: -1, maxInterval: distBelow, targetMidi: nearestBelow, type: distBelow <= 2 ? 'suspension' : 'appoggiatura' };
  }
  if (distAbove <= 3) {
    return { direction: 1,  maxInterval: distAbove, targetMidi: nearestAbove, type: 'appoggiatura' };
  }

  // ── Fallback: resolve to nearest chord tone ───────────────────────────────────
  return distBelow <= distAbove
    ? { direction: -1, maxInterval: distBelow, targetMidi: nearestBelow, type: 'appoggiatura' }
    : { direction: 1,  maxInterval: distAbove, targetMidi: nearestAbove, type: 'appoggiatura' };
}
