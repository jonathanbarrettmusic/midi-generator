/**
 * cantus.js — Cantus firmus generator.
 *
 * Enforces species-counterpoint rules:
 *   - All whole notes, uniform velocity
 *   - Begins and ends on tonic
 *   - Diatonic pitches only
 *   - No repeated consecutive notes
 *   - Leaps limited to m3 / M3 / P4 / P5 / m6 / P8
 *   - After any leap, next motion must be a step in the opposite direction
 *   - Single climax (highest pitch appears once, not at start or end)
 *   - Penultimate note is one scale step (1–2 semitones) from the final tonic
 *
 * Exports:
 *   VOICE_RANGES
 *   generateCantusFirmus(rootPc, scale, length, voiceRange) → NoteEvent[]
 */

import { PPQ } from './midi.js';

export const VOICE_RANGES = {
  soprano: [60, 79],
  alto:    [55, 74],
  tenor:   [48, 67],
  bass:    [40, 62],
};

const MAX_STEP      = 2;
const ALLOWED_LEAPS = new Set([3, 4, 5, 7, 8, 12]);
const WHOLE_NOTE    = 4 * PPQ;

/**
 * Generate a cantus firmus as an array of whole-note MIDI events.
 *
 * @param {number} rootPc     - Root pitch class 0–11
 * @param {object} scale      - Scale object from scales.js
 * @param {number} length     - Note count, 8–16
 * @param {string} voiceRange - 'soprano' | 'alto' | 'tenor' | 'bass'
 * @returns {{ tick, duration, pitch, velocity }[]}
 */
export function generateCantusFirmus(rootPc, scale, length = 8, voiceRange = 'soprano') {
  if (length < 4) throw new Error('Cantus firmus requires at least 4 notes');

  const [lo, hi] = VOICE_RANGES[voiceRange] ?? VOICE_RANGES.soprano;
  const pcs = scale.pcs.map(pc => (pc + rootPc) % 12);

  const pool = [];
  for (let midi = lo; midi <= hi; midi++) {
    if (pcs.includes(midi % 12)) pool.push(midi);
  }

  if (pool.length < 5) {
    throw new Error('Voice range too narrow for this scale — try a different voice or root');
  }

  const tonicInRange = pool.filter(p => p % 12 === rootPc % 12);
  if (!tonicInRange.length) {
    throw new Error('No tonic pitch in the selected voice range');
  }

  // Start on the lower-middle tonic to leave room for the climax above
  const startTonic = tonicInRange[Math.floor((tonicInRange.length - 1) / 2)];

  for (let attempt = 0; attempt < 600; attempt++) {
    const notes = tryBuild(pool, rootPc, startTonic, length);
    if (notes) return notesToEvents(notes);
  }

  throw new Error('Could not generate a valid cantus firmus — try a different scale or voice');
}

// ── Internal ──────────────────────────────────────────────────────────────────

function tryBuild(pool, rootPc, startTonic, length) {
  const notes     = [startTonic];
  let   leapDir   = 0;                            // direction of last leap, or 0
  const climaxPos = Math.round(length * 0.55);    // aim for peak ~55% through

  // Build body (all notes except final two)
  for (let i = 1; i < length - 2; i++) {
    const prev      = notes[i - 1];
    const ascending = i <= climaxPos;

    const cands = pool.filter(p => isValidNext(prev, p, leapDir));
    if (!cands.length) return null;

    const scored = cands.map(p => {
      const iv  = Math.abs(p - prev);
      const dir = p > prev ? 1 : -1;
      let   s   = 1;

      if (iv <= MAX_STEP) s += 5;               // strongly prefer steps
      if (ascending  && dir > 0) s += 2;        // phase-aligned direction
      if (!ascending && dir < 0) s += 2;

      // Mild pull toward range centre (avoids extremes)
      const mid = (pool[0] + pool[pool.length - 1]) / 2;
      if (Math.abs(p - mid) < Math.abs(prev - mid)) s += 0.5;

      return { p, s };
    });

    const chosen   = weightedRandom(scored);
    const chosenIv = Math.abs(chosen - prev);
    leapDir = chosenIv > MAX_STEP ? (chosen > prev ? 1 : -1) : 0;
    notes.push(chosen);
  }

  // Append penultimate + final tonic
  const prev = notes[notes.length - 1];

  const finalTonics = pool
    .filter(p => p % 12 === rootPc % 12)
    .sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));

  for (const finalT of finalTonics) {
    // Penultimate: one diatonic step from the final tonic
    const penultOpts = pool
      .filter(p => {
        const d = Math.abs(p - finalT);
        return d >= 1 && d <= 2 && p !== finalT;
      })
      .sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));

    for (const penult of penultOpts) {
      if (!isValidNext(prev, penult, leapDir)) continue;
      const newLeapDir = Math.abs(penult - prev) > MAX_STEP
        ? (penult > prev ? 1 : -1)
        : 0;
      if (!isValidNext(penult, finalT, newLeapDir)) continue;

      const full = [...notes, penult, finalT];
      if (hasGoodClimax(full)) return full;
    }
  }

  return null;
}

/** True if moving from prev → next is allowed given pending post-leap direction. */
function isValidNext(prev, next, postLeapDir) {
  if (next === prev) return false;
  const iv = Math.abs(next - prev);
  if (iv > 12) return false;
  if (iv > MAX_STEP && !ALLOWED_LEAPS.has(iv)) return false;

  if (postLeapDir !== 0) {
    if (iv > MAX_STEP) return false;              // leap after leap forbidden
    const dir = next > prev ? 1 : -1;
    if (dir !== -postLeapDir) return false;       // must step in opposite direction
  }

  return true;
}

/** The highest pitch must appear exactly once, not at the first or last position. */
function hasGoodClimax(notes) {
  const max = Math.max(...notes);
  if (notes.filter(n => n === max).length !== 1) return false;
  const idx = notes.indexOf(max);
  return idx > 0 && idx < notes.length - 1;
}

function weightedRandom(scored) {
  const total = scored.reduce((a, c) => a + c.s, 0);
  let r = Math.random() * total;
  for (const c of scored) {
    r -= c.s;
    if (r <= 0) return c.p;
  }
  return scored[scored.length - 1].p;
}

function notesToEvents(notes) {
  return notes.map((pitch, i) => ({
    tick:     i * WHOLE_NOTE,
    duration: WHOLE_NOTE,
    pitch,
    velocity: 75,
  }));
}
