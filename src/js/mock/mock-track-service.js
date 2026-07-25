import { MOCK_TRACKS } from "./mock-fixtures.js";
import { directPlaybackBlockReason } from "../spotify/playability.js";

export class MockTrackService {
  async loadTrack(trackId) {
    const source = MOCK_TRACKS.find((track) => track.id === trackId) || MOCK_TRACKS[0];
    const unavailableReason = directPlaybackBlockReason(source);
    const isSingle = source.id === MOCK_TRACKS[0]?.id;
    return {
      track: {
        ...source,
        playable: unavailableReason === null,
        unavailableReason,
        explicit: false,
        trackNumber: 1,
        discNumber: 1,
        album: {
          id: isSingle ? "mock-single" : "mock-album",
          uri: isSingle ? "spotify:album:mocksingle" : "spotify:album:mockalbum",
          name: source.albumName || source.title,
          type: isSingle ? "single" : "album",
          artworkUrl: source.artworkUrl,
          releaseDate: "2026-06-20",
          releaseYear: "2026",
          totalTracks: 1,
          externalUrl: null,
        },
      },
    };
  }
}
