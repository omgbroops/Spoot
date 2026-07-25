import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("static shell includes artist and song detail modals", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  assert.match(html, /id="modal-artist"/u);
  assert.match(html, /id="artist-content"/u);
  assert.match(html, /id="modal-track"/u);
  assert.match(html, /id="track-content"/u);
  assert.match(html, /id="album-title-label"/u);
});

test("search routes albums, artists, and tracks into detail views", () => {
  const ui = readFileSync(join(root, "src/js/ui/search.js"), "utf8");
  const app = readFileSync(join(root, "src/js/app.js"), "utf8");
  assert.match(ui, /data-search-open-album/u);
  assert.match(ui, /data-search-open-artist/u);
  assert.match(ui, /data-search-open-track/u);
  assert.match(app, /onOpenArtist:\s*openArtistPage/u);
  assert.match(app, /onOpenTrack:\s*openTrackPage/u);
});
