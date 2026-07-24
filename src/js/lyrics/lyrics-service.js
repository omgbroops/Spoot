const DEFAULT_LRCLIB_BASE = "https://lrclib.net/api";
const CACHE_LIMIT = 40;

export class LyricsProviderError extends Error {
  constructor(message, { provider, status = null, cause } = {}) {
    super(message, { cause });
    this.name = "LyricsProviderError";
    this.provider = provider;
    this.status = status;
  }
}

function lyricsKey(track) {
  return track?.id || track?.uri || [track?.title, track?.artist, track?.durationMs].join("|");
}

function remember(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function normalizedTrack(track) {
  return {
    id: track?.id || track?.itemId || null,
    uri: track?.uri || track?.itemUri || null,
    title: track?.title || track?.name || "",
    artist: track?.artist || track?.artistNames?.join(", ") || "",
    album: track?.albumName || track?.album?.name || "",
    durationMs: Math.max(0, Number(track?.durationMs || track?.duration_ms) || 0),
  };
}

export class LyricsService {
  constructor({
    fetchImpl = globalThis.fetch,
    onDiagnostic,
    baseUrl = DEFAULT_LRCLIB_BASE,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("LyricsService requires fetch.");
    this.fetchImpl = fetchImpl;
    this.onDiagnostic = onDiagnostic;
    this.baseUrl = String(baseUrl || DEFAULT_LRCLIB_BASE).replace(/\/$/u, "");
    this.cache = new Map();
  }

  async getLyrics(input, { signal } = {}) {
    const track = normalizedTrack(input);
    if (!track.title) return noLyrics("missing-track");
    const key = lyricsKey(track);
    if (this.cache.has(key)) return this.cache.get(key);

    try {
      const lyrics = await this.#fetchLrclib(track, signal);
      if (lyrics?.lines.length || lyrics?.instrumental) {
        remember(this.cache, key, lyrics);
        return lyrics;
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      this.#diagnostic("lrclib", error);
    }

    // A provider outage is not proof that a track has no lyrics. Leave empty
    // results uncached so revisiting the song retries after service recovery.
    return noLyrics();
  }

  #diagnostic(provider, error) {
    this.onDiagnostic?.({
      provider,
      name: error?.name || "Error",
      status: error?.status ?? null,
      message: error?.message || "Lyrics request failed.",
    });
  }

  async #fetchLrclib(track, signal) {
    const exact = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
    });
    if (track.album) exact.set("album_name", track.album);
    if (track.durationMs) exact.set("duration", String(Math.round(track.durationMs / 1000)));

    let candidate = null;
    try {
      candidate = await this.#fetchJson(`${this.baseUrl}/get?${exact}`, { signal });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status !== 404) this.#diagnostic("lrclib-exact", error);
    }

    if (!candidate?.syncedLyrics) {
      const fieldSearch = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artist,
      });
      if (track.album) fieldSearch.set("album_name", track.album);
      const broadSearch = new URLSearchParams({
        q: `${track.title} ${track.artist}`.trim(),
      });
      const runSearch = (params) => this.#fetchJson(`${this.baseUrl}/search?${params}`, { signal })
        .catch((error) => {
          if (error?.name === "AbortError") throw error;
          return [];
        });
      const fieldResults = await runSearch(fieldSearch);
      let results = uniqueLrclibResults(Array.isArray(fieldResults) ? fieldResults : []);
      let matched = chooseLrclibResult(track, results);
      if (!matched?.syncedLyrics) {
        const broadResults = await runSearch(broadSearch);
        results = uniqueLrclibResults([
          ...results,
          ...(Array.isArray(broadResults) ? broadResults : []),
        ]);
        matched = chooseLrclibResult(track, results);
      }
      if (matched?.syncedLyrics || !candidate?.plainLyrics) candidate = matched;
    }
    return normalizeLrclibLyrics(candidate);
  }

  async #fetchJson(url, { signal } = {}) {
    let response;
    try {
      // Keep this a CORS-simple GET. The original single-file player uses the
      // same direct request shape; adding a custom client header would force a
      // preflight that LRCLIB intentionally does not allow from arbitrary web
      // origins.
      response = await Reflect.apply(this.fetchImpl, globalThis, [url, { signal }]);
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new LyricsProviderError("Could not reach LRCLIB.", {
        provider: "lrclib",
        cause,
      });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new LyricsProviderError(`LRCLIB returned HTTP ${response.status}.`, {
        provider: "lrclib",
        status: response.status,
      });
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new LyricsProviderError("LRCLIB returned invalid JSON.", {
        provider: "lrclib",
        cause,
      });
    }
  }
}

export function parseLrc(text) {
  const lines = String(text || "").split(/\r?\n/u).flatMap((line) => {
    const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/gu)];
    const content = cleanText(line.replace(/\[[^\]]+\]/gu, ""));
    return tags.map((tag) => {
      const fraction = Number((tag[3] || "0").padEnd(3, "0").slice(0, 3));
      const startMs = Number(tag[1]) * 60_000 + Number(tag[2]) * 1000 + fraction;
      return { type: content ? "line" : "interlude", startMs, endMs: startMs + 4000, text: content };
    });
  }).sort((a, b) => a.startMs - b.startMs);
  return withLineEnds(insertInterludes(lines));
}

export function normalizeLrclibLyrics(data) {
  if (!data) return null;
  if (data.instrumental) {
    return { source: "lrclib", detail: "instrumental", synced: false, instrumental: true, lines: [] };
  }
  if (data.syncedLyrics) {
    return {
      source: "lrclib",
      detail: "synced",
      synced: true,
      instrumental: false,
      lines: parseLrc(data.syncedLyrics),
    };
  }
  const lines = String(data.plainLyrics || "").split(/\r?\n/u)
    .map((text) => cleanText(text))
    .filter(Boolean)
    .map((text) => ({ type: "static", startMs: null, endMs: null, text }));
  return lines.length
    ? { source: "lrclib", detail: "plain", synced: false, instrumental: false, lines }
    : null;
}

function chooseLrclibResult(track, results) {
  const candidates = results.filter(Boolean);
  const matching = candidates.filter((item) => {
    const title = comparable(item.trackName || item.name);
    const wantedTitle = comparable(track.title);
    const artist = comparable(item.artistName || item.artist);
    const wantedArtist = comparable(track.artist);
    const titleMatch = title === wantedTitle || title.includes(wantedTitle) || wantedTitle.includes(title);
    const artistMatch = !artist || !wantedArtist || wantedArtist.split(" ").some((part) => part && artist.includes(part));
    const durationMatch = !Number.isFinite(Number(item.duration))
      || Math.abs(Number(item.duration) * 1000 - track.durationMs) <= 4000;
    return titleMatch && artistMatch && durationMatch;
  });
  return matching.find((item) => item.syncedLyrics)
    || candidates.find((item) => item.syncedLyrics)
    || matching[0]
    || candidates[0]
    || null;
}

function uniqueLrclibResults(results) {
  return [...new Map(results.filter(Boolean).map((item) => [
    item.id || `${item.trackName || item.name}:${item.artistName || item.artist}:${item.duration}`,
    item,
  ])).values()];
}

function insertInterludes(lines) {
  const result = [];
  const ordered = [...lines].filter((line) => Number.isFinite(line.startMs)).sort((a, b) => a.startMs - b.startMs);
  let cursor = 0;
  for (const line of ordered) {
    const gap = line.startMs - cursor;
    const intro = result.length === 0;
    if ((intro && gap > 900) || (!intro && gap > 4000)) {
      result.push({ type: "interlude", startMs: cursor, endMs: line.startMs - 50, text: "" });
    }
    result.push(line);
    cursor = Math.max(cursor, line.endMs || line.startMs);
  }
  return result;
}

function withLineEnds(lines) {
  return lines.map((line, index) => {
    const nextStart = lines[index + 1]?.startMs;
    const endMs = Number.isFinite(nextStart)
      ? Math.max(nextStart - 50, line.startMs + 250)
      : Math.max(line.endMs || 0, line.startMs + 800);
    return { ...line, endMs };
  });
}

function cleanText(input) {
  return String(input || "").replace(/\s+/gu, " ").trim();
}

function comparable(input) {
  return cleanText(input).normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase();
}

function noLyrics(detail = "not-found") {
  return { source: "none", detail, synced: false, instrumental: false, lines: [] };
}
