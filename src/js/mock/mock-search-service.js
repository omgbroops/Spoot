import { MOCK_TRACKS } from "./mock-fixtures.js";

export class MockSearchService {
  async search(query) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    const tracks = MOCK_TRACKS
      .filter((track) => track.type === "track")
      .filter((track) => !needle || `${track.title} ${track.artist}`.toLocaleLowerCase().includes(needle))
      .map((track, index) => {
        const isSingle = index === 0;
        return {
          id: track.id,
          type: "track",
          title: track.title,
          subtitle: track.artist,
          artworkUrl: track.artworkUrl,
          uri: track.uri,
          contextUri: isSingle ? "spotify:album:mocksingle" : "spotify:album:mockalbum",
          albumId: isSingle ? "mock-single" : "mock-album",
          albumType: isSingle ? "single" : "album",
          externalUrl: null,
          playable: true,
          browseable: true,
        };
      });
    const albums = !needle || "afterimage spool mock artists silver thread".includes(needle)
      ? [
          {
            id: "mock-album",
            type: "album",
            title: "Afterimage",
            subtitle: "Spool Mock Artists · 2 tracks",
            artworkUrl: MOCK_TRACKS[0]?.artworkUrl || null,
            contextUri: "spotify:album:mockalbum",
            externalUrl: null,
            playable: true,
            browseable: true,
          },
          {
            id: "mock-single",
            type: "album",
            title: "Silver Thread",
            subtitle: "Spool Mock Artists · 1 track",
            artworkUrl: MOCK_TRACKS[0]?.artworkUrl || null,
            contextUri: "spotify:album:mocksingle",
            externalUrl: null,
            playable: true,
            browseable: true,
          },
        ]
      : [];
    const artists = !needle || "spool mock artists".includes(needle)
      ? [{
          id: "mock-artist",
          type: "artist",
          title: "Spool Mock Artists",
          subtitle: "Artist",
          artworkUrl: MOCK_TRACKS[0]?.artworkUrl || null,
          contextUri: "spotify:artist:mockartist",
          externalUrl: null,
          playable: true,
          browseable: true,
        }]
      : [];
    return {
      tracks,
      artists,
      albums,
      playlists: [],
      total: tracks.length + artists.length + albums.length,
    };
  }
}
