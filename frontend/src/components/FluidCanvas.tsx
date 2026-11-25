import { useEffect, useRef } from 'react';

type Props = {
  className?: string;
  tint?: string;
  active?: boolean;
  quality?: 'ambient' | 'hero' | 'art';
};

function parseTint(value: string): [number, number, number] {
  const values = value.split(',').map(part => Number(part.trim()));
  return values.length === 3 && values.every(Number.isFinite)
    ? [values[0], values[1], values[2]].map(n => Math.max(0, Math.min(255, n))) as [number, number, number]
    : [126, 92, 118];
}

function mix(a: number, b: number, amount: number): number {
  return Math.round(a + (b - a) * amount);
}

/** Low-resolution ambient colour field. All highlights stay within the current artwork hue. */
export default function FluidCanvas({ className = '', tint = '126, 92, 118', active = true, quality = 'ambient' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const contextOrNull = canvas.getContext('2d', { alpha: true });
    if (!contextOrNull) return;
    // Capture a non-null context for callbacks/animation closures. TypeScript
    // cannot reliably preserve optional-chain narrowing across nested functions.
    const context: CanvasRenderingContext2D = contextOrNull;

    const base = parseTint(tint);
    const light: [number, number, number] = base.map(channel => mix(channel, 255, 0.24)) as [number, number, number];
    const deep: [number, number, number] = base.map(channel => mix(channel, 0, 0.28)) as [number, number, number];
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fps = quality === 'hero' ? 24 : quality === 'art' ? 20 : 14;
    const frameDelay = 1000 / fps;
    let frame = 0;
    let timer = 0;
    let visible = !document.hidden;
    let width = 1;
    let height = 1;
    let dpr = 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, quality === 'hero' ? 0.9 : 0.75);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now(), false);
    };

    const bloom = (x: number, y: number, radius: number, color: [number, number, number], alpha: number) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${color.join(',')},${alpha})`);
      gradient.addColorStop(0.46, `rgba(${color.join(',')},${alpha * 0.28})`);
      gradient.addColorStop(1, `rgba(${color.join(',')},0)`);
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    const schedule = () => {
      if (!active || reducedMotion || !visible) return;
      timer = window.setTimeout(() => { frame = requestAnimationFrame(now => draw(now, true)); }, frameDelay);
    };

    function draw(now: number, animate: boolean) {
      if (!visible && animate) return;
      const time = animate && active && !reducedMotion ? now / 1000 : 0.8;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'screen';
      const radius = Math.max(width, height) * 0.72;
      bloom(width * (0.16 + Math.sin(time * 0.13) * 0.045), height * 0.16, radius, light, 0.26);
      bloom(width * (0.84 + Math.cos(time * 0.10) * 0.04), height * (0.52 + Math.sin(time * 0.12) * 0.04), radius * 0.92, base, 0.23);
      bloom(width * 0.52, height * (0.94 + Math.cos(time * 0.09) * 0.025), radius * 0.70, deep, 0.22);
      context.globalCompositeOperation = 'source-over';
      if (animate) schedule();
    }

    const observer = new ResizeObserver(resize);
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) {
        if (timer) window.clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
        draw(performance.now(), active && !reducedMotion);
      } else {
        if (timer) window.clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
      }
    };
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    if (active && !reducedMotion) schedule();

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [active, quality, tint]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
