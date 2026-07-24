import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test("the immutable original player reference still matches its recorded hash", () => {
  const reference = readFileSync(join(root, "reference/original-local-player.html"));
  const recorded = readFileSync(
    join(root, "reference/original-local-player.sha256"),
    "utf8",
  ).split(/\s+/)[0];
  const actual = createHash("sha256").update(reference).digest("hex");
  assert.equal(actual, recorded);
});

test("Spotify runtime cannot initialize the dormant local library engine", () => {
  const runtime = walk(join(root, "src/js"))
    .filter((path) => extname(path) === ".js")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(runtime, /\bnew\s+(?:window\.)?Audio\s*\(/);
  assert.doesNotMatch(runtime, /indexedDB\.open\s*\(\s*["']musicplayer["']/);
  assert.doesNotMatch(runtime, /\bclient_secret\b/i);
  assert.doesNotMatch(runtime, /\bDROPBOX_APP_KEY\b/);
  assert.doesNotMatch(runtime, /companion-spicetify-bridge|sp:\/\/oauth|127\.0\.0\.1:49623/iu);
});

test("OAuth callback recovery uses persistent short-lived transaction storage", () => {
  const app = readFileSync(join(root, "src/js/app.js"), "utf8");
  assert.match(app, /transactionStorage:\s*createOAuthTransactionStorage/u);
  assert.doesNotMatch(app, /transactionStorage:\s*sessionStorage/u);
  assert.match(app, /window\.open\(/u);
  assert.match(app, /navigate:\s*\(url\)\s*=>\s*oauthPopup\.location\.replace\(url\)/u);
  assert.match(app, /OAUTH_CALLBACK_MESSAGE/u);
  assert.match(app, /new BroadcastChannel\(OAUTH_CHANNEL_NAME\)/u);
  assert.match(app, /auth\.readTransaction\(callbackState\)/u);
  assert.match(app, /handleCallback\(\{ url: callbackUrl\.href, cleanup: false \}\)/u);
  assert.match(app, /pendingOAuthCallback/u);
  assert.match(app, /retryPendingOAuthCallback/u);
  assert.match(app, /window\.addEventListener\("pageshow"/u);
});

test("the static application has no React dependency or hidden first-run body", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.dependencies?.react, undefined);
  assert.equal(manifest.devDependencies?.react, undefined);

  const html = readFileSync(join(root, "index.html"), "utf8");
  assert.doesNotMatch(html, /<body[^>]*class=["'][^"']*hidden-mode/i);
  assert.doesNotMatch(html, /reference\/original-local-player\.html/i);

  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^src\/js\/config\.local\.js$/m);
});

test("all static relative JavaScript imports resolve", () => {
  const jsFiles = walk(join(root, "src/js")).filter((path) => extname(path) === ".js");
  const importPattern = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+)["'](\.[^"']+)["']/g;

  for (const file of jsFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const target = resolve(dirname(file), match[1].split(/[?#]/u, 1)[0]);
      assert.equal(existsSync(target), true, `${file} imports missing ${target}`);
    }
  }
});
