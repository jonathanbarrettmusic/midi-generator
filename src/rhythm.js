/**
 * rhythm.js — Rhythm generation engine (reworked).
 *
 * Core design changes from the previous version:
 *
 * SYNCOPATION — previously only shifted onset probability toward weak beats.
 *   Real syncopation requires notes that START on weak beats to be held THROUGH
 *   the next beat position, so the listener hears a sustained note crossing the
 *   metric accent rather than a new onset on it. When syncopation is high, notes
 *   on off-beats receive a minimum duration that bridges them through the next
 *   beat, creating the characteristic "held-over-the-beat" feel.
 *
 * REPETITION — controls phrase length. Low = long phrases (each bar freshly
 *   generated, little repetition). High = short phrases repeated throughout.
 *
 * VARIATION — when a phrase is repeated, controls how much it drifts. Low = near-
 *   exact copies. High = heavy note/rest flipping, phrase can be fully regenerated.
 *
 * Algorithm:
 *   1. Compute phrase length from repetition parameter.
 *   2. Generate a seed phrase (phraseLen bars) using sequential bar fill.
 *   3. Fill the piece by tiling the phrase; each repetition has variation applied.
 *
 * Sequential bar fill:
 *   Walk tick-by-tick through a bar at eighth-note (240-tick) resolution.
 *   At each position decide onset or rest, then choose a duration. On a weak
 *   beat with syncopation active, enforce a minimum duration = distance to the
 *   next beat position + one grid step, so the note swallows the beat.
 *
 * RhythmEvent: { tick: number, duration: number, isRest: boolean }
 *
 * Exports:
 *   PPQ
 *   NOTE_VALUES
 *   computeBarTicks(timeSig)   → number
 *   generateRhythm(params)     → RhythmEvent[]
 *   validateRhythm(events, bars, timeSig)
 */

export const PPQ = 480;

export const NOTE_VALUES = {
  whole:        PPQ * 4,      // 1920
  dottedHalf:   PPQ * 3,      // 1440
  half:         PPQ * 2,      // 960
  dottedQtr:    PPQ * 1.5,    // 720
  quarter:      PPQ,          // 480
  dottedEighth: PPQ * 0.75,   // 360
  eighth:       PPQ * 0.5,    // 240
  sixteenth:    PPQ * 0.25,   // 120
};

const DURATION_LIST = Object.values(NOTE_VALUES).sort((a, b) => b - a); // descending

// ── Metric tables ─────────────────────────────────────────────────────────────
//
// BEAT_STRENGTHS: relative weight of each eighth-note grid position (0–1).
// Used to bias onset probability: high strength = more likely to have a note onset.
//
// BEAT_POSITIONS: which grid positions are the main beat pulses.
// Used for syncopation bridging: a note on a non-beat position must last at least
// until one grid step PAST the next beat position.

const BEAT_STRENGTHS = {
  '4/4': [1.0, 0.1, 0.6, 0.2, 0.8, 0.1, 0.6, 0.2],
  '3/4': [1.0, 0.1, 0.5, 0.2, 0.5, 0.1],
  '6/8': [1.0, 0.3, 0.2, 0.8, 0.3, 0.2],
  '2/4': [1.0, 0.2, 0.7, 0.2],
  '5/4': [1.0, 0.1, 0.6, 0.1, 0.8, 0.1, 0.6, 0.1, 0.5, 0.1],
  '7/8': [1.0, 0.2, 0.4, 0.2, 0.7, 0.2, 0.5],
};

const BEAT_POSITIONS = {
  '4/4': [0, 2, 4, 6],       // all four quarter-note beats
  '3/4': [0, 2, 4],           // all three quarter-note beats
  '6/8': [0, 3],              // two dotted-quarter beats
  '2/4': [0, 2],              // two quarter-note beats
  '5/4': [0, 2, 4, 6, 8],    // five quarter-note beats
  '7/8': [0, 2, 4],           // three beats in 2+2+3 grouping
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function weightedRandom(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function computeBarTicks([num, den]) {
  return (num / den) * 4 * PPQ;
}

function getBeatStrengths(timeSig) {
  return BEAT_STRENGTHS[timeSig.join('/')] ?? BEAT_STRENGTHS['4/4'];
}

function getBeatPositions(timeSig) {
  return BEAT_POSITIONS[timeSig.join('/')] ?? BEAT_POSITIONS['4/4'];
}

/**
 * Fill a span with rest events using standard note values (greedy longest-fit).
 */
function fillWithRests(startTick, duration) {
  const rests = [];
  let t = startTick, remaining = duration;
  while (remaining > 0) {
    const d = DURATION_LIST.find(d => d <= remaining) ?? remaining;
    rests.push({ tick: t, duration: d, isRest: true });
    t += d; remaining -= d;
  }
  return rests;
}

/**
 * Standard duration choice: weighted by density.
 * Low density → long notes. High density → short notes.
 */
function chooseDuration(space, density) {
  const valid = DURATION_LIST.filter(d => d <= space);
  if (valid.length === 0) return space;
  if (valid.length === 1) return valid[0];
  const exponent = lerp(0.25, 2.5, density);
  const weights  = valid.map(d => Math.pow(d / valid[0], exponent));
  return weightedRandom(valid, weights);
}

/**
 * Return the tick of the next beat position strictly after currentTick.
 * If no beat remains in the current bar, returns the start of the next bar.
 */
function getNextBeatTick(currentTick, beatPositions, bt, GRID) {
  const barStart  = Math.floor(currentTick / bt) * bt;
  const gridInBar = Math.floor((currentTick - barStart) / GRID);
  const next      = beatPositions.filter(bp => bp > gridInBar).sort((a, b) => a - b)[0];
  return next !== undefined ? barStart + next * GRID : barStart + bt;
}

/**
 * Duration choice with syncopation bridging.
 *
 * On a weak (non-beat) grid position with sufficient syncopation, sets a minimum
 * duration that extends at least one grid step past the next beat position.
 * This ensures the note "swallows" the beat — the defining characteristic of
 * held syncopation — rather than just placing a short note on an off-beat.
 *
 * Example (4/4): note at the "and of beat 1" (tick 240) with syncopation=0.8:
 *   nextBeatTick = 480 (beat 2)
 *   minDuration  = 480 − 240 + 240 = 480 (quarter note)
 *   → note spans 240–720, bridging through beat 2 ✓
 */
function chooseSyncopatedDuration(currentTick, remaining, density, syncopation, beatPositions, bt) {
  const GRID      = NOTE_VALUES.eighth;
  const barStart  = Math.floor(currentTick / bt) * bt;
  const gridLen   = Math.round(bt / GRID);
  const gridInBar = Math.floor((currentTick - barStart) / GRID) % gridLen;
  const isOnBeat  = beatPositions.includes(gridInBar);

  if (!isOnBeat && syncopation > 0.15 && Math.random() < syncopation) {
    const nextBeatTick   = getNextBeatTick(currentTick, beatPositions, bt, GRID);
    const minDur         = Math.min(nextBeatTick - currentTick + GRID, remaining);
    const validBridging  = DURATION_LIST.filter(d => d >= minDur && d <= remaining);

    if (validBridging.length > 0) {
      const exponent = lerp(0.25, 2.5, density);
      const weights  = validBridging.map(d => Math.pow(d / remaining, exponent));
      return weightedRandom(validBridging, weights);
    }
  }

  return chooseDuration(remaining, density);
}

// ── Bar generation ────────────────────────────────────────────────────────────

/**
 * Generate events that exactly fill one bar using sequential tick-by-tick fill.
 *
 * At each eighth-note grid position:
 *   - Compute onset probability from beat strength and syncopation.
 *   - If onset: flush any accumulated rest, choose a syncopation-aware duration.
 *   - If no onset: accumulate the position as rest time (flushed at next onset).
 *
 * Syncopation suppresses onsets on strong beats (floor drops from 0.25 → 0.05)
 * while boosting them on weak beats, AND enforces bridging durations that carry
 * the note through the next beat — the two-part mechanism of real syncopation.
 */
function generateBar(bt, timeSig, density, syncopation) {
  const GRID         = NOTE_VALUES.eighth;
  const gridLen      = Math.round(bt / GRID);
  const strengths    = getBeatStrengths(timeSig);
  const beatPositions = getBeatPositions(timeSig);

  // At high syncopation, reduce the onset floor on strong beats so they stay silent
  const floor = lerp(0.25, 0.04, syncopation);

  const events  = [];
  let tick      = 0;
  let restAccum = null; // accumulated rest: tick where the rest started

  while (tick < bt) {
    const remaining = bt - tick;
    if (remaining <= 0) break;

    const barStart   = Math.floor(tick / bt) * bt;
    const gridInBar  = Math.floor((tick - barStart) / GRID) % gridLen;
    const s          = strengths[gridInBar] ?? 0.2;

    // Onset probability: syncopation slides preference from strong → weak beats
    const beatPref = lerp(s, 1 - s, syncopation);
    const prob     = density * (floor + (1 - floor) * beatPref);

    // Keep the downbeat unless extreme syncopation (≥ 0.9)
    const forceOnset = tick === 0 && density > 0.15 && syncopation < 0.9;
    const hasOnset   = forceOnset || Math.random() < prob;

    if (hasOnset) {
      // Flush any accumulated rest as standard note-value rest events
      if (restAccum !== null) {
        fillWithRests(restAccum, tick - restAccum).forEach(r => events.push(r));
        restAccum = null;
      }

      const dur = chooseSyncopatedDuration(tick, remaining, density, syncopation, beatPositions, bt);
      events.push({ tick, duration: dur, isRest: false });
      tick += dur;
    } else {
      if (restAccum === null) restAccum = tick;
      tick += GRID; // advance one grid step and check again
    }
  }

  // Flush any rest that extends to the bar end
  if (restAccum !== null) {
    fillWithRests(restAccum, bt - restAccum).forEach(r => events.push(r));
  }

  return events;
}

// ── Phrase building ───────────────────────────────────────────────────────────

function generatePhrase(phraseLen, timeSig, density, syncopation) {
  const bt     = computeBarTicks(timeSig);
  const events = [];
  for (let b = 0; b < phraseLen; b++) {
    generateBar(bt, timeSig, density, syncopation)
      .forEach(e => events.push({ ...e, tick: e.tick + b * bt }));
  }
  return events;
}

/**
 * Apply variation to a phrase copy by probabilistically flipping note ↔ rest.
 *
 * variation=0   → exact copy
 * variation=0.5 → ~28% of events flipped
 * variation=1   → ~55% of events flipped
 *
 * Preserves all tick positions and durations so phrase timing stays intact.
 * At very high variation (> 0.75) the phrase has a chance of being fully
 * regenerated, giving maximum structural contrast.
 */
function applyVariation(phrase, variation, timeSig, density, syncopation) {
  if (variation < 0.01) return phrase.map(e => ({ ...e }));

  // At very high variation, occasionally regenerate the whole phrase
  if (variation > 0.75 && Math.random() < (variation - 0.75) * 2) {
    const bt       = computeBarTicks(timeSig);
    const numBars  = Math.round((phrase[phrase.length - 1]?.tick ?? 0) / bt) + 1;
    return generatePhrase(numBars, timeSig, density, syncopation);
  }

  return phrase.map(e => ({
    ...e,
    isRest: Math.random() < variation * 0.55 ? !e.isRest : e.isRest,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a rhythmic event sequence for the full requested length.
 *
 * @param {object}      params
 * @param {number}      params.bars            - Total bars to fill (1–16)
 * @param {number[]}    params.timeSig         - [numerator, denominator]
 * @param {number}      [params.density]       - 0–1 note density (default 0.65)
 * @param {number}      [params.syncopation]   - 0–1 syncopation (default 0.25)
 *                                               Notes on off-beats are held through
 *                                               the next beat position.
 * @param {number}      [params.repetition]    - 0–1 phrase repetition (default 0.5)
 *                                               0 = each bar unique;
 *                                               1 = one bar repeated throughout.
 * @param {number}      [params.variation]     - 0–1 variation between repetitions (default 0.25)
 *                                               0 = exact copy; 1 = heavy variation.
 * @param {number|null} [params.uniformDuration] - Perpetual motion: fill every tick
 *                                               with notes of this duration, no rests.
 * @returns {Array<{tick:number, duration:number, isRest:boolean}>}
 */
export function generateRhythm({
  bars,
  timeSig,
  density         = 0.65,
  syncopation     = 0.25,
  repetition      = 0.5,
  variation       = 0.25,
  uniformDuration = null,
}) {
  // ── Perpetual motion ───────────────────────────────────────────────────────
  if (uniformDuration !== null) {
    const totalTicks = bars * computeBarTicks(timeSig);
    const events     = [];
    for (let tick = 0; tick < totalTicks; tick += uniformDuration) {
      events.push({ tick, duration: uniformDuration, isRest: false });
    }
    return events;
  }

  const bt = computeBarTicks(timeSig);

  // Phrase length from repetition:
  //   repetition=0   → phraseLen=bars  (whole piece = one long unique phrase)
  //   repetition=0.5 → phraseLen=bars/2 (repeats twice)
  //   repetition=1   → phraseLen=1     (one bar repeated throughout)
  const phraseLen = Math.max(1, Math.round(bars * (1 - repetition)));

  const phrase  = generatePhrase(phraseLen, timeSig, density, syncopation);
  const events  = [];
  let bar       = 0;

  while (bar < bars) {
    const barsLeft  = bars - bar;
    const useBars   = Math.min(phraseLen, barsLeft);
    const offset    = bar * bt;

    const source = bar === 0
      ? phrase
      : applyVariation(phrase, variation, timeSig, density, syncopation);

    source
      .filter(e => e.tick < useBars * bt)
      .forEach(e => events.push({ ...e, tick: e.tick + offset }));

    bar += useBars;
  }

  return events;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRhythm(events, bars, timeSig) {
  const total = bars * computeBarTicks(timeSig);
  let cursor  = 0;
  for (const e of events) {
    if (e.tick !== cursor)  throw new Error(`Gap at tick ${cursor}: event starts at ${e.tick}`);
    if (e.duration <= 0)    throw new Error(`Zero/negative duration at tick ${cursor}`);
    cursor += e.duration;
  }
  if (cursor !== total)     throw new Error(`Events end at ${cursor}, expected ${total}`);
  return true;
}
