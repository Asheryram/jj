// An upbeat backing track, made from nothing but maths: no samples, no licensing.
//
//   node music.mjs out.wav [bpm]
//
// 124 BPM, four-on-the-floor kick, claps on 2 and 4, off-beat hi-hats, a driving
// eighth-note bass and a bright sixteenth-note arpeggio over C - G - Am - F.
// Eight bars long, built so the end meets the start, so it loops without a seam.
import { writeFileSync } from 'node:fs'

const RATE = 44100
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

// Two bars per chord: root (for the bass) and chord tones (for the arpeggio).
const PROGRESSION = [
  { root: 36, tones: [60, 64, 67, 72] }, // C
  { root: 43, tones: [59, 62, 67, 71] }, // G
  { root: 45, tones: [60, 64, 69, 72] }, // Am
  { root: 41, tones: [60, 65, 69, 72] }, // F
]

export function synth(bpm = 124) {
  const beat = 60 / bpm
  const bars = 8
  const length = Math.round(bars * 4 * beat * RATE)
  const left = new Float32Array(length)
  const right = new Float32Array(length)

  /** Add a mono sound at `at` seconds, panned from -1 (left) to 1 (right). */
  const add = (at, samples, gain, pan = 0) => {
    const start = Math.round(at * RATE)
    const l = gain * Math.min(1, 1 - pan)
    const r = gain * Math.min(1, 1 + pan)
    for (let i = 0; i < samples.length && start + i < length; i++) {
      left[start + i] += samples[i] * l
      right[start + i] += samples[i] * r
    }
  }

  const make = (seconds, fn) => {
    const out = new Float32Array(Math.round(seconds * RATE))
    for (let i = 0; i < out.length; i++) out[i] = fn(i / RATE, i)
    return out
  }

  // Deterministic noise, so every build sounds the same.
  let seed = 12345
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

  const kick = make(0.28, (t) => {
    const phase = 2 * Math.PI * (45 * t + (105 / 22) * (1 - Math.exp(-22 * t)))
    return Math.sin(phase) * Math.exp(-9 * t) * (1 - Math.exp(-900 * t))
  })

  const clap = make(0.22, (t) => {
    const bursts = [0, 0.011, 0.022].reduce((sum, d) => sum + (t > d ? Math.exp(-60 * (t - d)) : 0), 0)
    return noise() * (bursts * 0.5 + Math.exp(-18 * t) * 0.5)
  })

  const hat = (open) => {
    let previous = 0
    return make(open ? 0.16 : 0.05, (t) => {
      const value = noise()
      const high = value - previous // crude high-pass
      previous = value
      return high * Math.exp(-(open ? 22 : 90) * t)
    })
  }
  const closedHat = hat(false)
  const openHat = hat(true)

  const bass = (freq, seconds) => {
    let low = 0
    return make(seconds, (t) => {
      const saw = 2 * ((freq * t) % 1) - 1
      low += 0.12 * (saw - low) // one-pole low-pass keeps it round
      return (low + 0.5 * Math.sin(2 * Math.PI * freq * t)) * Math.exp(-6 * t) * Math.min(1, t * 400)
    })
  }

  const pluck = (freq, seconds) =>
    make(seconds, (t) => {
      const tone = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) + 0.15 * Math.sin(6 * Math.PI * freq * t)
      return tone * Math.exp(-11 * t) * Math.min(1, t * 600)
    })

  const pad = (freqs, seconds) =>
    make(seconds, (t) => {
      const swell = Math.min(1, t * 3) * Math.min(1, (seconds - t) * 3)
      return freqs.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.004 * t), 0) * 0.04 * swell
    })

  for (let bar = 0; bar < bars; bar++) {
    const chord = PROGRESSION[Math.floor(bar / 2)]
    const barStart = bar * 4 * beat

    add(barStart, pad(chord.tones.map(hz), 4 * beat), 0.55)

    for (let step = 0; step < 4; step++) {
      const at = barStart + step * beat
      add(at, kick, 1.0)
      if (step % 2 === 1) add(at, clap, 0.35)
      add(at + beat / 2, step === 3 ? openHat : closedHat, 0.22, 0.3)
    }

    // Eighth-note bass, jumping an octave on the off-beats.
    for (let eighth = 0; eighth < 8; eighth++) {
      const note = chord.root + (eighth % 2 === 1 ? 12 : 0)
      add(barStart + eighth * (beat / 2), bass(hz(note), beat / 2), 0.5)
    }

    // Sixteenth-note arpeggio, walking up and back down the chord.
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]
    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      const tone = chord.tones[pattern[sixteenth]] + 12
      add(barStart + sixteenth * (beat / 4), pluck(hz(tone), beat), 0.16, sixteenth % 2 ? 0.45 : -0.45)
    }
  }

  // Normalise to a safe peak.
  let peak = 0
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  const scale = 0.85 / peak
  return { left, right, scale, length }
}

export function writeWav(file, { left, right, scale, length }) {
  const data = Buffer.alloc(length * 4)
  for (let i = 0; i < length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * scale)) * 32767), i * 4)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * scale)) * 32767), i * 4 + 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(2, 22) // stereo
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([header, data]))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const file = process.argv[2] ?? 'music.wav'
  writeWav(file, synth(Number(process.argv[3]) || 124))
  console.log(`wrote ${file}`)
}
