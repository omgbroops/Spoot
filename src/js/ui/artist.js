import { DEFAULT_COVER } from "./now-playing.js";

let cleanup;

export function setupArtist({ onPlay, onOpenAlbum, onBack } = {}) {
  cleanup?.();
  const content = document.getElementById("artist-content");
  const back = document.getElementById("artist-back");
  if (!content) return () => {};

  const click = (event) => {
    const play = event.target.closest("[data-artist-play]");
    if (play && !play.disabled) {
      onPlay?.({ contextOnly: true, contextUri: play.dataset.artistPlay });
      return;
    }
    const release = event.target.closest("[data-artist-open-album]");
    if (release && !release.disabled) {
      onOpenAlbum?.({ id: release.dataset.artistOpenAlbum });
    }
  };
  const goBack = () => onBack?.();
  content.addEventListener("click", click);
  back?.addEventListener("click", goBack);
  cleanup = () => {
    content.removeEventListener("click", click);
    back?.removeEventListener("click", goBack);
    cleanup = undefined;
  };
  return cleanup;
}

export function renderArtist({ status = "idle", result, message } = {}) {
  const content = document.getElementById("artist-content");
  if (!content) return;
  content.replaceChildren();
  content.setAttribute("aria-busy", String(status === "loading"));

  if (status === "loading") {
    content.append(artistMessage("Loading artist…"));
    return;
  }
  if (status === "error") {
    content.append(artistMessage(message || "This artist is temporarily unavailable."));
    return;
  }
  if (!result?.artist) {
    content.append(artistMessage("Choose an artist from Search."));
    return;
  }

  const { artist, albums = [], singles = [], compilations = [], releases = [] } = result;
  content.append(artistHeader(artist, releases.length));

  if (!releases.length) {
    content.append(artistMessage("Spotify did not return any releases for this artist."));
    return;
  }

  appendReleaseSection(content, "Albums", albums);
  appendReleaseSection(content, "Singles and EPs", singles);
  appendReleaseSection(content, "Compilations", compilations);
}

function artistHeader(artist, releaseCount) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const kind = document.createElement("span");
  const title = document.createElement("h2");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const play = document.createElement("button");

  header.className = "artist-detail-head";
  image.className = "artist-detail-image";
  image.src = artist.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "artist-detail-copy";
  kind.className = "artist-kind";
  kind.textContent = "Artist";
  title.textContent = artist.name;
  meta.className = "artist-meta";
  meta.textContent = artistMeta(artist, releaseCount);
  actions.className = "artist-actions";
  play.className = "btn primary";
  play.type = "button";
  play.dataset.artistPlay = artist.uri || "";
  play.disabled = !artist.uri;
  play.textContent = "Play artist";
  actions.append(play);

  if (artist.externalUrl) {
    const link = document.createElement("a");
    link.className = "btn artist-open-spotify";
    link.href = artist.externalUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Spotify";
    actions.append(link);
  }

  copy.append(kind, title, meta, actions);
  header.append(image, copy);
  return header;
}

function artistMeta(artist, releaseCount) {
  const parts = [];
  if (Number.isFinite(artist.followerCount)) {
    parts.push(`${new Intl.NumberFormat().format(artist.followerCount)} followers`);
  }
  if (artist.genres?.length) parts.push(artist.genres.slice(0, 2).join(", "));
  if (!parts.length) parts.push(`${releaseCount} release${releaseCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function appendReleaseSection(content, title, releases) {
  if (!releases.length) return;
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  const grid = document.createElement("div");
  section.className = "artist-release-section";
  heading.textContent = title;
  grid.className = "artist-release-grid";
  releases.forEach((release) => grid.append(releaseCard(release)));
  section.append(heading, grid);
  content.append(section);
}

function releaseCard(release) {
  const button = document.createElement("button");
  const image = document.createElement("img");
  const title = document.createElement("strong");
  const meta = document.createElement("span");

  button.type = "button";
  button.className = `artist-release-card${release.browseable ? "" : " unavailable"}`;
  button.disabled = !release.browseable;
  if (release.browseable) button.dataset.artistOpenAlbum = release.id;
  button.title = release.browseable ? `Open ${release.name}` : `${release.name} is unavailable`;
  image.src = release.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  title.textContent = release.name;
  meta.textContent = [
    release.releaseYear,
    release.type === "single" ? "Single" : release.type === "compilation" ? "Compilation" : "Album",
  ].filter(Boolean).join(" · ");
  button.append(image, title, meta);
  return button;
}

function artistMessage(text) {
  const message = document.createElement("div");
  message.className = "empty artist-message";
  message.textContent = text;
  return message;
}
