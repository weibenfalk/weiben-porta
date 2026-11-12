// jsdom has no matchMedia; util.ts reads it at import time
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
})) as unknown as typeof window.matchMedia;
