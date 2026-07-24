export function directPlaybackBlockReason(item) {
  if (!item || typeof item !== "object") return "This item is unavailable.";
  const type = item.type || item.contentType;
  if (type !== "track") return "Only songs can be started here.";
  if (item.isLocal) return "Local files can only play from a Spotify app that has the file.";
  if (item.isPlayable === false) return "This song is unavailable for this account or market.";
  if (item.restrictions && Object.keys(item.restrictions).length) {
    return "Spotify has restricted playback of this song.";
  }
  if (typeof item.uri !== "string" || !/^spotify:track:[^:\s]+$/u.test(item.uri)) {
    return "This song does not have a playable Spotify URI.";
  }
  return null;
}

export function canDirectlyPlay(item) {
  return directPlaybackBlockReason(item) === null;
}
