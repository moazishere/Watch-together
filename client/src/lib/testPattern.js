// An animated canvas as a MediaStreamTrack: lets the in-world screen's video
// pipeline be checked without a LiveKit call. Returns { track, stop }.
export function createTestPatternTrack({ width = 1280, height = 720, fps = 30 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  let frame = 0;
  let raf = 0;

  const draw = () => {
    const bw = width / bars.length;
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * bw, 0, bw + 1, height);
    });
    const x = ((frame * 6) % (width + 200)) - 100;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, height / 2, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000cc';
    ctx.fillRect(0, height - 110, width, 110);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Test pattern · frame ${frame}`, width / 2, height - 38);
    frame++;
    raf = requestAnimationFrame(draw);
  };
  draw();

  const track = canvas.captureStream(fps).getVideoTracks()[0];
  return {
    track,
    stop() {
      cancelAnimationFrame(raf);
      track.stop();
    },
  };
}
