let cache;

const byId = (root, id) => root.getElementById(id);

export function getElements(root = document) {
  if (cache && root === document) return cache;

  const elements = {
    body: root.body,
    background: byId(root, 'bg-wrap'),
    backgroundArt: byId(root, 'bg-art'),
    nowPlayingWidget: byId(root, 'w-nowplaying'),
    player: byId(root, 'player'),
    artwork: byId(root, 'art'),
    title: byId(root, 'np-title'),
    artist: byId(root, 'np-artist'),
    play: byId(root, 'btn-play'),
    previous: byId(root, 'btn-prev'),
    next: byId(root, 'btn-next'),
    shuffle: byId(root, 'btn-shuffle'),
    repeat: byId(root, 'btn-loop'),
    immersiveButton: byId(root, 'btn-immersive'),
    seek: byId(root, 'seek'),
    seekFill: byId(root, 'seek-fill'),
    seekBuffer: byId(root, 'seek-buf'),
    seekKnob: byId(root, 'seek-knob'),
    currentTime: byId(root, 't-cur'),
    duration: byId(root, 't-dur'),
    queueWidget: byId(root, 'w-queue'),
    queueList: byId(root, 'queue-list'),
    queueClear: byId(root, 'queue-clear'),
    lyricsWidget: byId(root, 'w-lyrics'),
    lyricsList: byId(root, 'lyrics-list'),
    dock: root.querySelector('.dock'),
    dockQueue: byId(root, 'dock-queue'),
    scrim: byId(root, 'scrim'),
    modals: [...root.querySelectorAll('.modal')],
    immersive: byId(root, 'immersive'),
    immersiveBackground: byId(root, 'im-bg'),
    immersiveArtwork: byId(root, 'im-art'),
    immersiveTitle: byId(root, 'im-title'),
    immersiveArtist: byId(root, 'im-artist'),
    immersivePlay: byId(root, 'im-play'),
    immersivePrevious: byId(root, 'im-prev'),
    immersiveNext: byId(root, 'im-next'),
    immersiveShuffle: byId(root, 'im-shuffle'),
    immersiveRepeat: byId(root, 'im-loop'),
    immersiveCollapse: byId(root, 'im-collapse'),
    immersiveLyricsButton: byId(root, 'im-lyrics-btn'),
    immersiveLyrics: byId(root, 'im-lyrics'),
    immersiveSeek: byId(root, 'im-seek'),
    immersiveSeekFill: byId(root, 'im-fill'),
    immersiveSeekKnob: byId(root, 'im-knob'),
    immersiveCurrentTime: byId(root, 'im-cur'),
    immersiveDuration: byId(root, 'im-dur'),
    connection: byId(root, 'connection-status'),
    connectionTitle: byId(root, 'connection-title'),
    connectionMessage: byId(root, 'connection-message'),
    connectionPrimary: byId(root, 'connection-primary'),
    connectionSecondary: byId(root, 'connection-secondary'),
    settingsAccountStatus: byId(root, 'spotify-account-status'),
    settingsDeviceStatus: byId(root, 'spotify-device-status'),
    settingsConnect: byId(root, 'settings-connect'),
    settingsTransfer: byId(root, 'settings-transfer'),
    settingsDisconnect: byId(root, 'settings-disconnect'),
    blank: byId(root, 'blank'),
    toast: byId(root, 'toast'),
  };

  if (root === document) cache = elements;
  return elements;
}

export function resetElementCache() {
  cache = undefined;
}
