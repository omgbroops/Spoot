import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUIRED_SPOTIFY_SCOPES,
  deriveRedirectUri,
  isMockMode,
  validateDevelopmentOrigin,
} from "../src/js/config.js";

test("configuration uses the exact loopback redirect and requested scopes", () => {
  const location = {
    href: "http://127.0.0.1:5173/?mock=1",
    origin: "http://127.0.0.1:5173",
    pathname: "/",
  };
  assert.equal(isMockMode(location), true);
  assert.equal(deriveRedirectUri(location), "http://127.0.0.1:5173/");
  assert.deepEqual(validateDevelopmentOrigin(deriveRedirectUri(location), location), []);
  assert.deepEqual(REQUIRED_SPOTIFY_SCOPES, [
    "streaming",
    "user-read-private",
    "user-read-email",
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-library-read",
    "user-library-modify",
    "ugc-image-upload",
  ]);
});

test("configuration rejects localhost and mismatched HTTP origins", () => {
  const location = {
    origin: "http://127.0.0.1:5173",
    pathname: "/",
  };
  const localhost = validateDevelopmentOrigin("http://localhost:5173/", location);
  assert.ok(localhost.some((message) => message.includes("localhost")));
  assert.ok(localhost.some((message) => message.includes("origin")));

  const lan = validateDevelopmentOrigin("http://192.168.1.4:5173/", location);
  assert.ok(lan.some((message) => message.includes("127.0.0.1")));
});
