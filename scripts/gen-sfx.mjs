// Generates the platform's tiny SFX set as 16-bit PCM WAVs into public/sfx/.
// All synthesized — no bundled assets. Run: node scripts/gen-sfx.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const SR = 22050;
const sec = (n) => Math.floor(n * SR);

// ADSR-ish envelope: fast attack, exponential decay.
function tone(freq, dur, { vol = 0.5, attack = 0.005, decay = 0.9, type = "sine", bend = 0 } = {}) {
  const n = sec(dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq * Math.pow(2, bend * t);
    const phase = 2 * Math.PI * f * t;
    let s = type === "square" ? Math.sign(Math.sin(phase)) * 0.6 : Math.sin(phase);
    const a = Math.min(1, t / attack);
    const d = Math.exp(-decay * 8 * t);
    out[i] = s * vol * a * d;
  }
  return out;
}

function mix(...tracks) {
  const n = Math.max(...tracks.map((t) => t.samples.length + t.at));
  const out = new Float32Array(n);
  for (const { samples, at } of tracks) for (let i = 0; i < samples.length; i++) out[at + i] += samples[i];
  return out;
}

const T = (samples, atMs = 0) => ({ samples, at: sec(atMs / 1000) });

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767, 44 + i * 2);
  return buf;
}

const SFX = {
  // Soft two-note ping for incoming notifications.
  notify: mix(
    T(tone(1046.5, 0.16, { vol: 0.42 })),
    T(tone(1568, 0.22, { vol: 0.38 }), 90)
  ),
  // Coin-chime arpeggio for claims/rewards.
  claim: mix(
    T(tone(987.77, 0.1, { vol: 0.4, type: "square" })),
    T(tone(1318.5, 0.1, { vol: 0.4, type: "square" }), 75),
    T(tone(1568, 0.24, { vol: 0.42, type: "square" }), 150)
  ),
  // Single crisp tick for a filled trade.
  trade: tone(1760, 0.09, { vol: 0.4, decay: 1.6 }),
  // Rising fanfare for a win.
  win: mix(
    T(tone(523.25, 0.11, { vol: 0.4 })),
    T(tone(659.25, 0.11, { vol: 0.4 }), 95),
    T(tone(783.99, 0.11, { vol: 0.4 }), 190),
    T(tone(1046.5, 0.3, { vol: 0.45 }), 285)
  ),
  // Low two-step drop for a loss.
  lose: mix(
    T(tone(392, 0.16, { vol: 0.34, bend: -1 })),
    T(tone(261.6, 0.3, { vol: 0.36, bend: -0.5 }), 140)
  ),
};

mkdirSync("public/sfx", { recursive: true });
for (const [name, samples] of Object.entries(SFX)) {
  writeFileSync(`public/sfx/${name}.wav`, wav(samples));
  console.log(`${name}.wav`, samples.length, "samples");
}
