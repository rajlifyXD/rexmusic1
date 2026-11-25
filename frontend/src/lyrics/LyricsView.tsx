import { Fragment, memo, useEffect, useMemo, useRef } from 'react';
import { getTime, seek } from '../player/store';
import type { LyricLine, LyricWord, Lyrics } from '../types';

interface Props { lyrics: Lyrics; offset: number; fontSize: number; autoScroll: boolean }
type IndexedWord = { w: LyricWord; i: number };
type DisplayWord = { text: string; start: number; end: number };

// Providers sometimes return syllable fragments. Group fragments into spoken words
// using the original lyric text and explicit provider spacing when available.
function groups(words: LyricWord[], lineText: string): IndexedWord[][] {
  const out: IndexedWord[][] = [];
  let current: IndexedWord[] = [];
  let cursor = 0;
  const clean = words.map(w => (w.text ?? '').trim());
  const positions = clean.map(text => {
    const at = text ? lineText.indexOf(text, cursor) : -1;
    if (at >= 0) cursor = at + text.length;
    return at;
  });
  const hasSpaceFlag = words.some(w => w.space === true);
  words.forEach((w, i) => {
    current.push({ w, i });
    if (i === words.length - 1) return;
    const a = positions[i], b = positions[i + 1];
    const between = a >= 0 && b >= a ? lineText.slice(a + clean[i].length, b) : '';
    const gap = Number.isFinite(w.end) && Number.isFinite(words[i + 1].start) ? words[i + 1].start - (w.end as number) : 0;
    const boundary = /\s/.test(between) || w.space === true || /[,;:!?。！？、]$/.test(clean[i]) ||
      (a < 0 || b < 0) || (!hasSpaceFlag && gap > 0.09);
    if (boundary) { out.push(current); current = []; }
  });
  if (current.length) out.push(current);
  return out;
}

function buildWordLines(lines: LyricLine[]): DisplayWord[][] {
  return lines.map((line, index) => {
    if (line.words?.length) {
      return groups(line.words, line.text).map(group => ({
        text: group.map(x => x.w.text.trim()).join(''),
        start: group[0].w.start,
        end: group[group.length - 1].w.end ?? group[group.length - 1].w.start + 0.28,
      }));
    }
    // When a provider only supplies line timing, create honest approximate word
    // pacing so the UI remains karaoke-style instead of reverting to whole lines.
    const tokens = Array.from(line.text.matchAll(/\S+/gu), m => ({ text: m[0], at: m.index ?? 0 }));
    if (!tokens.length) return [];
    const start = line.start ?? 0;
    const nextStart = lines[index + 1]?.start;
    const end = line.end ?? (nextStart != null && nextStart > start ? nextStart : start + Math.max(2.2, tokens.length * 0.34));
    const span = Math.max(0.25, end - start);
    const weights = tokens.map(t => Math.max(2, t.text.replace(/[^\p{L}\p{N}]/gu, '').length));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = start;
    return tokens.map((token, i) => {
      const wordStart = cursor;
      cursor = i === tokens.length - 1 ? end : cursor + span * (weights[i] / total);
      return { text: token.text, start: wordStart, end: cursor };
    });
  });
}

function LyricsView({ lyrics, offset, fontSize, autoScroll }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ offset, autoScroll });
  live.current = { offset, autoScroll };
  const synced = lyrics.sync !== 'none';
  const wordLines = useMemo(() => buildWordLines(lyrics.lines), [lyrics]);

  useEffect(() => {
    if (!synced || !box.current) return;
    const el = box.current;
    const lines = Array.from(el.querySelectorAll<HTMLElement>('.ly-line'));
    const starts = lyrics.lines.map(l => l.start ?? Infinity);
    let raf = 0;
    let activeIdx = -2;
    let activeWords: HTMLElement[] = [];
    let lastP: number[] = [];
    let pausedUntil = 0;
    const pauseAutoScroll = () => { pausedUntil = performance.now() + 3000; };
    el.addEventListener('wheel', pauseAutoScroll, { passive: true });
    el.addEventListener('touchstart', pauseAutoScroll, { passive: true });
    el.addEventListener('pointerdown', pauseAutoScroll, { passive: true });

    const loop = (now: number) => {
      if (document.visibilityState === 'visible') {
        const time = getTime() + live.current.offset;
        let lo = 0, hi = starts.length - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (starts[mid] <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (idx !== activeIdx) {
          activeIdx = idx;
          lines.forEach((line, i) => {
            line.classList.toggle('active', i === idx);
            line.classList.toggle('past', i < idx);
            line.dataset.d = String(Math.min(5, Math.abs(i - idx)));
          });
          activeWords = Array.from(lines[idx]?.querySelectorAll<HTMLElement>('.ly-w') ?? []);
          lastP = activeWords.map(() => -1);
          if (live.current.autoScroll && now > pausedUntil && lines[idx]) {
            // Scroll only the lyrics viewport. scrollIntoView() also scrolls
            // ancestors (including the fullscreen player/document) on Android
            // Chrome, which can pull the entire page upward near the final line.
            const target = lines[idx];
            const containerRect = el.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const centeredTop = el.scrollTop + targetRect.top - containerRect.top - (el.clientHeight - targetRect.height) / 2;
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            const nextTop = Math.min(maxTop, Math.max(0, centeredTop));
            el.scrollTo({ top: nextTop, behavior: 'smooth' });
          }
        }
        const model = idx >= 0 ? wordLines[idx] : null;
        if (model && activeWords.length) {
          for (let i = 0; i < activeWords.length; i++) {
            const word = model[i];
            if (!word) continue;
            const progress = time <= word.start ? 0 : time >= word.end ? 1 : (time - word.start) / Math.max(.035, word.end - word.start);
            const quantized = Math.round(progress * 240); // at most one paint per ~1/240 of a word
            if (quantized !== lastP[i]) {
              lastP[i] = quantized;
              activeWords[i].style.setProperty('--p', `${(progress * 100).toFixed(1)}%`);
              activeWords[i].classList.toggle('sung', progress >= 1);
              activeWords[i].classList.toggle('now', progress > 0 && progress < 1);
            }
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', pauseAutoScroll);
      el.removeEventListener('touchstart', pauseAutoScroll);
      el.removeEventListener('pointerdown', pauseAutoScroll);
    };
  }, [lyrics, synced, wordLines]);

  return <div ref={box} className={`ly ly-karaoke ${synced ? '' : 'plain'}`} style={{ fontSize: `${fontSize}px` }}>
    <div className="ly-pad" />
    {lyrics.lines.map((line, i) => <div key={`${i}-${line.start ?? 'u'}`} className="ly-line" data-d="5"
      role={line.start != null ? 'button' : undefined}
      onClick={() => { if (line.start != null) seek(line.start - live.current.offset); }}>
      {wordLines[i].length ? wordLines[i].map((word, wi) => <Fragment key={wi}>{wi > 0 ? ' ' : null}<span className="ly-w" style={{ ['--p' as string]: '0%' }}>{word.text}</span></Fragment>) : line.text || '\u00a0'}
    </div>)}
    <div className="ly-pad" />
  </div>;
}
export default memo(LyricsView);
