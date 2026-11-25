import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';
import { getTime } from '../player/store';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
  /** Smoothly follow the native audio clock without React renders. */
  smooth?: boolean;
  playing?: boolean;
}

/**
 * Lightweight, accessible iOS-style scrubber.
 * No WebGL, canvas invalidation or per-pointer-event React state updates:
 * pointer movement paints directly to the two slider layers and coalesces
 * callbacks to one requestAnimationFrame. This avoids expensive rendering work during a drag.
 */
export default function FrostedSlider({
  value,
  min = 0,
  max = 1,
  step = 0,
  label,
  onChange,
  onCommit,
  className = '',
  smooth = false,
  playing = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;
  const state = useRef({ dragging: false, value });
  const span = Math.max(Number.EPSILON, max - min);

  const paint = useCallback((next: number) => {
    const progress = Math.min(1, Math.max(0, (next - min) / span));
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress})`;
    if (thumbRef.current) thumbRef.current.style.left = `${progress * 100}%`;
  }, [min, span]);

  const emitChange = useCallback((next: number) => {
    pendingRef.current = next;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending != null) callbackRef.current?.(pending);
    });
  }, []);

  const flushChange = useCallback((next: number) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingRef.current = null;
    callbackRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!state.current.dragging) {
      state.current.value = value;
      paint(value);
    }
  }, [paint, value]);

  // Animate playback progress directly from HTMLAudioElement.currentTime.
  // This keeps the scrubber visually smooth between the browser's slower timeupdate events.
  useEffect(() => {
    if (!smooth || !playing) return;
    let raf = 0;
    const tick = () => {
      if (!state.current.dragging) paint(Math.min(max, Math.max(min, getTime())));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [smooth, playing, min, max, paint]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const valueFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect() ?? rootRef.current?.getBoundingClientRect();
    if (!rect) return state.current.value;
    let next = min + ((clientX - rect.left) / Math.max(1, rect.width)) * span;
    next = Math.min(max, Math.max(min, next));
    if (!step) return next;
    return Math.min(max, Math.max(min, Math.round((next - min) / step) * step + min));
  };

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    rootRef.current?.setPointerCapture(event.pointerId);
    state.current.dragging = true;
    rootRef.current?.classList.add('down');
    const next = valueFromPointer(event.clientX);
    state.current.value = next;
    paint(next);
    if (onChange) emitChange(next);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!state.current.dragging) return;
    const next = valueFromPointer(event.clientX);
    state.current.value = next;
    paint(next);
    if (onChange) emitChange(next);
  };

  const finish = () => {
    if (!state.current.dragging) return;
    state.current.dragging = false;
    rootRef.current?.classList.remove('down');
    const finalValue = state.current.value;
    if (onChange) flushChange(finalValue);
    onCommit?.(finalValue);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const increment = step || span / 100;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    let next = state.current.value;
    if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (direction) next = Math.min(max, Math.max(min, next + increment * direction));
    else return;
    event.preventDefault();
    state.current.value = next;
    paint(next);
    onChange?.(next);
    onCommit?.(next);
  };

  return (
    <div
      ref={rootRef}
      className={`fslider ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(state.current.value * 100) / 100}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={keyDown}
      style={{ '--slider-progress': `${Math.min(1, Math.max(0, (value - min) / span)) * 100}%` } as CSSProperties}
    >
      <div className="ftrack" ref={trackRef}>
        <div className="ffill" ref={fillRef} />
      </div>
      <div className="fthumb" ref={thumbRef} aria-hidden="true"><span className="fthumb-content" /></div>
    </div>
  );
}
