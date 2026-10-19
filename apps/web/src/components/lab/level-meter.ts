/**
 * One AudioContext per lab session, created inside the "Conectar" click: Firefox and
 * Safari keep contexts created outside a user gesture suspended, and a suspended
 * analyser only ever reads silence.
 */
export function createMeterContext(): AudioContext {
  const context = new AudioContext();
  void context.resume().catch(() => undefined);
  return context;
}

/**
 * Polls the RMS level of an audio track every ~10 ms with Web Audio.
 * Uses setInterval (not requestAnimationFrame) so measurements keep running when the
 * tab is not focused. The analyser is not connected to the speakers.
 */
export function startLevelMeter(
  context: AudioContext,
  track: MediaStreamTrack,
  onLevel: (rms: number, now: number) => void,
  intervalMs = 10,
): () => void {
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  if (context.state === "suspended") void context.resume().catch(() => undefined);

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    onLevel(Math.sqrt(sum / buffer.length), performance.now());
  }, intervalMs);

  return () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
  };
}
