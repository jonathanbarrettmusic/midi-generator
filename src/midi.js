/**
 * midi.js — Standard MIDI File (SMF) writer.
 *
 * Produces a Format 0 (single-track) SMF at 480 PPQ.
 *
 * SMF structure:
 *   Header chunk  MThd  6 bytes  format(0) | numTracks(1) | division(480)
 *   Track chunk   MTrk  N bytes  [delta + event] … end-of-track
 *
 * Events written (in order):
 *   Δ0   FF 51 03 tt tt tt   Tempo (microseconds per quarter note)
 *   Δ0   FF 58 04 nn dd cc bb  Time signature
 *   Δ0   FF 03 len text       Track name
 *   Δ0   C0 pp               Program change (GM instrument)
 *   …    9n kk vv / 8n kk 00  Note on / Note off  (channel 0)
 *   Δ0   FF 2F 00             End of track
 *
 * Note events with isRest === true are silently ignored.
 * Note-off events are ordered before note-on at the same tick to avoid
 * stuck notes when one note ends exactly where another begins.
 *
 * NoteEvent: { tick, duration, pitch, velocity?, isRest? }
 *
 * Exports:
 *   PPQ
 *   buildMidi(events, bpm, timeSig, options) → Uint8Array
 *   download(uint8Array, filename)
 *   parseMidi(uint8Array) → { bpm, timeSig, notes[] }  ← for validation
 */

export const PPQ = 480;

// ── Encoding helpers ──────────────────────────────────────────────────────────

/**
 * Encode a non-negative integer as a MIDI variable-length quantity (VLQ).
 * Each byte carries 7 bits of data; bit 7 signals "more bytes follow."
 *
 * Examples:
 *   0       → [0x00]
 *   127     → [0x7F]
 *   128     → [0x81, 0x00]
 *   480     → [0x83, 0x60]
 *   1048576 → [0xC0, 0x80, 0x00]
 */
function encodeVLQ(n) {
  if (n === 0) return [0x00];
  const bytes = [];
  bytes.push(n & 0x7F);          // least-significant 7 bits — final byte (no flag)
  n >>>= 7;
  while (n > 0) {
    bytes.push((n & 0x7F) | 0x80); // more-significant bits — continuation flag set
    n >>>= 7;
  }
  return bytes.reverse();          // MSB first
}

/** Write a 32-bit big-endian unsigned integer into an array. */
function pushUint32(arr, v) {
  arr.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF);
}

/** Write a 16-bit big-endian unsigned integer into an array. */
function pushUint16(arr, v) {
  arr.push((v >>> 8) & 0xFF, v & 0xFF);
}

/** Encode an ASCII string as bytes. */
function encodeText(str) {
  return [...str].map(c => c.charCodeAt(0) & 0xFF);
}

// ── Chunk builders ────────────────────────────────────────────────────────────

function buildHeader() {
  const bytes = [];
  bytes.push(0x4D, 0x54, 0x68, 0x64); // 'MThd'
  pushUint32(bytes, 6);                // chunk length = 6
  pushUint16(bytes, 0);                // format 0
  pushUint16(bytes, 1);                // 1 track
  pushUint16(bytes, PPQ);              // 480 PPQ
  return bytes;
}

function buildTrack(trackBytes) {
  const bytes = [];
  bytes.push(0x4D, 0x54, 0x72, 0x6B); // 'MTrk'
  pushUint32(bytes, trackBytes.length);
  bytes.push(...trackBytes);
  return bytes;
}

// ── Meta event helpers ────────────────────────────────────────────────────────

function metaTempo(deltaBytes, microspb) {
  return [
    ...deltaBytes,
    0xFF, 0x51, 0x03,
    (microspb >>> 16) & 0xFF,
    (microspb >>>  8) & 0xFF,
     microspb         & 0xFF,
  ];
}

function metaTimeSig(deltaBytes, [num, den]) {
  const denPow = Math.round(Math.log2(den)); // 4→2, 8→3
  return [
    ...deltaBytes,
    0xFF, 0x58, 0x04,
    num, denPow,
    24,  // MIDI clocks per metronome click
    8,   // 32nd notes per MIDI quarter
  ];
}

function metaTrackName(deltaBytes, name) {
  const text = encodeText(name);
  return [...deltaBytes, 0xFF, 0x03, ...encodeVLQ(text.length), ...text];
}

function metaEndOfTrack(deltaBytes) {
  return [...deltaBytes, 0xFF, 0x2F, 0x00];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a Format-0 SMF from an array of note events.
 *
 * @param {object[]} events     - NoteEvents: {tick, duration, pitch, velocity?, isRest?}
 * @param {number}   bpm        - Tempo (default 120)
 * @param {number[]} timeSig    - [numerator, denominator] (default [4, 4])
 * @param {object}   [options]
 * @param {number}   [options.program]    - GM program 0–127 (default 0 = Grand Piano)
 * @param {string}   [options.trackName]  - Embedded track name (default 'Melody')
 * @param {number}   [options.channel]    - MIDI channel 0–15 (default 0)
 * @returns {Uint8Array}
 */
export function buildMidi(events, bpm = 120, timeSig = [4, 4], {
  program   = 0,
  trackName = 'Melody',
  channel   = 0,
} = {}) {
  const microsPerBeat = Math.round(60_000_000 / bpm);
  const ch = channel & 0x0F;

  // ── 1. Expand note events into (tick, priority, bytes) messages ───────────
  //   priority 0 = note-off  (fires before note-on at the same tick)
  //   priority 1 = note-on
  const messages = [];

  for (const e of events) {
    if (e.isRest) continue;
    const vel   = Math.max(1, Math.min(127, Math.round(e.velocity ?? 80)));
    const pitch = Math.max(0, Math.min(127, Math.round(e.pitch)));

    messages.push({ tick: e.tick,              priority: 1, bytes: [0x90 | ch, pitch, vel] });
    messages.push({ tick: e.tick + e.duration, priority: 0, bytes: [0x80 | ch, pitch, 0]  });
  }

  messages.sort((a, b) => a.tick - b.tick || a.priority - b.priority);

  // ── 2. Build track data ───────────────────────────────────────────────────
  const track = [];
  const d0    = encodeVLQ(0);

  track.push(...metaTempo(d0, microsPerBeat));
  track.push(...metaTimeSig(d0, timeSig));
  track.push(...metaTrackName(d0, trackName));

  // Program change
  track.push(...d0, 0xC0 | ch, program & 0x7F);

  let cursor = 0;
  for (const msg of messages) {
    track.push(...encodeVLQ(msg.tick - cursor), ...msg.bytes);
    cursor = msg.tick;
  }

  track.push(...metaEndOfTrack(d0));

  // ── 3. Assemble file ──────────────────────────────────────────────────────
  return new Uint8Array([...buildHeader(), ...buildTrack(track)]);
}

/**
 * Trigger a browser download of a MIDI Uint8Array.
 *
 * @param {Uint8Array} uint8Array
 * @param {string}     filename
 */
export function download(uint8Array, filename = 'melody.mid') {
  const blob = new Blob([uint8Array], { type: 'audio/midi' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Validation parser (Node-friendly, no DOM) ─────────────────────────────────

/**
 * Parse a MIDI Uint8Array and return a summary for testing.
 * Reads tempo, time signature, and note events from a Format-0 file.
 *
 * @param {Uint8Array} buf
 * @returns {{ bpm: number, timeSig: number[], ppq: number, notes: object[] }}
 */
export function parseMidi(buf) {
  let i = 0;

  function readUint32() {
    return ((buf[i++] << 24) | (buf[i++] << 16) | (buf[i++] << 8) | buf[i++]) >>> 0;
  }
  function readUint16() {
    return ((buf[i++] << 8) | buf[i++]) >>> 0;
  }
  function readVLQ() {
    let v = 0;
    let b;
    do { b = buf[i++]; v = (v << 7) | (b & 0x7F); } while (b & 0x80);
    return v;
  }

  // Header
  i += 4;                   // 'MThd'
  i += 4;                   // length
  i += 2;                   // format
  i += 2;                   // numTracks
  const ppq = readUint16();

  // Track
  i += 4;                   // 'MTrk'
  const trackLen = readUint32();
  const trackEnd = i + trackLen;

  let bpm = 120;
  const timeSig = [4, 4];
  const notes   = [];
  const active  = new Map(); // pitch → { tick, velocity }
  let tick = 0;

  while (i < trackEnd) {
    tick += readVLQ();
    const status = buf[i++];

    if (status === 0xFF) {
      // Meta event
      const type = buf[i++];
      const len  = readVLQ();
      if (type === 0x51) {
        const us = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
        bpm = Math.round(60_000_000 / us);
      } else if (type === 0x58) {
        timeSig[0] = buf[i];
        timeSig[1] = 1 << buf[i + 1];
      }
      i += len;
    } else if ((status & 0xF0) === 0x90) {
      // Note on
      const pitch = buf[i++], vel = buf[i++];
      if (vel > 0) active.set(pitch, { tick, velocity: vel });
      else if (active.has(pitch)) {
        const on = active.get(pitch);
        notes.push({ tick: on.tick, duration: tick - on.tick, pitch, velocity: on.velocity });
        active.delete(pitch);
      }
    } else if ((status & 0xF0) === 0x80) {
      // Note off
      const pitch = buf[i++]; i++; // velocity ignored
      if (active.has(pitch)) {
        const on = active.get(pitch);
        notes.push({ tick: on.tick, duration: tick - on.tick, pitch, velocity: on.velocity });
        active.delete(pitch);
      }
    } else {
      // Other channel events — skip data bytes
      const type = status & 0xF0;
      if (type === 0xC0 || type === 0xD0) i += 1;      // 1 data byte
      else if (type !== 0xF0)             i += 2;      // 2 data bytes
    }
  }

  return { bpm, timeSig, ppq, notes };
}
