// ---------------------------------------------------------------------------
// In-app notification sounds — Apple-inspired, synthesised via Web Audio API
//
// Design principles (à la macOS Sonoma):
//   • Layered harmonics — each note is 2-3 oscillators for warmth
//   • Soft attack — short linear ramp up prevents harsh clicks
//   • Natural exponential decay — sounds "ring out" organically
//   • Subtle detuning — ±1-2 Hz creates gentle chorus / shimmer
//   • Low overall volume — never jarring, always pleasant
//
// Urgency ordering: waiting_input > error > done
//   waiting_input — most action-required; user must respond
//   error         — something went wrong; needs awareness
//   done          — passive completion; least urgent
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  // Resume suspended context (browser autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

// ── Primitives ─────────────────────────────────────────────────────────────

interface ToneLayer {
  freq: number
  type: OscillatorType
  gain: number
  /** Detune in cents (100 = 1 semitone) */
  detune?: number
}

interface ToneOpts {
  /** Layers that compose a single "note" */
  layers: ToneLayer[]
  /** Seconds before this note starts (relative to call time) */
  delay?: number
  /** Attack ramp duration in seconds */
  attack?: number
  /** Total duration (attack + sustain + decay) in seconds */
  duration: number
  /** Master volume multiplier applied to all layer gains (0.0–1.0) */
  volume?: number
}

/** Play a layered tone with soft attack + natural decay */
function playTone(opts: ToneOpts): void {
  const ac = ctx()
  const vol = opts.volume ?? 1.0
  const start = ac.currentTime + (opts.delay ?? 0)
  const attack = opts.attack ?? 0.008
  const end = start + opts.duration

  for (const layer of opts.layers) {
    const osc = ac.createOscillator()
    osc.type = layer.type
    osc.frequency.setValueAtTime(layer.freq, start)
    if (layer.detune) osc.detune.setValueAtTime(layer.detune, start)

    const gain = ac.createGain()
    const peak = layer.gain * vol
    // Soft attack: ramp from silence to target volume
    gain.gain.setValueAtTime(0.001, start)
    gain.gain.linearRampToValueAtTime(peak, start + attack)
    // Natural decay: exponential fall to near-silence
    gain.gain.exponentialRampToValueAtTime(0.001, end)

    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start(start)
    osc.stop(end + 0.05) // small buffer so decay tail isn't clipped
  }
}

// ── Done — tri-tone glass chime (inspired by macOS "Glass") ────────────────
// Three ascending notes with shimmer harmonics — warm, satisfying completion.
// Lowest urgency: softest gain values.

export function playDoneSound(volume = 1.0): void {
  // Note 1: E5
  playTone({
    layers: [
      { freq: 659.25, type: 'sine', gain: 0.08 },
      { freq: 1318.5, type: 'sine', gain: 0.025, detune: 2 }, // octave harmonic
    ],
    duration: 0.35,
    volume,
  })
  // Note 2: G#5
  playTone({
    layers: [
      { freq: 830.6, type: 'sine', gain: 0.08 },
      { freq: 1661.2, type: 'sine', gain: 0.02, detune: -2 },
    ],
    delay: 0.12,
    duration: 0.35,
    volume,
  })
  // Note 3: B5 — the resolve
  playTone({
    layers: [
      { freq: 987.77, type: 'sine', gain: 0.07 },
      { freq: 1975.5, type: 'sine', gain: 0.015, detune: 3 },
      { freq: 493.88, type: 'sine', gain: 0.025 }, // sub-octave for body
    ],
    delay: 0.24,
    duration: 0.5,
    volume,
  })
}

// ── Error — two-note descending hollow tone (inspired by macOS "Basso") ────
// Descending minor second with triangle waves — gentle but clearly "wrong".
// Shifted up one octave (Bb4/A4) vs original (Bb3/A3) for better presence
// at mid gain levels without sacrificing the hollow, grounded character.

export function playErrorSound(volume = 1.0): void {
  // Note 1: Bb4
  playTone({
    layers: [
      { freq: 466.16, type: 'triangle', gain: 0.11 },
      { freq: 932.32, type: 'sine', gain: 0.03, detune: -3 },
    ],
    duration: 0.3,
    attack: 0.012,
    volume,
  })
  // Note 2: A4 — half-step down
  playTone({
    layers: [
      { freq: 440.0, type: 'triangle', gain: 0.10 },
      { freq: 880.0, type: 'sine', gain: 0.025, detune: 3 },
    ],
    delay: 0.15,
    duration: 0.4,
    attack: 0.012,
    volume,
  })
}

// ── Waiting Input — soft double-tap ping (inspired by macOS "Tink") ────────
// Two identical bright pings with a short gap — polite "hey, look here".
// Highest urgency: loudest gain values; user must respond to continue.

export function playWaitingInputSound(volume = 1.0): void {
  const ping = (delay: number): void => {
    playTone({
      layers: [
        { freq: 1174.7, type: 'sine', gain: 0.12 },              // D6
        { freq: 2349.3, type: 'sine', gain: 0.025, detune: 2 },  // octave shimmer
        { freq: 587.33, type: 'triangle', gain: 0.03 },           // sub-octave warmth
      ],
      delay,
      duration: 0.18,
      attack: 0.005,
      volume,
    })
  }
  ping(0)
  ping(0.14)
}

// ── Router ─────────────────────────────────────────────────────────────────

/** Play the appropriate sound for a notification type */
export function playNotificationSound(type: 'done' | 'error' | 'waiting_input', volume = 1.0): void {
  switch (type) {
    case 'done': playDoneSound(volume); break
    case 'error': playErrorSound(volume); break
    case 'waiting_input': playWaitingInputSound(volume); break
  }
}
