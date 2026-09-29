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

// Filtered noise burst — whooshes and rattles.
function noise(dur, { vol = 0.2, bright = false } = {}) {
  const n = sec(dur);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    lp = bright ? w : lp * 0.72 + w * 0.28;
    const t = i / SR;
    out[i] = lp * vol * Math.min(1, t / 0.008) * Math.exp(-3.2 * t);
  }
  return out;
}

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
  // Coin flip — a soft whoosh under a quick metallic ping.
  flip: mix(
    T(noise(0.32, { vol: 0.16, bright: false })),
    T(tone(2093, 0.12, { vol: 0.3, bend: 0.7 }), 60),
    T(tone(2637, 0.14, { vol: 0.26 }), 190)
  ),
  // Dice rattle — six quick fading clicks.
  roll: mix(
    ...[0, 60, 125, 195, 275, 360].map((at, i) =>
      T(tone(2400 - i * 160, 0.05, { vol: 0.3, type: "square", decay: 2.6 }), at)
    )
  ),
  // Wheel spin — a decelerating tick train (~2.8s to match the spin CSS).
  spin: (() => {
    const ticks = [];
    let at = 0;
    for (let i = 0; i < 26; i++) {
      const dur = 0.045;
      ticks.push(T(tone(1500 - i * 22, dur, { vol: Math.max(0.08, 0.3 - i * 0.008), type: "square", decay: 3 }), at));
      at += 45 + i * i * 0.55;
    }
    return mix(...ticks);
  })(),
  // Limbo launch — rising sweep with a lift-off shimmer.
  launch: mix(
    T(tone(440, 0.4, { vol: 0.3, bend: 1.6 })),
    T(noise(0.35, { vol: 0.1, bright: true }), 40),
    T(tone(1318, 0.18, { vol: 0.3 }), 300)
  ),
};

mkdirSync("public/sfx", { recursive: true });
for (const [name, samples] of Object.entries(SFX)) {
  writeFileSync(`public/sfx/${name}.wav`, wav(samples));
  console.log(`${name}.wav`, samples.length, "samples");
}
