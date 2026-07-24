import { MOCK_TRACKS } from "./mock-fixtures.js";
import { directPlaybackBlockReason } from "../spotify/playability.js";

export class MockAlbumService {
  async loadAlbum(albumId) {
    const tracks = MOCK_TRACKS.filter((track) => track.type === "track").map((track, position) => {
      const unavailableReason = directPlaybackBlockReason(track);
      return {
        ...track,
        position,
        discNumber: 1,
        trackNumber: position + 1,
        playable: unavailableReason === null,
        unavailableReason,
      };
    });
    return {
      album: {
        id: albumId || "mock-album",
        uri: "spotify:album:mockalbum",
        name: "Afterimage",
        type: "album",
        artistNames: ["Spool Mock Artists"],
        artist: "Spool Mock Artists",
        artworkUrl: tracks[0]?.artworkUrl || null,
        releaseDate: "2026",
        releaseYear: "2026",
        totalTracks: tracks.length,
        externalUrl: null,
      },
      tracks,
      total: tracks.length,
      durationMs: tracks.reduce((sum, track) => sum + track.durationMs, 0),
    };
  }
}
