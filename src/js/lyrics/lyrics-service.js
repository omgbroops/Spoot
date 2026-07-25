import { LyricsStore, lyricsRecordKey } from "./lyrics-store.js";

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

function remember(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function normalizedTrack(track) {
  return {
    ...track,
    id: track?.id || track?.itemId || null,
    uri: track?.uri || track?.itemUri || null,
    title: track?.title || track?.name || "",
    artist: track?.artist || track?.artistNames?.join(", ") || "",
    album: track?.albumName || track?.album?.name || "",
    durationMs: Math.max(0, Number(track?.durationMs || track?.duration_ms) || 0),
    isLocal: Boolean(track?.isLocal || String(track?.uri || "").startsWith("spool:local:")),
    embeddedLyrics: String(track?.lyrics || ""),
  };
}

export class LyricsService {
  constructor({
    fetchImpl = globalThis.fetch,
    onDiagnostic,
    baseUrl = DEFAULT_LRCLIB_BASE,
    store = new LyricsStore(),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("LyricsService requires fetch.");
    this.fetchImpl = fetchImpl;
    this.onDiagnostic = onDiagnostic;
    this.baseUrl = String(baseUrl || DEFAULT_LRCLIB_BASE).replace(/\/$/u, "");
    this.store = store;
    this.cache = new Map();
  }

  async getLyrics(input, { signal, force = false } = {}) {
    const track = normalizedTrack(input);
    if (!track.title) return noLyrics("missing-track");
    const key = lyricsRecordKey(track);
    if (!key) return noLyrics("missing-track");

    if (!force && this.cache.has(key)) return this.cache.get(key);
    if (!force) {
      const stored = await this.store.get(key);
      // A saved user edit is absolute. Never replace it automatically.
      if (stored?.userModified || stored?.source === "manual") {
        const lyrics = lyricsFromRecord(stored);
        remember(this.cache, key, lyrics);
        return lyrics;
      }

      // Embedded local metadata outranks provider data, including a cached
      // LRCLIB result or an earlier automatic negative lookup.
      if (track.isLocal && track.embeddedLyrics.trim()) {
        const record = stored?.source === "embedded" && stored.text === track.embeddedLyrics
          ? stored
          : await this.store.put({
              key,
              text: track.embeddedLyrics,
              source: "embedded",
              userModified: false,
              autoFetchAttempted: false,
              updatedAt: Date.now(),
            });
        const lyrics = lyricsFromRecord(record);
        remember(this.cache, key, lyrics);
        return lyrics;
      }

      if (stored?.text || stored?.instrumental) {
        const lyrics = lyricsFromRecord(stored);
        remember(this.cache, key, lyrics);
        return lyrics;
      }
      if (stored?.autoFetchAttempted) return noLyrics("not-found");
    }

    try {
      const result = await this.#fetchBestLrclib(track, signal);
      if (result) {
        const text = result.syncedLyrics || result.plainLyrics || "";
        const record = await this.store.put({
          key,
          text,
          source: "lrclib",
          userModified: false,
          autoFetchAttempted: true,
          lrclibResultId: result.id ?? null,
          instrumental: Boolean(result.instrumental),
          updatedAt: Date.now(),
        });
        const lyrics = lyricsFromRecord(record);
        remember(this.cache, key, lyrics);
        return lyrics;
      }
      await this.store.put({
        key,
        text: "",
        source: "none",
        userModified: false,
        autoFetchAttempted: true,
        instrumental: false,
        updatedAt: Date.now(),
      });
      return noLyrics("not-found");
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      this.#diagnostic("lrclib", error);
      // Outages are not persisted as negative matches.
      return noLyrics("provider-error");
    }
  }

  async search(input, { signal } = {}) {
    const track = normalizedTrack(input);
    if (!track.title) return [];
    const results = await this.#searchLrclib(track, signal);
    const best = chooseLrclibResult(track, results);
    return results.map((result) => ({
      id: result.id ?? null,
      title: result.trackName || result.name || track.title,
      artist: result.artistName || result.artist || track.artist,
      album: result.albumName || "",
      durationMs: Number.isFinite(Number(result.duration)) ? Number(result.duration) * 1000 : 0,
      synced: Boolean(result.syncedLyrics),
      instrumental: Boolean(result.instrumental),
      text: result.syncedLyrics || result.plainLyrics || "",
      best: result === best,
      raw: result,
    }));
  }

  async save(input, text, { source = "manual", userModified = true, lrclibResultId = null } = {}) {
    const track = normalizedTrack(input);
    const key = lyricsRecordKey(track);
    if (!key) throw new TypeError("A playable song is required to save lyrics.");
    const record = await this.store.put({
      key,
      text: String(text || ""),
      source,
      userModified,
      autoFetchAttempted: true,
      lrclibResultId,
      instrumental: false,
      updatedAt: Date.now(),
    });
    this.cache.delete(key);
    const lyrics = lyricsFromRecord(record);
    remember(this.cache, key, lyrics);
    return lyrics;
  }

  async clear(input) {
    const key = lyricsRecordKey(normalizedTrack(input));
    if (!key) return;
    this.cache.delete(key);
    await this.store.delete(key);
  }

  async getRecord(input) {
    const key = lyricsRecordKey(normalizedTrack(input));
    return key ? this.store.get(key) : null;
  }

  #diagnostic(provider, error) {
    this.onDiagnostic?.({
      provider,
      name: error?.name || "Error",
      status: error?.status ?? null,
      message: error?.message || "Lyrics request failed.",
    });
  }

  async #fetchBestLrclib(track, signal) {
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
    if (candidate?.syncedLyrics || candidate?.plainLyrics || candidate?.instrumental) return candidate;
    const results = await this.#searchLrclib(track, signal);
    return chooseLrclibResult(track, results);
  }

  async #searchLrclib(track, signal) {
    const fieldSearch = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
    });
    if (track.album) fieldSearch.set("album_name", track.album);
    const broadSearch = new URLSearchParams({ q: `${track.title} ${track.artist}`.trim() });
    const runSearch = (params) => this.#fetchJson(`${this.baseUrl}/search?${params}`, { signal })
      .catch((error) => {
        if (error?.name === "AbortError") throw error;
        this.#diagnostic("lrclib-search", error);
        return [];
      });
    const fieldResults = await runSearch(fieldSearch);
    const broadResults = await runSearch(broadSearch);
    return uniqueLrclibResults([
      ...(Array.isArray(fieldResults) ? fieldResults : []),
      ...(Array.isArray(broadResults) ? broadResults : []),
    ]).filter((item) => item.syncedLyrics || item.plainLyrics || item.instrumental);
  }

  async #fetchJson(url, { signal } = {}) {
    let response;
    try {
      response = await Reflect.apply(this.fetchImpl, globalThis, [url, { signal }]);
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new LyricsProviderError("Could not reach LRCLIB.", { provider: "lrclib", cause });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new LyricsProviderError(`LRCLIB returned HTTP ${response.status}.`, {
        provider: "lrclib",
        status: response.status,
      });
    }
    if (!text) return null;
    try { return JSON.parse(text); }
    catch (cause) { throw new LyricsProviderError("LRCLIB returned invalid JSON.", { provider: "lrclib", cause }); }
  }
}

export function lyricsFromText(text, { source = "manual", detail = null, instrumental = false } = {}) {
  const raw = String(text || "");
  if (instrumental) return { source, detail: detail || "instrumental", rawText: raw, synced: false, instrumental: true, lines: [] };
  const parsed = parseLrc(raw);
  if (parsed.length) {
    return { source, detail: detail || "synced", rawText: raw, synced: true, instrumental: false, lines: parsed };
  }
  const lines = raw.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "static", startMs: null, endMs: null, text: line }));
  return lines.length
    ? { source, detail: detail || "plain", rawText: raw, synced: false, instrumental: false, lines }
    : noLyrics("empty");
}

export function lyricsToText(lyrics) {
  if (typeof lyrics?.rawText === "string") return lyrics.rawText;
  if (!lyrics?.lines?.length) return "";
  if (!lyrics.synced) return lyrics.lines.map((line) => line.text || "").join("\n");
  return lyrics.lines
    .filter((line) => line.type !== "interlude" || line.text)
    .map((line) => `[${formatLrcTime(line.startMs)}] ${line.text || ""}`.trimEnd())
    .join("\n");
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
  return lyricsFromText(data.syncedLyrics || data.plainLyrics || "", {
    source: "lrclib",
    detail: data.syncedLyrics ? "synced" : data.instrumental ? "instrumental" : "plain",
    instrumental: Boolean(data.instrumental),
  });
}

function lyricsFromRecord(record) {
  return lyricsFromText(record.text, {
    source: record.source || "manual",
    detail: record.userModified ? "edited" : record.source,
    instrumental: record.instrumental,
  });
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
    || matching[0]
    || candidates.find((item) => item.syncedLyrics)
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

function formatLrcTime(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function cleanText(input) {
  return String(input || "").replace(/\s+/gu, " ").trim();
}

function comparable(input) {
  return cleanText(input).normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase();
}

function noLyrics(detail = "not-found") {
  return { source: "none", detail, rawText: "", synced: false, instrumental: false, lines: [] };
}
