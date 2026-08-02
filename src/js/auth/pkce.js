const PKCE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const OAUTH_STATE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const PKCE_VERIFIER_MIN_LENGTH = 43;
export const PKCE_VERIFIER_MAX_LENGTH = 128;

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle?.digest) {
    throw new Error("A Web Crypto implementation is required for Spotify PKCE.");
  }

  return cryptoImpl;
}

function randomString(length, alphabet, cryptoImpl) {
  if (!Number.isInteger(length) || length < 1) {
    throw new TypeError("Random string length must be a positive integer.");
  }

  const cryptoApi = requireCrypto(cryptoImpl);
  const rejectionLimit = 256 - (256 % alphabet.length);
  let result = "";

  while (result.length < length) {
    const remaining = length - result.length;
    const bytes = new Uint8Array(Math.max(remaining * 2, 32));
    cryptoApi.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= rejectionLimit) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }

  return result;
}

function bytesToBase64(bytes) {
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;

    result += BASE64_ALPHABET[(value >>> 18) & 63];
    result += BASE64_ALPHABET[(value >>> 12) & 63];
    result += hasSecond ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    result += hasThird ? BASE64_ALPHABET[value & 63] : "=";
  }

  return result;
}

function toBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

export function assertValidCodeVerifier(verifier) {
  if (
    typeof verifier !== "string" ||
    verifier.length < PKCE_VERIFIER_MIN_LENGTH ||
    verifier.length > PKCE_VERIFIER_MAX_LENGTH ||
    !/^[A-Za-z0-9._~-]+$/u.test(verifier)
  ) {
    throw new TypeError(
      `PKCE code verifier must be ${PKCE_VERIFIER_MIN_LENGTH}-${PKCE_VERIFIER_MAX_LENGTH} RFC 7636 unreserved characters.`,
    );
  }

  return verifier;
}

export function generateCodeVerifier({
  length = 64,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (length < PKCE_VERIFIER_MIN_LENGTH || length > PKCE_VERIFIER_MAX_LENGTH) {
    throw new RangeError(
      `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}.`,
    );
  }

  return randomString(length, PKCE_ALPHABET, cryptoImpl);
}

export function generateOAuthState({
  length = 32,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!Number.isInteger(length) || length < 16) {
    throw new RangeError("OAuth state length must be an integer of at least 16.");
  }

  return randomString(length, OAUTH_STATE_ALPHABET, cryptoImpl);
}

export async function createCodeChallenge(
  verifier,
  { cryptoImpl = globalThis.crypto } = {},
) {
  assertValidCodeVerifier(verifier);
  const cryptoApi = requireCrypto(cryptoImpl);
  const encoded = new TextEncoder().encode(verifier);
  const digest = await cryptoApi.subtle.digest("SHA-256", encoded);
  return toBase64Url(new Uint8Array(digest));
}

export async function createPkcePair({
  verifierLength = 64,
  stateLength = 32,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const verifier = generateCodeVerifier({
    length: verifierLength,
    cryptoImpl,
  });
  const [challenge, state] = await Promise.all([
    createCodeChallenge(verifier, { cryptoImpl }),
    Promise.resolve(generateOAuthState({ length: stateLength, cryptoImpl })),
  ]);

  return { verifier, challenge, state };
}

export function oauthStatesMatch(receivedState, expectedState) {
  if (
    typeof receivedState !== "string" ||
    typeof expectedState !== "string" ||
    receivedState.length === 0 ||
    receivedState.length !== expectedState.length
  ) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < receivedState.length; index += 1) {
    difference |=
      receivedState.charCodeAt(index) ^ expectedState.charCodeAt(index);
  }

  return difference === 0;
}
