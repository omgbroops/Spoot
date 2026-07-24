export const DEFAULT_TOKEN_STORAGE_KEY = "spool.auth.tokens";
export const SPOTIFY_REFRESH_TOKEN_LIFETIME_MONTHS = 6;

function nowFrom(clock) {
  return typeof clock?.now === "function" ? clock.now() : clock();
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes)
    ? scopes
    : typeof scopes === "string"
      ? scopes.split(/\s+/u)
      : [];

  return [...new Set(values.filter(Boolean).map(String))];
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function spotifyRefreshExpiryFrom(
  authorizedAt,
  { lifetimeMonths = SPOTIFY_REFRESH_TOKEN_LIFETIME_MONTHS } = {},
) {
  const source = new Date(authorizedAt);
  if (!Number.isFinite(source.getTime())) {
    throw new TypeError("A valid authorization timestamp is required.");
  }

  const totalMonth = source.getUTCMonth() + lifetimeMonths;
  const targetYear = source.getUTCFullYear() + Math.floor(totalMonth / 12);
  const targetMonth = ((totalMonth % 12) + 12) % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), lastTargetDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
}

export function normalizeStoredTokens(value) {
  if (!value || typeof value !== "object") return null;

  const accessToken =
    typeof value.accessToken === "string" && value.accessToken
      ? value.accessToken
      : null;
  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken:
      typeof value.refreshToken === "string" && value.refreshToken
        ? value.refreshToken
        : null,
    tokenType:
      typeof value.tokenType === "string" && value.tokenType
        ? value.tokenType
        : "Bearer",
    expiresAt: finiteTimestamp(value.expiresAt),
    refreshExpiresAt: finiteTimestamp(value.refreshExpiresAt),
    authorizedAt: finiteTimestamp(value.authorizedAt),
    scopes: normalizeScopes(value.scopes),
  };
}

export function mergeSpotifyTokenResponse(
  response,
  {
    previous = null,
    now = Date.now(),
    authorizationGrant = false,
    refreshTokenLifetimeMs = null,
  } = {},
) {
  if (!response || typeof response !== "object") {
    throw new TypeError("Spotify token response must be an object.");
  }

  const accessToken = response.access_token;
  const expiresIn = Number(response.expires_in);
  if (typeof accessToken !== "string" || !accessToken) {
    throw new TypeError("Spotify token response did not include an access token.");
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new TypeError("Spotify token response included an invalid expiry.");
  }

  const normalizedPrevious = normalizeStoredTokens(previous);
  const returnedRefreshToken =
    typeof response.refresh_token === "string" && response.refresh_token
      ? response.refresh_token
      : null;
  const refreshToken =
    returnedRefreshToken ?? normalizedPrevious?.refreshToken ?? null;
  const refreshExpiryFrom = (timestamp) =>
    Number.isFinite(refreshTokenLifetimeMs)
      ? timestamp + refreshTokenLifetimeMs
      : spotifyRefreshExpiryFrom(timestamp);
  const refreshExpiresAt = authorizationGrant
    ? refreshExpiryFrom(now)
    : normalizedPrevious?.refreshExpiresAt ??
      (normalizedPrevious?.authorizedAt
        ? refreshExpiryFrom(normalizedPrevious.authorizedAt)
        : null);

  return {
    accessToken,
    refreshToken,
    tokenType:
      typeof response.token_type === "string" && response.token_type
        ? response.token_type
        : normalizedPrevious?.tokenType ?? "Bearer",
    expiresAt: now + expiresIn * 1000,
    refreshExpiresAt,
    authorizedAt: authorizationGrant
      ? now
      : normalizedPrevious?.authorizedAt ?? now,
    scopes:
      response.scope !== undefined
        ? normalizeScopes(response.scope)
        : normalizedPrevious?.scopes ?? [],
  };
}

export class TokenStore {
  constructor({
    storage = globalThis.localStorage,
    key = DEFAULT_TOKEN_STORAGE_KEY,
    clock = Date,
  } = {}) {
    if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) {
      throw new TypeError("TokenStore requires a Storage-compatible object.");
    }

    this.storage = storage;
    this.key = key;
    this.clock = clock;
  }

  read() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;

    try {
      const normalized = normalizeStoredTokens(JSON.parse(raw));
      if (!normalized) this.clear();
      return normalized;
    } catch {
      this.clear();
      return null;
    }
  }

  write(tokens) {
    const normalized = normalizeStoredTokens(tokens);
    if (!normalized) {
      throw new TypeError("Cannot persist an invalid Spotify token set.");
    }

    this.storage.setItem(this.key, JSON.stringify(normalized));
    return { ...normalized, scopes: [...normalized.scopes] };
  }

  clear() {
    this.storage.removeItem(this.key);
  }

  hasUsableAccessToken({ skewMs = 0 } = {}) {
    const tokens = this.read();
    return Boolean(
      tokens?.accessToken &&
        tokens.expiresAt &&
        tokens.expiresAt - skewMs > nowFrom(this.clock),
    );
  }

  hasUsableRefreshToken() {
    const tokens = this.read();
    if (!tokens?.refreshToken) return false;
    return (
      tokens.refreshExpiresAt === null ||
      tokens.refreshExpiresAt > nowFrom(this.clock)
    );
  }
}

export function createTokenStore(options) {
  return new TokenStore(options);
}
