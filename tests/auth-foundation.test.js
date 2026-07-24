import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  createCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  oauthStatesMatch,
} from "../src/js/auth/pkce.js";
import {
  SpotifyAuth,
  SpotifyAuthError,
  cleanSpotifyCallbackPath,
  shouldReloadOAuthPageAfterBfcacheRestore,
} from "../src/js/auth/spotify-auth.js";
import {
  TokenStore,
  spotifyRefreshExpiryFrom,
} from "../src/js/auth/token-store.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function storedTokens(now, overrides = {}) {
  return {
    accessToken: "old-access",
    refreshToken: "refresh-original",
    tokenType: "Bearer",
    expiresAt: now - 1,
    refreshExpiresAt: now + 50_000,
    authorizedAt: now - 1_000,
    scopes: ["streaming"],
    ...overrides,
  };
}

test("PKCE produces a strong verifier, state, and RFC 7636 challenge", async () => {
  const verifier = generateCodeVerifier({ length: 96, cryptoImpl: webcrypto });
  const state = generateOAuthState({ length: 40, cryptoImpl: webcrypto });
  assert.equal(verifier.length, 96);
  assert.match(verifier, /^[A-Za-z0-9._~-]+$/u);
  assert.equal(state.length, 40);
  assert.equal(oauthStatesMatch(state, state), true);
  assert.equal(oauthStatesMatch(state, `${state.slice(0, -1)}x`), false);

  const knownVerifier =
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(
    await createCodeChallenge(knownVerifier, { cryptoImpl: webcrypto }),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("refresh-token expiry tracks six calendar months without extending on rotation", () => {
  const authorizedAt = Date.UTC(2026, 7, 31, 12, 30);
  assert.equal(
    spotifyRefreshExpiryFrom(authorizedAt),
    Date.UTC(2027, 1, 28, 12, 30),
  );
});

test("SpotifyAuth validates callback state, exchanges tokens, and cleans OAuth parameters", async () => {
  const now = 10_000;
  const storage = new MemoryStorage();
  const session = new MemoryStorage();
  const historyCalls = [];
  const fetchCalls = [];
  const auth = new SpotifyAuth({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5173/",
    scopes: ["streaming", "user-read-playback-state"],
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return jsonResponse({
        access_token: "access-one",
        refresh_token: "refresh-one",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "streaming user-read-playback-state",
      });
    },
    storage,
    transactionStorage: session,
    clock: () => now,
    cryptoImpl: webcrypto,
    locationImpl: {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
    },
    historyImpl: {
      state: { preserved: true },
      replaceState: (...args) => historyCalls.push(args),
    },
  });

  const authorizeUrl = new URL(await auth.createAuthorizationUrl());
  const state = authorizeUrl.searchParams.get("state");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorizeUrl.searchParams.get("scope"),
    "streaming user-read-playback-state",
  );

  const callback = `http://127.0.0.1:5173/?keep=1&code=auth-code&state=${state}&ubi=spotify-browser-context#player`;
  const result = await auth.handleCallback({ url: callback });
  assert.equal(result.handled, true);
  assert.equal(result.tokens.accessToken, "access-one");
  assert.equal(result.tokens.refreshToken, "refresh-one");
  assert.equal(result.tokens.expiresAt, now + 3_600_000);
  assert.equal(session.getItem("spool.auth.pkce"), null);
  assert.deepEqual(historyCalls, [
    [{ preserved: true }, "", "/?keep=1#player"],
  ]);

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://accounts.spotify.com/api/token");
  assert.equal(fetchCalls[0].options.body.get("client_id"), "client-id");
  assert.equal(fetchCalls[0].options.body.get("code_verifier")?.length, 64);
  assert.equal(
    cleanSpotifyCallbackPath(callback, {
      locationImpl: { origin: "http://127.0.0.1:5173" },
    }),
    "/?keep=1#player",
  );
});

test("SpotifyAuth keeps overlapping PKCE attempts isolated by OAuth state", async () => {
  const storage = new MemoryStorage();
  const transactionStorage = new MemoryStorage();
  const exchangedCodes = [];
  const auth = new SpotifyAuth({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5173/",
    fetchImpl: async (_url, options) => {
      exchangedCodes.push(options.body.get("code"));
      return jsonResponse({
        access_token: `access-${exchangedCodes.length}`,
        refresh_token: "refresh-token",
        expires_in: 3600,
      });
    },
    storage,
    transactionStorage,
    clock: () => 25_000,
    cryptoImpl: webcrypto,
    locationImpl: { origin: "http://127.0.0.1:5173" },
    historyImpl: { replaceState: () => {} },
  });

  const firstState = new URL(await auth.createAuthorizationUrl()).searchParams.get("state");
  const secondState = new URL(await auth.createAuthorizationUrl()).searchParams.get("state");

  await auth.handleCallback({
    url: `http://127.0.0.1:5173/?code=first-code&state=${firstState}`,
  });
  assert.equal(auth.readTransaction(secondState)?.state, secondState);

  await auth.handleCallback({
    url: `http://127.0.0.1:5173/?code=second-code&state=${secondState}`,
  });
  assert.deepEqual(exchangedCodes, ["first-code", "second-code"]);
  assert.equal(transactionStorage.getItem("spool.auth.pkce"), null);
});

test("OAuth callbacks restored from the back-forward cache trigger one real reload", () => {
  assert.equal(
    shouldReloadOAuthPageAfterBfcacheRestore({
      persisted: true,
      url: "http://127.0.0.1:5173/?code=callback-code&state=callback-state",
      connectionState: "authorizing",
    }),
    true,
  );
  assert.equal(
    shouldReloadOAuthPageAfterBfcacheRestore({
      persisted: true,
      url: "http://127.0.0.1:5173/",
      connectionState: "authorizing",
    }),
    true,
  );
  assert.equal(
    shouldReloadOAuthPageAfterBfcacheRestore({
      persisted: false,
      url: "http://127.0.0.1:5173/?code=callback-code",
      connectionState: "authorizing",
    }),
    false,
  );
  assert.equal(
    shouldReloadOAuthPageAfterBfcacheRestore({
      persisted: true,
      url: "http://127.0.0.1:5173/",
      connectionState: "active",
    }),
    false,
  );
});

test("SpotifyAuth rejects mismatched state without destroying another pending attempt", async () => {
  const storage = new MemoryStorage();
  const session = new MemoryStorage();
  const historyCalls = [];
  let fetchCount = 0;
  const auth = new SpotifyAuth({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5173/",
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({});
    },
    storage,
    transactionStorage: session,
    clock: () => 100,
    cryptoImpl: webcrypto,
    locationImpl: { origin: "http://127.0.0.1:5173" },
    historyImpl: {
      replaceState: (...args) => historyCalls.push(args),
    },
  });
  await auth.createAuthorizationUrl();

  await assert.rejects(
    auth.handleCallback({
      url: "http://127.0.0.1:5173/?code=nope&state=wrong",
    }),
    (error) =>
      error instanceof SpotifyAuthError && error.code === "invalid_state",
  );
  assert.equal(fetchCount, 0);
  assert.equal(session.values.size, 1, "the unrelated pending attempt is preserved");
  assert.equal(historyCalls.at(-1).at(-1), "/");
});

test("token provider refreshes once for concurrent callers and preserves or rotates refresh tokens", async () => {
  let now = 50_000;
  const storage = new MemoryStorage();
  const session = new MemoryStorage();
  const store = new TokenStore({ storage, clock: () => now });
  const original = store.write(storedTokens(now));
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const responses = [
    async () => {
      await firstGate;
      return jsonResponse({ access_token: "access-two", expires_in: 3600 });
    },
    async () =>
      jsonResponse({
        access_token: "access-three",
        refresh_token: "refresh-rotated",
        expires_in: 3600,
      }),
  ];
  let fetchCount = 0;
  const auth = new SpotifyAuth({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5173/",
    fetchImpl: async () => {
      const response = responses[fetchCount];
      fetchCount += 1;
      return response();
    },
    tokenStore: store,
    storage,
    transactionStorage: session,
    clock: () => now,
    cryptoImpl: webcrypto,
  });

  const first = auth.getAccessToken();
  const second = auth.getAccessToken();
  assert.equal(fetchCount, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [
    "access-two",
    "access-two",
  ]);
  assert.equal(store.read().refreshToken, "refresh-original");

  now += 1_000;
  assert.equal(await auth.getAccessToken({ forceRefresh: true }), "access-three");
  assert.equal(store.read().refreshToken, "refresh-rotated");
  assert.equal(store.read().refreshExpiresAt, original.refreshExpiresAt);
  assert.equal(fetchCount, 2);
});

test("invalid_grant clears the stored session instead of retrying it", async () => {
  const now = 90_000;
  const storage = new MemoryStorage();
  const store = new TokenStore({ storage, clock: () => now });
  store.write(storedTokens(now));
  const auth = new SpotifyAuth({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5173/",
    fetchImpl: async () =>
      jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Refresh token expired",
        },
        { status: 400 },
      ),
    tokenStore: store,
    storage,
    transactionStorage: new MemoryStorage(),
    clock: () => now,
    cryptoImpl: webcrypto,
  });

  await assert.rejects(
    auth.getAccessToken(),
    (error) =>
      error instanceof SpotifyAuthError && error.code === "invalid_grant",
  );
  assert.equal(store.read(), null);
});
