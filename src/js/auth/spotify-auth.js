import {
  createCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  oauthStatesMatch,
} from "./pkce.js";
import {
  TokenStore,
  mergeSpotifyTokenResponse,
} from "./token-store.js";

export const SPOTIFY_AUTHORIZE_ENDPOINT =
  "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_ENDPOINT =
  "https://accounts.spotify.com/api/token";
export const DEFAULT_OAUTH_TRANSACTION_KEY = "spool.auth.pkce";
export const DEFAULT_TOKEN_EXPIRY_SKEW_MS = 60_000;
export const DEFAULT_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_PENDING_OAUTH_TRANSACTIONS = 4;
const OAUTH_TRANSACTION_STORAGE_VERSION = 2;

function clockNow(clock) {
  return typeof clock === "function" ? clock() : clock.now();
}

function defaultTransactionStorage(fallback) {
  try {
    return globalThis.sessionStorage ?? fallback;
  } catch {
    return fallback;
  }
}

function responseContentType(response) {
  return response.headers?.get?.("content-type")?.toLowerCase() ?? "";
}

async function readTokenResponse(response) {
  const contentType = responseContentType(response);
  if (contentType.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error_description: text };
  }
}

function tokenErrorCode(payload, fallback = "token_request_failed") {
  if (typeof payload?.error === "string" && payload.error) {
    return payload.error;
  }
  if (typeof payload?.error?.reason === "string" && payload.error.reason) {
    return payload.error.reason;
  }
  return fallback;
}

function tokenErrorMessage(payload, response) {
  return (
    payload?.error_description ||
    payload?.error?.message ||
    payload?.message ||
    `Spotify authorization failed with HTTP ${response.status}.`
  );
}

function parseUrl(url, locationImpl) {
  const base =
    locationImpl?.origin ||
    (locationImpl?.href ? new URL(locationImpl.href).origin : null) ||
    "http://127.0.0.1";
  return new URL(url, base);
}

export class SpotifyAuthError extends Error {
  constructor(
    message,
    { code = "spotify_auth_error", status = null, details = null, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "SpotifyAuthError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function cleanSpotifyCallbackPath(
  url,
  { locationImpl = globalThis.location } = {},
) {
  const parsed = parseUrl(url, locationImpl);
  for (const parameter of [
    "code",
    "state",
    "error",
    "error_description",
    "error_uri",
    "ubi",
  ]) {
    parsed.searchParams.delete(parameter);
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function shouldReloadOAuthPageAfterBfcacheRestore({
  persisted,
  url,
  connectionState,
} = {}) {
  if (!persisted || !url) return false;
  const parameters = parseUrl(url).searchParams;
  return (
    parameters.has("code") ||
    parameters.has("error") ||
    connectionState === "authorizing"
  );
}

export class SpotifyAuth {
  constructor({
    clientId,
    redirectUri,
    scopes = [],
    fetchImpl = globalThis.fetch,
    storage = globalThis.localStorage,
    transactionStorage,
    tokenStore,
    clock = Date,
    cryptoImpl = globalThis.crypto,
    locationImpl = globalThis.location,
    historyImpl = globalThis.history,
    authorizeEndpoint = SPOTIFY_AUTHORIZE_ENDPOINT,
    tokenEndpoint = SPOTIFY_TOKEN_ENDPOINT,
    transactionKey = DEFAULT_OAUTH_TRANSACTION_KEY,
    transactionTtlMs = DEFAULT_OAUTH_TRANSACTION_TTL_MS,
    maxPendingTransactions = DEFAULT_MAX_PENDING_OAUTH_TRANSACTIONS,
    expirySkewMs = DEFAULT_TOKEN_EXPIRY_SKEW_MS,
    refreshTokenLifetimeMs = null,
  } = {}) {
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new TypeError("SpotifyAuth requires a Spotify Client ID.");
    }
    if (typeof redirectUri !== "string" || !redirectUri.trim()) {
      throw new TypeError("SpotifyAuth requires an exact redirect URI.");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("SpotifyAuth requires a fetch implementation.");
    }
    if (!Number.isInteger(maxPendingTransactions) || maxPendingTransactions < 1) {
      throw new TypeError("SpotifyAuth requires at least one pending OAuth transaction slot.");
    }

    this.clientId = clientId.trim();
    this.redirectUri = redirectUri;
    this.scopes = [...new Set(scopes.filter(Boolean).map(String))];
    this.fetch = fetchImpl;
    this.clock = clock;
    this.crypto = cryptoImpl;
    this.location = locationImpl;
    this.history = historyImpl;
    this.authorizeEndpoint = authorizeEndpoint;
    this.tokenEndpoint = tokenEndpoint;
    this.transactionKey = transactionKey;
    this.transactionTtlMs = transactionTtlMs;
    this.maxPendingTransactions = maxPendingTransactions;
    this.expirySkewMs = expirySkewMs;
    this.refreshTokenLifetimeMs = refreshTokenLifetimeMs;
    this.tokenStore =
      tokenStore ?? new TokenStore({ storage, clock: this.clock });
    this.transactionStorage =
      transactionStorage ?? defaultTransactionStorage(storage);
    if (
      !this.transactionStorage?.getItem ||
      !this.transactionStorage?.setItem ||
      !this.transactionStorage?.removeItem
    ) {
      throw new TypeError(
        "SpotifyAuth requires Storage-compatible transaction storage.",
      );
    }

    this.refreshPromise = null;
  }

  async createAuthorizationUrl({ showDialog = false } = {}) {
    const verifier = generateCodeVerifier({ cryptoImpl: this.crypto });
    const state = generateOAuthState({ cryptoImpl: this.crypto });
    const challenge = await createCodeChallenge(verifier, {
      cryptoImpl: this.crypto,
    });
    const createdAt = clockNow(this.clock);

    const transactions = this.readTransactions();
    transactions.push({ verifier, state, createdAt });
    this.writeTransactions(transactions.slice(-this.maxPendingTransactions));

    const url = new URL(this.authorizeEndpoint);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("state", state);
    if (this.scopes.length) url.searchParams.set("scope", this.scopes.join(" "));
    if (showDialog) url.searchParams.set("show_dialog", "true");
    return url.toString();
  }

  async beginAuthorization({ navigate, showDialog = false } = {}) {
    const url = await this.createAuthorizationUrl({ showDialog });
    if (typeof navigate === "function") {
      navigate(url);
    } else if (typeof this.location?.assign === "function") {
      this.location.assign(url);
    } else if (this.location) {
      this.location.href = url;
    } else {
      throw new SpotifyAuthError("No browser navigation target is available.", {
        code: "navigation_unavailable",
      });
    }
    return url;
  }

  readTransactions() {
    const raw = this.transactionStorage.getItem(this.transactionKey);
    if (!raw) return [];

    try {
      const value = JSON.parse(raw);
      const candidates = Array.isArray(value?.transactions)
        ? value.transactions
        : [value];
      const now = clockNow(this.clock);
      const transactions = candidates.filter((transaction) =>
        isValidTransaction(transaction) &&
        now - Number(transaction.createdAt) <= this.transactionTtlMs
      );

      if (
        value?.version !== OAUTH_TRANSACTION_STORAGE_VERSION ||
        transactions.length !== candidates.length
      ) {
        this.writeTransactions(transactions);
      }
      return transactions;
    } catch {
      this.clearTransaction();
      return [];
    }
  }

  readTransaction(state) {
    const transactions = this.readTransactions();
    if (typeof state !== "string" || !state) {
      return transactions.at(-1) ?? null;
    }
    return transactions.find((transaction) =>
      oauthStatesMatch(state, transaction.state)
    ) ?? null;
  }

  writeTransactions(transactions) {
    if (!transactions.length) {
      this.transactionStorage.removeItem(this.transactionKey);
      return;
    }
    this.transactionStorage.setItem(
      this.transactionKey,
      JSON.stringify({
        version: OAUTH_TRANSACTION_STORAGE_VERSION,
        transactions,
      }),
    );
  }

  clearTransaction(state) {
    if (typeof state !== "string" || !state) {
      this.transactionStorage.removeItem(this.transactionKey);
      return;
    }
    const transactions = this.readTransactions().filter((transaction) =>
      !oauthStatesMatch(state, transaction.state)
    );
    this.writeTransactions(transactions);
  }

  cleanupCallbackUrl(url = this.location?.href) {
    if (!url || typeof this.history?.replaceState !== "function") return null;
    const cleanPath = cleanSpotifyCallbackPath(url, {
      locationImpl: this.location,
    });
    this.history.replaceState(this.history.state ?? null, "", cleanPath);
    return cleanPath;
  }

  async handleCallback({ url = this.location?.href, cleanup = true } = {}) {
    if (!url) {
      throw new SpotifyAuthError("No callback URL is available.", {
        code: "callback_url_missing",
      });
    }

    const parsed = parseUrl(url, this.location);
    const code = parsed.searchParams.get("code");
    const oauthError = parsed.searchParams.get("error");
    const receivedState = parsed.searchParams.get("state");
    const handled = Boolean(code || oauthError);
    if (!handled) return { handled: false, tokens: null };

    try {
      const transaction = this.readTransaction(receivedState);

      if (
        !transaction ||
        !oauthStatesMatch(receivedState, transaction.state)
      ) {
        throw new SpotifyAuthError(
          "Spotify sign-in could not be verified. The login attempt may have expired or returned in a different browser context. Please try again.",
          { code: "invalid_state" },
        );
      }

      if (oauthError) {
        throw new SpotifyAuthError(
          parsed.searchParams.get("error_description") ||
            (oauthError === "access_denied"
              ? "Spotify authorization was denied."
              : "Spotify authorization failed."),
          { code: oauthError },
        );
      }

      const tokens = await this.exchangeAuthorizationCode(
        code,
        transaction.verifier,
      );
      return { handled: true, tokens };
    } finally {
      if (receivedState) this.clearTransaction(receivedState);
      if (cleanup) this.cleanupCallbackUrl(url);
    }
  }

  async exchangeAuthorizationCode(code, verifier) {
    if (!code || !verifier) {
      throw new SpotifyAuthError("Spotify callback data is incomplete.", {
        code: "callback_incomplete",
      });
    }

    const payload = await this.requestToken({
      client_id: this.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
    });
    const tokens = mergeSpotifyTokenResponse(payload, {
      now: clockNow(this.clock),
      authorizationGrant: true,
      refreshTokenLifetimeMs: this.refreshTokenLifetimeMs,
    });
    return this.tokenStore.write(tokens);
  }

  async requestToken(parameters) {
    let response;
    try {
      response = await this.fetch(this.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
      });
    } catch (cause) {
      throw new SpotifyAuthError("Could not reach Spotify authorization.", {
        code: "token_network_error",
        cause,
      });
    }

    const payload = await readTokenResponse(response);
    if (!response.ok) {
      throw new SpotifyAuthError(tokenErrorMessage(payload, response), {
        code: tokenErrorCode(payload),
        status: response.status,
        details: payload,
      });
    }
    return payload;
  }

  getTokenSnapshot() {
    return this.tokenStore.read();
  }

  hasSession() {
    const tokens = this.tokenStore.read();
    return Boolean(tokens?.accessToken || tokens?.refreshToken);
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    const tokens = this.tokenStore.read();
    const now = clockNow(this.clock);
    const accessTokenIsFresh = Boolean(
      tokens?.accessToken &&
        tokens.expiresAt &&
        tokens.expiresAt - this.expirySkewMs > now,
    );

    if (!forceRefresh && accessTokenIsFresh) return tokens.accessToken;
    if (!tokens?.refreshToken) {
      if (!forceRefresh && tokens?.accessToken && tokens.expiresAt > now) {
        return tokens.accessToken;
      }
      throw new SpotifyAuthError("Spotify authorization is required.", {
        code: "authorization_required",
      });
    }

    if (tokens.refreshExpiresAt && tokens.refreshExpiresAt <= now) {
      this.tokenStore.clear();
      throw new SpotifyAuthError(
        "Spotify authorization has expired. Please connect again.",
        { code: "refresh_token_expired" },
      );
    }

    const refreshed = await this.refreshAccessToken();
    return refreshed.accessToken;
  }

  async refreshAccessToken() {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshOperation = this.performRefresh();
    this.refreshPromise = refreshOperation.finally(() => {
      if (this.refreshPromise === wrappedPromise) this.refreshPromise = null;
    });
    const wrappedPromise = this.refreshPromise;
    return wrappedPromise;
  }

  async performRefresh() {
    const previous = this.tokenStore.read();
    const now = clockNow(this.clock);
    if (!previous?.refreshToken) {
      throw new SpotifyAuthError("Spotify authorization is required.", {
        code: "authorization_required",
      });
    }
    if (previous.refreshExpiresAt && previous.refreshExpiresAt <= now) {
      this.tokenStore.clear();
      throw new SpotifyAuthError(
        "Spotify authorization has expired. Please connect again.",
        { code: "refresh_token_expired" },
      );
    }

    try {
      const payload = await this.requestToken({
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: previous.refreshToken,
      });
      const tokens = mergeSpotifyTokenResponse(payload, {
        previous,
        now: clockNow(this.clock),
        refreshTokenLifetimeMs: this.refreshTokenLifetimeMs,
      });
      return this.tokenStore.write(tokens);
    } catch (error) {
      if (error instanceof SpotifyAuthError && error.code === "invalid_grant") {
        this.tokenStore.clear();
      }
      throw error;
    }
  }

  async provideSdkToken(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Spotify SDK token callback must be a function.");
    }
    callback(await this.getAccessToken());
  }

  logout() {
    this.tokenStore.clear();
    this.clearTransaction();
  }
}

export function createSpotifyAuth(options) {
  return new SpotifyAuth(options);
}

function isValidTransaction(transaction) {
  return Boolean(
    transaction &&
      typeof transaction.verifier === "string" &&
      typeof transaction.state === "string" &&
      Number.isFinite(Number(transaction.createdAt)),
  );
}
