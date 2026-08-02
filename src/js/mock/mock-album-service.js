import { MOCK_TRACKS } from "./mock-fixtures.js";
import { directPlaybackBlockReason } from "../spotify/playability.js";

export class MockAlbumService {
  async loadAlbum(albumId) {
    const isSingle = albumId === "mock-single";
    const sourceTracks = MOCK_TRACKS.filter((track) => track.type === "track");
    const selectedTracks = isSingle ? sourceTracks.slice(0, 1) : sourceTracks;
    const tracks = selectedTracks.map((track, position) => {
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
        uri: isSingle ? "spotify:album:mocksingle" : "spotify:album:mockalbum",
        name: isSingle ? "Silver Thread" : "Afterimage",
        type: isSingle ? "single" : "album",
        artistNames: ["Spoot Mock Artists"],
        artist: "Spoot Mock Artists",
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
