/** A few synthesized blips. No audio files; created lazily after the first user gesture. */
import type { SoundName } from "./defend";

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("aa:muted") === "1";
  } catch {
    return false;
  }
})();
let last: Record<string, number> = {};

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("aa:muted", m ? "1" : "0");
  } catch {}
  if (master) master.gain.value = m ? 0 : 0.11;
}

export function unlock() {
  if (ac) {
    if (ac.state === "suspended") ac.resume();
    return;
  }
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return;
  ac = new Ctor();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.11;
  master.connect(ac.destination);
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 1, slide = 0, delay = 0) {
  if (!ac || !master) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// A minor-pentatonic palette keeps everything consonant.
const PENTA = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];

export function play(name: SoundName, arg = 0) {
  if (!ac || muted) return;
  const now = performance.now();
  const gap = name === "shot" ? 70 : name === "kill" ? 40 : 0;
  if (gap && now - (last[name] ?? 0) < gap) return;
  last[name] = now;
  switch (name) {
    case "place":
      tone(392, 0.12, "triangle", 0.7);
      tone(587.3, 0.16, "triangle", 0.5, 0, 0.06);
      break;
    case "upgrade":
      [0, 1, 2].forEach((k) => tone(PENTA[3 + k + arg], 0.14, "triangle", 0.5, 0, k * 0.06));
      break;
    case "sell":
      tone(440, 0.18, "sine", 0.4, 0.5);
      break;
    case "deny":
      tone(150, 0.12, "square", 0.25);
      break;
    case "shot":
      tone(arg ? 660 : 880, 0.05, "sine", 0.18, 0.7);
      break;
    case "kill":
      tone(PENTA[arg % PENTA.length] * 2, 0.09, "triangle", 0.35, 1.5);
      break;
    case "leak":
      tone(110, 0.35, "sawtooth", 0.35, 0.5);
      break;
    case "wave":
      [0, 2, 4].forEach((k) => tone(PENTA[k], 0.5, "sine", 0.35, 1, k * 0.09));
      break;
    case "over":
      [4, 2, 0].forEach((k, i) => tone(PENTA[k], 0.6, "triangle", 0.4, 0.98, i * 0.18));
      break;
  }
}
