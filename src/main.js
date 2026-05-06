/**
 * main.js — UI wiring and generation pipeline.
 *
 * Pipeline:
 *   scales.js → harmony.js → rhythm.js → midi.js
 */

import { SCALES, PITCH_NAMES, getScale }                                          from './scales.js';
import { generateRhythm, computeBarTicks, NOTE_VALUES }                            from './rhythm.js';
import { buildHarmonyMap, selectNote, computeArc, midiNoteName, computeResolution } from './harmony.js';
import { buildScaleChords, buildProgression, getActiveChord, progressionLabel }    from './chords.js';
import { buildMidi, download }                                                     from './midi.js';

// ── DOM references ────────────────────────────────────────────────────────────

const rootSelect      = document.getElementById('root');
const scaleSelect     = document.getElementById('scale');
const scaleDesc       = document.getElementById('scale-desc');
const timeSigSel      = document.getElementById('timeSig');
const barsInput       = document.getElementById('bars');
const bpmInput        = document.getElementById('bpm');
const densityRange    = document.getElementById('density');
const syncopRange     = document.getElementById('syncop');
const stepRange            = document.getElementById('stepWeight');
const chordAdherenceRange  = document.getElementById('chordAdherence');
const repetitionRange      = document.getElementById('repetition');
const variationRange       = document.getElementById('variation');
const densityVal           = document.getElementById('densityVal');
const syncopVal            = document.getElementById('syncopVal');
const stepVal              = document.getElementById('stepVal');
const chordAdherenceVal    = document.getElementById('chordAdherenceVal');
const repetitionVal        = document.getElementById('repetitionVal');
const variationVal         = document.getElementById('variationVal');
const cadenceSel      = document.getElementById('cadence');
const perpetualCheck  = document.getElementById('perpetual');
const noteValueSel    = document.getElementById('noteValue');
const perpetualFields = document.getElementById('perpetualFields');
const normalFields    = document.getElementById('normalFields');
const generateBtn     = document.getElementById('generate');
const output          = document.getElementById('output');

// ── Populate selects ──────────────────────────────────────────────────────────

PITCH_NAMES.forEach((name, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = name;
  if (i === 0) opt.selected = true;
  rootSelect.appendChild(opt);
});

const TAG_ORDER = ['modal', 'diatonic', 'pentatonic', 'hexatonic', 'octatonic', 'exotic'];
const TAG_LABELS = {
  modal:      'Modes',
  diatonic:   'Harmonic',
  pentatonic: 'Pentatonic',
  hexatonic:  'Hexatonic / Symmetrical',
  octatonic:  'Octatonic',
  exotic:     'Exotic & World',
};

TAG_ORDER.forEach(tag => {
  const group = SCALES.filter(s => s.tag === tag);
  if (!group.length) return;
  const og = document.createElement('optgroup');
  og.label = TAG_LABELS[tag];
  group.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    og.appendChild(opt);
  });
  scaleSelect.appendChild(og);
});

// ── Reactive UI ───────────────────────────────────────────────────────────────

function updateScaleDesc() {
  const s = SCALES.find(x => x.name === scaleSelect.value);
  scaleDesc.textContent = s?.desc ?? '';
}
scaleSelect.addEventListener('change', updateScaleDesc);
updateScaleDesc();

function bindSlider(range, label) {
  const sync = () => { label.textContent = Number(range.value).toFixed(2); };
  range.addEventListener('input', sync);
  sync();
}
bindSlider(densityRange,        densityVal);
bindSlider(syncopRange,         syncopVal);
bindSlider(stepRange,           stepVal);
bindSlider(chordAdherenceRange, chordAdherenceVal);
bindSlider(repetitionRange,     repetitionVal);
bindSlider(variationRange,      variationVal);

perpetualCheck.addEventListener('change', () => {
  const on = perpetualCheck.checked;
  perpetualFields.style.display = on ? 'block' : 'none';
  normalFields.style.opacity    = on ? '0.35'  : '1';
  normalFields.style.pointerEvents = on ? 'none' : '';
});

// ── Generation pipeline ───────────────────────────────────────────────────────

generateBtn.addEventListener('click', () => {
  const rootPc      = Number(rootSelect.value);
  const scale       = getScale(scaleSelect.value);
  const [tsNum, tsDen] = timeSigSel.value.split('/').map(Number);
  const timeSig     = [tsNum, tsDen];
  const bars        = Math.max(1, Math.min(16, Number(barsInput.value)  || 8));
  const bpm         = Math.max(40, Math.min(240, Number(bpmInput.value) || 120));
  const cadenceType = cadenceSel.value;
  const isPerpetual = perpetualCheck.checked;

  // Perpetual motion overrides density/syncopation
  const density     = isPerpetual ? 1.0 : Number(densityRange.value);
  const syncopation = isPerpetual ? 0.0 : Number(syncopRange.value);
  const stepWeight      = isPerpetual ? 0.92  : Number(stepRange.value);
  const chordAdherence  = Number(chordAdherenceRange.value);
  const repetition      = isPerpetual ? 0     : Number(repetitionRange.value);
  const variation       = isPerpetual ? 0     : Number(variationRange.value);
  const uniformDuration = isPerpetual
    ? NOTE_VALUES[noteValueSel.value]   // 'eighth' or 'sixteenth'
    : null;

  generateBtn.disabled    = true;
  generateBtn.textContent = 'Generating…';
  output.textContent      = '';

  requestAnimationFrame(() => {
    try {
      // ── 1. Rhythm ───────────────────────────────────────────────────────────
      const rhythm     = generateRhythm({ bars, timeSig, density, syncopation, repetition, variation, uniformDuration });
      const totalTicks = bars * computeBarTicks(timeSig);

      // ── 2. Harmony map + chord progression ─────────────────────────────────
      const harmonyMap  = buildHarmonyMap(scale, rootPc, { octaveRange: [2, 6] });
      const scaleChords = buildScaleChords(harmonyMap.transposedPcs);
      const progression = buildProgression(scaleChords, harmonyMap.transposedPcs, bars, cadenceType);
      const barTicks    = computeBarTicks(timeSig);

      // ── 3. Pitch assignment ─────────────────────────────────────────────────
      const noteEvents      = rhythm.filter(e => !e.isRest);
      let prevNote          = null;
      let prevInterval      = 0;
      let prevChordDegree   = null;
      let pendingResolution = null;

      const withPitch = noteEvents.map((e, idx) => {
        const position    = e.tick / totalTicks;
        const isFirst     = idx === 0;
        const isLast      = idx === noteEvents.length - 1;
        const activeChord = getActiveChord(progression, e.tick, barTicks);

        // Reset pending resolution on chord change — the harmonic context has shifted
        if (prevChordDegree !== null && activeChord.degree !== prevChordDegree) {
          pendingResolution = null;
        }
        prevChordDegree = activeChord.degree;

        const pitch = selectNote(harmonyMap, position, {
          prevNote,
          stepWeight,
          forceRoot:         isFirst,
          snapToPc:          isLast ? activeChord.rootPc : null,
          prevInterval,
          chordPcs:          activeChord.chordPcs,
          chordAdherence,
          pendingResolution,
        });

        // Update dissonance state for the next note selection
        if (activeChord.chordPcs.has(pitch % 12)) {
          pendingResolution = null;  // chord tone — dissonance resolved
        } else {
          pendingResolution = computeResolution(pitch, prevNote, activeChord.chordPcs, harmonyMap.notePool);
        }

        const velocity = Math.round(62 + 23 * computeArc(position));
        if (prevNote !== null) prevInterval = pitch - prevNote;
        prevNote = pitch;

        return { tick: e.tick, duration: e.duration, pitch, velocity };
      });

      // ── 4. Build MIDI ───────────────────────────────────────────────────────
      const rootName = PITCH_NAMES[rootPc];
      const midi     = buildMidi(withPitch, bpm, timeSig, {
        trackName: `${rootName} ${scale.name}`,
      });

      // ── 5. Download ─────────────────────────────────────────────────────────
      const slug     = scale.name.replace(/[\s/]+/g, '_');
      const filename = `${rootName}_${slug}_${bars}bars.mid`;
      download(midi, filename);

      // ── 6. Feedback ─────────────────────────────────────────────────────────
      const opening = withPitch.slice(0, 6).map(e => midiNoteName(e.pitch)).join('  ');
      const progStr = progressionLabel(progression);
      output.innerHTML =
        `<strong>${withPitch.length} notes</strong> · ${rootName} ${scale.name} · ${bars} bars · ${bpm} BPM<br>` +
        `<span style="color:#666">Chords: ${progStr}</span><br>` +
        `<span style="color:#999">Opening: ${opening}…</span>`;

    } catch (err) {
      output.textContent = `Error: ${err.message}`;
      console.error(err);
    } finally {
      generateBtn.disabled    = false;
      generateBtn.textContent = 'Generate & Download MIDI';
    }
  });
});
