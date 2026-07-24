const MOCK_LINES = Object.freeze([
  { type: "line", startMs: 0, endMs: 6_000, text: "Signals cross the midnight air" },
  { type: "line", startMs: 6_000, endMs: 12_000, text: "Static blooms in silver light" },
  { type: "line", startMs: 12_000, endMs: 18_000, text: "Follow every fading orbit" },
  { type: "line", startMs: 18_000, endMs: 26_000, text: "Until the frequency feels right" },
]);

export class MockLyricsService {
  async getLyrics() {
    return {
      source: "mock",
      detail: "synced",
      synced: true,
      instrumental: false,
      lines: MOCK_LINES.map((line) => ({ ...line })),
    };
  }
}
