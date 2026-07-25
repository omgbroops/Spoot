import { MOCK_TRACKS } from "./mock-fixtures.js";

export class MockArtistService {
  async loadArtist(artistId) {
    const artworkUrl = MOCK_TRACKS[0]?.artworkUrl || null;
    const releases = [
      {
        id: "mock-album",
        uri: "spotify:album:mockalbum",
        name: "Afterimage",
        type: "album",
        artworkUrl,
        releaseDate: "2026-07-24",
        releaseYear: "2026",
        totalTracks: 2,
        artistNames: ["Spool Mock Artists"],
        artist: "Spool Mock Artists",
        externalUrl: null,
        position: 0,
        browseable: true,
        playable: true,
      },
      {
        id: "mock-single",
        uri: "spotify:album:mocksingle",
        name: "Silver Thread",
        type: "single",
        artworkUrl,
        releaseDate: "2026-06-20",
        releaseYear: "2026",
        totalTracks: 1,
        artistNames: ["Spool Mock Artists"],
        artist: "Spool Mock Artists",
        externalUrl: null,
        position: 1,
        browseable: true,
        playable: true,
      },
    ];
    return {
      artist: {
        id: artistId || "mock-artist",
        uri: "spotify:artist:mockartist",
        name: "Spool Mock Artists",
        artworkUrl,
        externalUrl: null,
        followerCount: 12_345,
        popularity: 64,
        genres: ["mock pop"],
      },
      releases,
      albums: releases.filter((release) => release.type === "album"),
      singles: releases.filter((release) => release.type === "single"),
      compilations: [],
      total: releases.length,
    };
  }
}
