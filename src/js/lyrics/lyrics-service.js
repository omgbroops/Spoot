const SPICY_HOSTS = Object.freeze([
  "https://api.spicylyrics.org",
  "https://coregateway.spicylyrics.org",
]);
const SPICY_VERSION = "5.22.3";
const SPOTIFY_LYRICS_BASE = "https://spclient.wg.spotify.com/color-lyrics/v2/track";
const LRCLIB_BASE = "https://lrclib.net/api";
const LRCLIB_CLIENT = "Spool v0.1.0 (personal non-commercial Spotify player)";
const CACHE_LIMIT = 40;

export class LyricsProviderError extends Error {
  constructor(message, { provider, status = null, cause } = {}) {
    super(message, { cause });
    this.name = "LyricsProviderError";
    this.provider = provider;
    this.status = status;
  }
}

async function tokenFromProvider(tokenProvider) {
  if (!tokenProvider) return "";
  if (typeof tokenProvider === "function") return tokenProvider({ forceRefresh: false });
  if (typeof tokenProvider.getAccessToken === "function") {
    return tokenProvider.getAccessToken({ forceRefresh: false });
  }
  return "";
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
    artworkUrl: track?.artworkUrl || track?.album?.images?.[0]?.url || "",
  };
}

export class LyricsService {
  constructor({ tokenProvider, fetchImpl = globalThis.fetch, onDiagnostic } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("LyricsService requires fetch.");
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.onDiagnostic = onDiagnostic;
    this.cache = new Map();
  }

  async getLyrics(input, { signal } = {}) {
    const track = normalizedTrack(input);
    if (!track.title) return noLyrics("missing-track");
    const key = lyricsKey(track);
    if (this.cache.has(key)) return this.cache.get(key);

    let token = "";
    try {
      token = await tokenFromProvider(this.tokenProvider);
    } catch (error) {
      this.#diagnostic("spotify-token", error);
    }

    let spicyStatic = null;
    if (token && track.id) {
      try {
        const spicy = await this.#fetchSpicy(track.id, token, signal);
        if (spicy?.synced && spicy.lines.length) return this.#cache(key, spicy);
        if (spicy?.lines.length) spicyStatic = spicy;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        this.#diagnostic("spicylyrics", error);
      }

      try {
        const spotify = await this.#fetchSpotify(track, token, signal);
        if (spotify?.lines.length) return this.#cache(key, spotify);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        this.#diagnostic("spotify-color-lyrics", error);
      }
    }

    let lrclib = null;
    try {
      lrclib = await this.#fetchLrclib(track, signal);
      if (lrclib?.synced && lrclib.lines.length) return this.#cache(key, lrclib);
      if (lrclib?.instrumental) return this.#cache(key, lrclib);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      this.#diagnostic("lrclib", error);
    }

    if (spicyStatic?.lines.length) return this.#cache(key, spicyStatic);
    if (lrclib?.lines.length) return this.#cache(key, lrclib);
    // A provider outage or browser CORS block is not proof that the track has
    // no lyrics. Leave negative results uncached so revisiting the song retries.
    return noLyrics();
  }

  #cache(key, lyrics) {
    remember(this.cache, key, lyrics);
    return lyrics;
  }

  #diagnostic(provider, error) {
    this.onDiagnostic?.({
      provider,
      name: error?.name || "Error",
      status: error?.status ?? null,
      message: error?.message || "Lyrics request failed.",
    });
  }

  async #fetchSpicy(trackId, token, signal) {
    const body = {
      queries: [{
        operation: "lyrics",
        variables: { id: trackId, auth: "SpicyLyrics-WebAuth" },
      }],
      client: { version: SPICY_VERSION },
    };
    let lastError;
    for (const host of SPICY_HOSTS) {
      try {
        const data = await this.#fetchJson(`${host}/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "SpicyLyrics-Version": SPICY_VERSION,
            "SpicyLyrics-WebAuth": `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal,
        }, "spicylyrics");
        const result = (data?.queries ?? []).find((query) => query?.result)?.result;
        if (result?.httpStatus !== 200 || !result.data) return null;
        return normalizeSpicyLyrics(result.data);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastError = error;
      }
    }
    throw lastError || new LyricsProviderError("SpicyLyrics did not respond.", { provider: "spicylyrics" });
  }

  async #fetchSpotify(track, token, signal) {
    const artwork = encodeURIComponent(track.artworkUrl || "");
    const url = `${SPOTIFY_LYRICS_BASE}/${encodeURIComponent(track.id)}/image/${artwork}?format=json&vocalRemoval=false&market=from_token`;
    const data = await this.#fetchJson(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "App-Platform": "WebPlayer",
      },
      signal,
    }, "spotify");
    return normalizeSpotifyLyrics(data);
  }

  async #fetchLrclib(track, signal) {
    const exact = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
      album_name: track.album,
      duration: String(Math.round(track.durationMs / 1000)),
    });
    let candidate = null;
    try {
      candidate = await this.#fetchJson(`${LRCLIB_BASE}/get?${exact}`, {
        headers: { "Lrclib-Client": LRCLIB_CLIENT },
        signal,
      }, "lrclib");
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status !== 404) this.#diagnostic("lrclib-exact", error);
    }

    if (!candidate?.syncedLyrics) {
      const fieldSearch = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album,
      });
      const broadSearch = new URLSearchParams({
        q: `${track.title} ${track.artist}`.trim(),
      });
      const runSearch = (params) => this.#fetchJson(`${LRCLIB_BASE}/search?${params}`, {
        headers: { "Lrclib-Client": LRCLIB_CLIENT },
        signal,
      }, "lrclib").catch((error) => {
        if (error?.name === "AbortError") throw error;
        return [];
      });
      const [broadResults, fieldResults] = await Promise.all([
        runSearch(broadSearch),
        runSearch(fieldSearch),
      ]);
      const results = uniqueLrclibResults([
        ...(Array.isArray(broadResults) ? broadResults : []),
        ...(Array.isArray(fieldResults) ? fieldResults : []),
      ]);
      const matched = chooseLrclibResult(track, results);
      if (matched?.syncedLyrics || !candidate?.plainLyrics) candidate = matched;
    }
    return normalizeLrclibLyrics(candidate);
  }

  async #fetchJson(url, init, provider) {
    let response;
    try {
      response = await Reflect.apply(this.fetchImpl, globalThis, [url, {
        mode: "cors",
        credentials: "omit",
        ...init,
      }]);
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new LyricsProviderError(`Could not reach ${provider}.`, { provider, cause });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new LyricsProviderError(`${provider} returned HTTP ${response.status}.`, {
        provider,
        status: response.status,
      });
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new LyricsProviderError(`${provider} returned invalid JSON.`, { provider, cause });
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

export function normalizeSpotifyLyrics(data) {
  const rawLines = data?.lyrics?.lines ?? data?.lines ?? [];
  const lines = rawLines.map((line, index) => {
    const startMs = spotifyTimestampMs(line, ["startTimeMs", "startTime", "time"]);
    const nextStart = spotifyTimestampMs(rawLines[index + 1], ["startTimeMs", "startTime", "time"]);
    const endMs = spotifyTimestampMs(line, ["endTimeMs", "endTime"]) || nextStart || startMs + 4500;
    const text = cleanText(line?.words || line?.text || line?.Text);
    return {
      type: text ? "line" : "interlude",
      startMs,
      endMs: Math.max(endMs, startMs + 250),
      text,
    };
  }).filter((line) => Number.isFinite(line.startMs));
  if (!lines.length) return null;
  return {
    source: "spotify",
    detail: "color-lyrics",
    synced: true,
    instrumental: false,
    lines: withLineEnds(insertInterludes(lines), true),
  };
}

export function normalizeSpicyLyrics(input) {
  const data = unwrapSpicy(input);
  if (!data || typeof data !== "object") return null;
  const content = arrayValue(data, "Content", "content");
  const staticLines = arrayValue(data, "Lines", "lines");
  const declared = value(data, "Type", "type");
  const inferred = content.some((entry) => arrayValue(value(entry, "Lead", "lead"), "Syllables", "syllables").length)
    ? "Syllable"
    : content.some((entry) => value(entry, "Text", "text"))
      ? "Line"
      : staticLines.length ? "Static" : "";
  const ranks = { Static: 1, Line: 2, Syllable: 3 };
  const type = (ranks[inferred] || 0) > (ranks[declared] || 0) ? inferred : declared || inferred;
  let lines = [];

  if (type === "Syllable") {
    for (const entry of content) {
      const lead = value(entry, "Lead", "lead") || {};
      const syllables = arrayValue(lead, "Syllables", "syllables");
      const text = syllables.map((syllable, index) => {
        const fragment = String(value(syllable, "Text", "text", "RomanizedText", "romanizedText") || "");
        const partOfWord = Boolean(value(syllable, "IsPartOfWord", "isPartOfWord"));
        return fragment && index < syllables.length - 1 && !partOfWord ? `${fragment} ` : fragment;
      }).join("").trim();
      const startMs = spicyTimeMs(value(lead, "StartTime", "startTime", "start") ?? value(syllables[0], "StartTime", "startTime", "start"));
      const endMs = spicyTimeMs(value(lead, "EndTime", "endTime", "end") ?? value(syllables.at(-1), "EndTime", "endTime", "end")) || startMs + 1000;
      if (text) lines.push({ type: "syllable", startMs, endMs, text, background: false });

      for (const background of arrayValue(entry, "Background", "background")) {
        const parts = arrayValue(background, "Syllables", "syllables");
        const backgroundText = parts.map((part) => value(part, "Text", "text") || "").join(" ").replace(/\s+/gu, " ").trim();
        const backgroundStart = spicyTimeMs(value(background, "StartTime", "startTime", "start") ?? value(parts[0], "StartTime", "startTime", "start"));
        const backgroundEnd = spicyTimeMs(value(background, "EndTime", "endTime", "end") ?? value(parts.at(-1), "EndTime", "endTime", "end")) || backgroundStart + 1000;
        if (backgroundText) lines.push({ type: "syllable", startMs: backgroundStart, endMs: backgroundEnd, text: backgroundText, background: true });
      }
    }
  } else if (type === "Line") {
    lines = content.map((line, index) => {
      const startMs = spicyTimeMs(value(line, "StartTime", "startTime", "start"));
      const nextStart = spicyTimeMs(value(content[index + 1], "StartTime", "startTime", "start"));
      const endMs = spicyTimeMs(value(line, "EndTime", "endTime", "end")) || nextStart || startMs + 4000;
      return {
        type: "line",
        startMs,
        endMs,
        text: cleanText(value(line, "Text", "text", "RomanizedText", "romanizedText")),
      };
    }).filter((line) => line.text);
  } else if (type === "Static") {
    lines = staticLines.map((line) => ({
      type: "static",
      startMs: null,
      endMs: null,
      text: cleanText(value(line, "Text", "text", "RomanizedText", "romanizedText")),
    })).filter((line) => line.text);
  }
  if (!lines.length) return null;
  const synced = type === "Syllable" || type === "Line";
  return {
    source: "spicylyrics",
    detail: type.toLocaleLowerCase(),
    synced,
    instrumental: false,
    lines: synced ? withLineEnds(insertInterludes(lines), true) : lines,
  };
}

function chooseLrclibResult(track, results) {
  const candidates = results.filter(Boolean);
  const matching = candidates.filter((item) => {
    const title = comparable(item.trackName || item.name);
    const artist = comparable(item.artistName || item.artist);
    const titleMatch = title === comparable(track.title) || title.includes(comparable(track.title)) || comparable(track.title).includes(title);
    const artistMatch = !artist || !track.artist || comparable(track.artist).split(" ").some((part) => part && artist.includes(part));
    const durationMatch = !Number.isFinite(Number(item.duration)) || Math.abs(Number(item.duration) * 1000 - track.durationMs) <= 4000;
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

function withLineEnds(lines, preserveKnownEnds = false) {
  return lines.map((line, index) => {
    const nextStart = lines[index + 1]?.startMs;
    const computedEnd = Number.isFinite(nextStart)
      ? Math.max(nextStart - 50, line.startMs + 250)
      : Math.max(line.endMs || 0, line.startMs + 800);
    return {
      ...line,
      endMs: preserveKnownEnds && Number.isFinite(line.endMs) && line.endMs > line.startMs
        ? line.endMs
        : computedEnd,
    };
  });
}

function unwrapSpicy(data) {
  if (typeof data === "string") {
    try { return unwrapSpicy(JSON.parse(data)); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  for (const key of ["lyrics", "Lyrics", "data", "result"]) {
    if (data[key] && data[key] !== data) {
      const nested = unwrapSpicy(data[key]);
      if (nested) return nested;
    }
  }
  return data;
}

function value(item, ...keys) {
  for (const key of keys) if (item?.[key] != null) return item[key];
  return undefined;
}

function arrayValue(item, ...keys) {
  const found = value(item, ...keys);
  return Array.isArray(found) ? found : [];
}

function spicyTimeMs(input) {
  const number = Number(input);
  return Number.isFinite(number) ? Math.max(0, number * 1000) : 0;
}

function spotifyTimestampMs(item, keys) {
  for (const key of keys) {
    if (item?.[key] == null) continue;
    const number = Number(item[key]);
    if (!Number.isFinite(number)) return 0;
    if (key.toLocaleLowerCase().endsWith("ms")) return Math.max(0, number);
    return Math.max(0, number > 1000 ? number : number * 1000);
  }
  return 0;
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
