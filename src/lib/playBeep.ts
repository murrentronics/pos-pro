export function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 2400;
    osc.type = "square";
    gain.gain.value = 0.25;
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {
    // Silently fail on browsers that don't support Web Audio
  }
}
