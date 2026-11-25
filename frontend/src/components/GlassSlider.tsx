import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
}

/** Native, lightweight Apple Music-style glass range control. */
export default function GlassSlider({ value, min = 0, max = 1, step = 0, label, onChange, onCommit, className = '' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const dragging = useRef(false);
  const span = Math.max(Number.EPSILON, max - min);

  const paint = useCallback((next: number) => {
    const progress = Math.min(1, Math.max(0, (next - min) / span));
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress})`;
    if (thumbRef.current) thumbRef.current.style.left = `${progress * 100}%`;
    rootRef.current?.setAttribute('aria-valuenow', String(Math.round(next * 100) / 100));
  }, [min, span]);

  useEffect(() => {
    if (!dragging.current) {
      valueRef.current = value;
      paint(value);
    }
  }, [paint, value]);

  const fromPointer = (clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return min;
    let next = min + ((clientX - rect.left) / Math.max(1, rect.width)) * span;
    next = Math.min(max, Math.max(min, next));
    return step > 0 ? Math.min(max, Math.max(min, Math.round((next - min) / step) * step + min)) : next;
  };

  const update = (next: number) => {
    valueRef.current = next;
    paint(next);
    onChange?.(next);
  };

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    rootRef.current?.setPointerCapture(event.pointerId);
    rootRef.current?.classList.add('down');
    update(fromPointer(event.clientX));
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    update(fromPointer(event.clientX));
  };

  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    rootRef.current?.classList.remove('down');
    onCommit?.(valueRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const increment = step || span / 20;
    let next = valueRef.current;
    if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(max, next + increment);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(min, next - increment);
    else return;
    event.preventDefault();
    update(next);
    onCommit?.(next);
  };

  return (
    <div
      ref={rootRef}
      className={`gslider ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={onKeyDown}
      style={{ '--stretch': '0' } as CSSProperties}
    >
      <div className="gtrack"><div className="gfill" ref={fillRef} /></div>
      <div className="gthumb" ref={thumbRef}><span className="gthumb-content" aria-hidden="true" /></div>
    </div>
  );
}
