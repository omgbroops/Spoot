export const REQUIRED_SPOTIFY_SCOPES = Object.freeze([
  "streaming",
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
]);

const PLACEHOLDER_CLIENT_IDS = new Set([
  "",
  "YOUR_SPOTIFY_CLIENT_ID",
  "replace-me",
]);

export function isMockMode(locationLike = globalThis.location) {
  if (!locationLike) return false;
  return new URL(locationLike.href).searchParams.get("mock") === "1";
}

export async function loadConfig({ mock = isMockMode() } = {}) {
  if (mock) {
    return {
      clientId: "mock-client-id",
      redirectUri: deriveRedirectUri(),
      deviceName: "Spool (Mock)",
      scopes: REQUIRED_SPOTIFY_SCOPES,
      configured: true,
      mock: true,
    };
  }

  let source;
  try {
    source = await import("./config.local.js");
  } catch {
    source = await import("./config.example.js");
  }

  const clientId = String(source.SPOTIFY_CLIENT_ID ?? "").trim();
  const redirectUri = String(
    source.SPOTIFY_REDIRECT_URI || deriveRedirectUri(),
  ).trim();

  return {
    clientId,
    redirectUri,
    deviceName: String(source.SPOTIFY_DEVICE_NAME || "Spool").trim(),
    scopes: REQUIRED_SPOTIFY_SCOPES,
    configured: !PLACEHOLDER_CLIENT_IDS.has(clientId),
    mock: false,
  };
}

export function deriveRedirectUri(locationLike = globalThis.location) {
  if (!locationLike) return "http://127.0.0.1:5173/";
  return `${locationLike.origin}${locationLike.pathname}`;
}

export function validateDevelopmentOrigin(
  redirectUri,
  locationLike = globalThis.location,
) {
  const redirect = new URL(redirectUri);
  const problems = [];

  if (redirect.hostname === "localhost") {
    problems.push("Spotify does not accept localhost redirect URIs; use 127.0.0.1.");
  }

  if (redirect.protocol !== "https:" && redirect.hostname !== "127.0.0.1") {
    problems.push("An HTTP redirect URI must use the explicit 127.0.0.1 loopback address.");
  }

  if (locationLike && redirect.origin !== locationLike.origin) {
    problems.push("The configured redirect origin does not match this page.");
  }

  return problems;
}
