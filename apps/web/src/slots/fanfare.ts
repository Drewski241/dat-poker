/** Original win chime. Do not replace this with a copyrighted recording. */

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audio) audio = new Ctx();
  return audio;
}

/** Call from the spin press so the later chime is allowed to play. */
export function primeFanfare(): void {
  try {
    const ctx = context();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  } catch {
    /* visual celebration still runs */
  }
}

export function playBigWinFanfare(): void {
  try {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.03;
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    for (const [index, freq] of notes.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      const at = start + index * 0.11;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.44);
    }
  } catch {
    /* visual celebration still runs */
  }
}
