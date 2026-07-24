import { MOCK_TRACKS } from './mock-fixtures.js';
import { directPlaybackBlockReason } from '../spotify/playability.js';

const SOURCES = [
  {
    id: 'liked-songs',
    kind: 'liked',
    name: 'Liked Songs',
    description: 'Songs saved to your Spotify library',
    ownerName: 'Mock listener',
    artworkUrl: null,
    total: MOCK_TRACKS.length,
    canBrowse: true,
  },
  {
    id: 'mock-playlist',
    kind: 'playlist',
    name: 'Night drive',
    ownerName: 'Mock listener',
    artworkUrl: './src/assets/mock-cover-orbit.svg',
    total: MOCK_TRACKS.length,
    canBrowse: true,
    owned: true,
  },
  {
    id: 'mock-editorial',
    kind: 'playlist',
    name: 'Spotify generated mix',
    ownerName: 'Spotify',
    artworkUrl: './src/assets/mock-cover-night.svg',
    total: 24,
    canBrowse: false,
    unavailableReason: "Spotify only exposes this playlist's metadata to development-mode apps.",
  },
];

export class MockLibraryService {
  async loadSources() {
    return SOURCES.map((source) => ({ ...source }));
  }

  async loadSourcePage(source) {
    const items = MOCK_TRACKS.map((item, index) => {
      const unavailableReason = directPlaybackBlockReason(item);
      return {
        key: item.id || `mock-${index}`,
        item,
        ...item,
        playable: unavailableReason === null,
        unavailableReason,
      };
    });
    return {
      source,
      items,
      total: items.length,
      nextOffset: null,
      unavailableReason: null,
    };
  }
}
