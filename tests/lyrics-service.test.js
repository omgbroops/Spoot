import test from "node:test";
import assert from "node:assert/strict";

import {
  LyricsService,
  normalizeLrclibLyrics,
  normalizeSpicyLyrics,
  normalizeSpotifyLyrics,
  parseLrc,
} from "../src/js/lyrics/lyrics-service.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("lyrics normalizers preserve millisecond timing for LRC, Spotify, and SpicyLyrics", () => {
  const lrc = parseLrc("[00:00.50]First line\n[00:02.250]Second line");
  assert.equal(lrc.find((line) => line.text === "First line").startMs, 500);
  assert.equal(lrc.find((line) => line.text === "Second line").startMs, 2_250);

  const spotify = normalizeSpotifyLyrics({
    lyrics: {
      lines: [
        { startTimeMs: "500", endTimeMs: "1750", words: "First line" },
        { startTimeMs: "1750", endTimeMs: "3200", words: "Second line" },
      ],
    },
  });
  assert.equal(spotify.lines.find((line) => line.text === "First line").startMs, 500);

  const spicy = normalizeSpicyLyrics({
    Type: "Syllable",
    Content: [{
      Lead: {
        Syllables: [
          { Text: "Silver", IsPartOfWord: false, StartTime: 1.2, EndTime: 1.8 },
          { Text: "thread", IsPartOfWord: false, StartTime: 1.8, EndTime: 2.4 },
        ],
      },
    }],
  });
  assert.equal(spicy.lines.find((line) => line.text === "Silver thread").startMs, 1_200);
  assert.equal(spicy.synced, true);
});

test("plain and instrumental LRCLIB responses normalize without fake timing", () => {
  const plain = normalizeLrclibLyrics({ plainLyrics: "Line one\nLine two" });
  assert.equal(plain.synced, false);
  assert.deepEqual(plain.lines.map((line) => line.text), ["Line one", "Line two"]);
  const instrumental = normalizeLrclibLyrics({ instrumental: true });
  assert.equal(instrumental.instrumental, true);
  assert.deepEqual(instrumental.lines, []);
});

test("lyrics service defers static SpicyLyrics until synced LRCLIB fallbacks are checked", async () => {
  const requests = [];
  const service = new LyricsService({
    tokenProvider: async () => "spotify-access-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("spicylyrics.org/query")) {
        return jsonResponse({
          queries: [{
            result: {
              httpStatus: 200,
              data: { Type: "Static", Lines: [{ Text: "Static fallback" }] },
            },
          }],
        });
      }
      if (String(url).includes("color-lyrics")) return jsonResponse({ lyrics: { lines: [] } });
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
  assert.match(requests[0].url, /spicylyrics\.org\/query/u);
  assert.match(requests[1].url, /color-lyrics/u);
  assert.match(requests[2].url, /lrclib\.net\/api\/get/u);
  assert.equal(requests[0].options.headers["SpicyLyrics-WebAuth"], "Bearer spotify-access-token");
  assert.doesNotMatch(requests.map((request) => request.url).join("\n"), /spotify-access-token/u);
});

test("LRCLIB uses broad and field searches and does not cache transient empty results", async () => {
  const requests = [];
  const service = new LyricsService({
    tokenProvider: async () => "",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
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
  assert.equal(requests.length, 6);
  assert.ok(requests.some((url) => url.searchParams.has("q")));
  assert.ok(requests.some((url) => url.searchParams.has("track_name")));
});
