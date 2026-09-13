// Icons for members and channels. Emoji, so there is nothing to download and
// they render on every phone with no network. Stored by key, not glyph, so the
// glyphs can change later without touching saved rosters. Shared by the server
// (validation, defaults) and the browser (display, picker).

export const ICONS = [
  { key: 'vocal', glyph: '🎤', label: 'Vocals', match: ['vocal', 'vox', 'voice', 'sing', 'harmony', 'bv'] },
  { key: 'bass', glyph: '🎻', label: 'Bass', match: ['bass'] },
  { key: 'guitar', glyph: '🎸', label: 'Guitar', match: ['guitar', 'gtr', 'acoustic', 'electric', 'uke'] },
  { key: 'drums', glyph: '🥁', label: 'Drums', match: ['drum', 'kick', 'snare', 'kit', 'tom', 'hat', 'cymbal', 'overhead'] },
  { key: 'keys', glyph: '🎹', label: 'Keys', match: ['key', 'piano', 'synth', 'organ', 'rhodes', 'pad', 'wurli'] },
  { key: 'click', glyph: '🎵', label: 'Click', match: ['click', 'metronome', 'tempo'] },
  { key: 'track', glyph: '🎶', label: 'Tracks', match: ['track', 'backing', 'playback', 'stem', 'loop', 'sample'] },
  { key: 'horns', glyph: '🎺', label: 'Horns', match: ['horn', 'trumpet', 'brass', 'trombone', 'tuba'] },
  { key: 'sax', glyph: '🎷', label: 'Sax', match: ['sax', 'clarinet'] },
  { key: 'perc', glyph: '🪘', label: 'Percussion', match: ['perc', 'conga', 'bongo', 'shaker', 'cajon', 'tabla'] },
  { key: 'mic', glyph: '🎙', label: 'Talkback', match: ['talk', 'mic', 'spoken', 'announce'] },
  { key: 'monitor', glyph: '🎧', label: 'Monitor', match: ['mix', 'monitor', 'iem', 'ear', 'headphone', 'wedge'] },
  { key: 'room', glyph: '🔊', label: 'Room', match: ['room', 'amb', 'audience', 'crowd', 'foh', 'house'] },
  { key: 'dj', glyph: '🎛', label: 'DJ', match: ['dj', 'deck', 'electronic', 'laptop', 'controller'] },
  { key: 'fx', glyph: '✨', label: 'FX', match: ['fx', 'reverb', 'delay', 'effect'] },
];

export const ICON_KEYS = new Set(ICONS.map((icon) => icon.key));

export function glyph(key) {
  return ICONS.find((icon) => icon.key === key)?.glyph ?? '';
}

/** Best-guess icon for a name like "Lead Vox" or "Kick"; '' when nothing fits. */
export function guessIcon(name) {
  const needle = String(name ?? '').toLowerCase();
  if (!needle) return '';
  return ICONS.find((icon) => icon.match.some((word) => needle.includes(word)))?.key ?? '';
}
