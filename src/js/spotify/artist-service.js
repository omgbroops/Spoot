const PAGE_SIZE = 10;

function firstImage(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

function artistNames(artists) {
  return Array.isArray(artists)
    ? artists.map((artist) => artist?.name).filter(Boolean)
    : [];
}

function nextOffset(page, fallbackOffset) {
  if (!page?.next) return null;
  try {
    const parsed = Number(new URL(page.next).searchParams.get("offset"));
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  } catch {}
  const count = Array.isArray(page?.items) ? page.items.length : 0;
  return count ? fallbackOffset + count : null;
}

export function normalizeArtist(artist) {
  if (!artist || typeof artist !== "object") return null;
  return {
    id: typeof artist.id === "string" ? artist.id : null,
    uri: typeof artist.uri === "string" ? artist.uri : null,
    name: artist.name || "Unknown artist",
    artworkUrl: firstImage(artist.images),
    externalUrl: artist.external_urls?.spotify ?? null,
    followerCount: Number.isFinite(artist.followers?.total) ? artist.followers.total : null,
    popularity: Number.isFinite(artist.popularity) ? artist.popularity : null,
    genres: Array.isArray(artist.genres) ? artist.genres.filter(Boolean) : [],
  };
}

export function normalizeArtistRelease(album, position = 0) {
  if (!album || typeof album !== "object") return null;
  const names = artistNames(album.artists);
  return {
    id: typeof album.id === "string" ? album.id : null,
    uri: typeof album.uri === "string" ? album.uri : null,
    name: album.name || "Untitled release",
    type: album.album_type || "album",
    artworkUrl: firstImage(album.images),
    releaseDate: album.release_date || null,
    releaseYear: String(album.release_date || "").slice(0, 4) || null,
    totalTracks: Number.isFinite(album.total_tracks) ? album.total_tracks : null,
    artistNames: names,
    artist: names.join(", ") || "Unknown artist",
    externalUrl: album.external_urls?.spotify ?? null,
    position,
    browseable: typeof album.id === "string" && Boolean(album.id),
    playable: typeof album.uri === "string" && Boolean(album.uri),
  };
}

export class SpotifyArtistService {
  constructor({ apiClient } = {}) {
    if (!apiClient?.getArtist || !apiClient?.getArtistAlbums) {
      throw new TypeError("SpotifyArtistService requires Spotify artist API methods.");
    }
    this.apiClient = apiClient;
    this.cache = new Map();
  }

  async loadArtist(artistId, { market, signal, force = false } = {}) {
    if (!force && !signal && this.cache.has(artistId)) return this.cache.get(artistId);

    const [artistPayload, firstPage] = await Promise.all([
      this.apiClient.getArtist(artistId, { signal }),
      this.apiClient.getArtistAlbums(artistId, {
        includeGroups: ["album", "single"],
        limit: PAGE_SIZE,
        offset: 0,
        market,
        signal,
      }),
    ]);
    const artist = normalizeArtist(artistPayload);
    if (!artist?.id || !artist.uri) {
      throw new Error("Spotify returned an incomplete artist.");
    }

    const rawReleases = [...(firstPage?.items ?? [])];
    const total = Number.isFinite(firstPage?.total) ? firstPage.total : rawReleases.length;
    let offset = nextOffset(firstPage, 0);
    if (offset === null && rawReleases.length < total) offset = rawReleases.length;

    while (offset !== null && offset < total) {
      const page = await this.apiClient.getArtistAlbums(artist.id, {
        includeGroups: ["album", "single"],
        limit: PAGE_SIZE,
        offset,
        market,
        signal,
      });
      const pageItems = page?.items ?? [];
      rawReleases.push(...pageItems);
      const following = nextOffset(page, offset);
      offset = following === null && rawReleases.length < total && pageItems.length
        ? rawReleases.length
        : following;
      if (!pageItems.length) offset = null;
    }

    const seen = new Set();
    const releases = rawReleases
      .map((release, position) => normalizeArtistRelease(release, position))
      .filter((release) => {
        if (!release?.id || seen.has(release.id)) return false;
        seen.add(release.id);
        return true;
      });
    const result = {
      artist,
      releases,
      albums: releases.filter((release) => release.type === "album"),
      singles: releases.filter((release) => release.type === "single"),
      compilations: releases.filter((release) => release.type === "compilation"),
      total: releases.length,
    };
    if (!signal) this.cache.set(artist.id, result);
    return result;
  }
}
