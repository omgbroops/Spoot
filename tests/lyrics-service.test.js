import test from "node:test";
import assert from "node:assert/strict";

import {
  LyricsService,
  normalizeLrclibLyrics,
  parseLrc,
} from "../src/js/lyrics/lyrics-service.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("LRC parsing preserves millisecond timing", () => {
  const lrc = parseLrc("[00:00.50]First line\n[00:02.250]Second line");
  assert.equal(lrc.find((line) => line.text === "First line").startMs, 500);
  assert.equal(lrc.find((line) => line.text === "Second line").startMs, 2_250);
});

test("plain and instrumental LRCLIB responses normalize without fake timing", () => {
  const plain = normalizeLrclibLyrics({ plainLyrics: "Line one\nLine two" });
  assert.equal(plain.synced, false);
  assert.deepEqual(plain.lines.map((line) => line.text), ["Line one", "Line two"]);
  const instrumental = normalizeLrclibLyrics({ instrumental: true });
  assert.equal(instrumental.instrumental, true);
  assert.deepEqual(instrumental.lines, []);
});

test("lyrics service uses a direct CORS-simple LRCLIB request", async () => {
  const requests = [];
  const service = new LyricsService({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("lrclib.net/api/get")) {
        return jsonResponse({ syncedLyrics: "[00:01.00]Synced fallback" });
      }
      return jsonResponse([]);
    },
  });

  const lyrics = await service.getLyrics({
    id: "track-1",
    uri: "spotify:track:track-1",
    title: "Signal Path",
    artist: "Static Bloom",
    albumName: "Transmission",
    durationMs: 180_000,
    artworkUrl: "https://images.example/cover.jpg",
  });

  assert.equal(lyrics.source, "lrclib");
  assert.equal(lyrics.synced, true);
  assert.equal(lyrics.lines.find((line) => line.text).text, "Synced fallback");
  assert.match(requests[0].url, /^https:\/\/lrclib\.net\/api\/get\?/u);
  assert.equal(requests[0].options.headers, undefined);
  assert.equal(requests[0].options.credentials, undefined);
  assert.doesNotMatch(requests.map((request) => request.url).join("\n"), /spicylyrics|color-lyrics/u);
});

test("LRCLIB uses broad and field searches and persistently caches one automatic no-match result", async () => {
  const requests = [];
  const service = new LyricsService({
    fetchImpl: async (url) => {
      const parsed = new URL(url, "http://127.0.0.1:5173");
      requests.push(parsed);
      return parsed.pathname.endsWith("/get")
        ? jsonResponse({ message: "not found" }, 404)
        : jsonResponse([]);
    },
  });
  const track = {
    id: "track-missing",
    title: "No Signal",
    artist: "Static Bloom",
    albumName: "Transmission",
    durationMs: 180_000,
  };

  assert.equal((await service.getLyrics(track)).detail, "not-found");
  assert.equal((await service.getLyrics(track)).detail, "not-found");
  assert.equal(requests.length, 3);
  assert.ok(requests.some((url) => url.searchParams.has("q")));
  assert.ok(requests.some((url) => url.searchParams.has("track_name")));
});

test("manual lyrics persistently outrank embedded and automatic LRCLIB lyrics", async () => {
  const { LyricsStore } = await import("../src/js/lyrics/lyrics-store.js");
  const store = new LyricsStore({ indexedDBImpl: null });
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return jsonResponse({ syncedLyrics: "[00:01.00]Provider line" });
  };
  const track = {
    id: "local-priority",
    uri: "spoot:local:local-priority",
    title: "Priority",
    artist: "Spoot",
    isLocal: true,
    lyrics: "[00:00.50]Embedded line",
  };

  const first = new LyricsService({ store, fetchImpl });
  assert.equal((await first.getLyrics(track)).source, "embedded");
  assert.equal(fetchCount, 0);
  await first.save(track, "[00:02.00]My edited line", { source: "manual", userModified: true });

  const restored = new LyricsService({ store, fetchImpl });
  const lyrics = await restored.getLyrics({ ...track, lyrics: "[00:00.50]Different embedded line" });
  assert.equal(lyrics.source, "manual");
  assert.equal(lyrics.lines.find((line) => line.text)?.text, "My edited line");
  assert.equal(fetchCount, 0);
});

test("embedded local lyrics replace an automatic LRCLIB cache but never a manual edit", async () => {
  const { LyricsStore } = await import("../src/js/lyrics/lyrics-store.js");
  const store = new LyricsStore({ indexedDBImpl: null });
  const track = { id: "local-late-embed", uri: "spoot:local:local-late-embed", title: "Late embed", artist: "Spoot", isLocal: true };
  await store.put({
    key: "local:local-late-embed",
    text: "[00:01.00]Cached provider",
    source: "lrclib",
    autoFetchAttempted: true,
  });
  const service = new LyricsService({ store, fetchImpl: async () => jsonResponse([]) });
  const embedded = await service.getLyrics({ ...track, lyrics: "[00:02.00]Embedded wins" });
  assert.equal(embedded.source, "embedded");
  assert.equal(embedded.lines.find((line) => line.text)?.text, "Embedded wins");

  await service.save(track, "[00:03.00]Manual wins", { source: "manual", userModified: true });
  const restored = new LyricsService({ store, fetchImpl: async () => jsonResponse([]) });
  const manual = await restored.getLyrics({ ...track, lyrics: "[00:04.00]New embedded" });
  assert.equal(manual.source, "manual");
  assert.equal(manual.lines.find((line) => line.text)?.text, "Manual wins");
});
