export interface Track {
  type?: 'song'; videoId: string; title: string; artist: string; artistId?: string | null;
  album?: string; albumId?: string | null; duration: number; thumb: string; animatedTallThumb?: string;
}
export interface Card { type: 'album' | 'artist' | 'playlist'; id: string; title: string; subtitle?: string; thumb: string }
export type Entity = Track | Card;
export const isTrack = (e: Entity): e is Track => (e as Track).videoId !== undefined;

export interface LyricWord { start: number; end: number | null; text: string; space?: boolean }
export interface LyricLine { start: number | null; end: number | null; text: string; words: LyricWord[] | null }
export interface Lyrics { source: string; sync: 'word' | 'line' | 'none'; lines: LyricLine[]; attribution?: string; wordTiming?: 'source' | 'estimated' }
export interface LyricsResponse { result: Lyrics | null; attempts: { provider: string; status: string }[] }

export interface AnimatedArtwork {
  available: boolean;
  tallUrl?: string | null;
  staticUrl?: string | null;
  temporarilyUnavailable?: boolean;
  status?: 'found' | 'not-found' | 'no-tall-variant' | 'upstream-error' | string;
  error?: string;
  matchedArtist?: string | null;
  matchedAlbum?: string | null;
}
