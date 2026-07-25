import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("static shell preserves legacy detail modals and adds compact Search/command surfaces", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  assert.match(html, /id="modal-artist"/u);
  assert.match(html, /id="artist-content"/u);
  assert.match(html, /id="modal-track"/u);
  assert.match(html, /id="track-content"/u);
  assert.match(html, /id="album-title-label"/u);
  assert.match(html, /id="search-form"/u);
  assert.match(html, /id="search-results"/u);
  assert.match(html, /id="command-palette"/u);
  assert.match(html, /id="command-form"/u);
  assert.doesNotMatch(html, /class="command-palette glass"/u);
});

test("search routes every catalog result through one history-aware detail surface", () => {
  const ui = readFileSync(join(root, "src/js/ui/search.js"), "utf8");
  const app = readFileSync(join(root, "src/js/app.js"), "utf8");
  assert.match(ui, /data-search-open-album/u);
  assert.match(ui, /data-search-open-artist/u);
  assert.match(ui, /data-search-open-track/u);
  assert.match(ui, /data-search-open-playlist/u);
  assert.match(app, /navigateCatalog\("album"/u);
  assert.match(app, /navigateCatalog\("artist"/u);
  assert.match(app, /navigateCatalog\("track"/u);
  assert.match(app, /navigateCatalog\("playlist"/u);
  assert.match(app, /catalogHistory\.push\(snapshotCatalogEntry/u);
  assert.match(app, /catalogHistory\.pop\(\)/u);
  assert.match(app, /kind:\s*"library"/u);
});

test("Search submits explicitly instead of fetching while the user types", () => {
  const ui = readFileSync(join(root, "src/js/ui/search.js"), "utf8");
  const css = readFileSync(join(root, "src/styles/modals.css"), "utf8");
  assert.match(ui, /form\.addEventListener\("submit", submit\)/u);
  assert.doesNotMatch(ui, /input\.addEventListener\("input"/u);
  assert.match(css, /#modal-search\.search-modal\s*\{[\s\S]*?520px/u);
  assert.match(css, /\.search-form\.glass[\s\S]*?backdrop-filter:\s*blur/u);
  assert.match(css, /@keyframes search-content-in/u);
  assert.match(css, /\.command-palette[\s\S]*?backdrop-filter:\s*none/u);
});
