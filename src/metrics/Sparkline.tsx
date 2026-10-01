import { useEffect, useRef } from 'react';

const HEIGHT = 72;

/** 최근 값의 흐름을 선 하나로 그린다. 세로축은 0부터 최댓값까지 */
export function Sparkline({ values }: { values: readonly number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const width = canvas.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const finite = values.filter(Number.isFinite);
    if (finite.length < 2) return;
    // 0을 바닥으로 고정해야 "조금 출렁임"과 "계속 증가"가 구분된다
    const max = Math.max(...finite) || 1;
    const step = width / (values.length - 1);

    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    values.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      const x = i * step;
      const y = HEIGHT - 2 - (value / max) * (HEIGHT - 6);
      if (started) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      started = true;
    });
    ctx.stroke();
  }, [values]);

  return <canvas ref={canvasRef} className="sparkline" style={{ height: HEIGHT }} />;
}
