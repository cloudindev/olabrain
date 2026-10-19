/**
 * Polls the RMS level of an audio track every ~10 ms with Web Audio.
 * Uses setInterval (not requestAnimationFrame) so measurements keep running when the
 * tab is not focused. The analyser is not connected to the speakers.
 */
export function startLevelMeter(
  track: MediaStreamTrack,
  onLevel: (rms: number, now: number) => void,
  intervalMs = 10,
): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  void context.resume().catch(() => undefined);

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    onLevel(Math.sqrt(sum / buffer.length), performance.now());
  }, intervalMs);

  return () => {
    window.clearInterval(timer);
    source.disconnect();
    void context.close().catch(() => undefined);
  };
}
