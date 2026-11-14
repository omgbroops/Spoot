const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function buildManualOAuthCallbackUrl(
  value,
  { redirectUri, pendingStates = [] } = {},
) {
  const input = String(value ?? "").trim();
  if (!input) {
    throw new Error("Paste the Spotify code or the complete callback URL.");
  }

  let redirect;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error("Spoot's Spotify redirect URL is not configured.");
  }

  const states = pendingStates.filter(
    (state) => typeof state === "string" && state,
  );
  let callback;
  try {
    if (/^https?:\/\//iu.test(input)) {
      callback = new URL(input);
    } else if (input.startsWith("?")) {
      callback = new URL(input, redirect);
    } else if (/^(?:code|error)=/iu.test(input)) {
      callback = new URL(redirect);
      callback.search = input;
    } else {
      if (!states.length) {
        throw new Error(
          "Choose Log in first so Spoot can create the required PKCE login attempt.",
        );
      }
      if (states.length > 1) {
        throw new Error(
          "More than one login attempt is pending. Paste the complete callback URL instead.",
        );
      }
      callback = new URL(redirect);
      callback.searchParams.set("code", input);
      callback.searchParams.set("state", states[0]);
    }
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error("That Spotify callback could not be read.");
  }

  if (callback.origin !== redirect.origin) {
    throw new Error("That callback URL does not match Spoot's Spotify redirect origin.");
  }
  if (
    !callback.searchParams.has("code") &&
    !callback.searchParams.has("error")
  ) {
    throw new Error("That callback does not contain a Spotify authorization code.");
  }

  const state = callback.searchParams.get("state");
  if (!state) {
    throw new Error("That callback is missing its login state. Paste the complete URL.");
  }
  if (!states.includes(state)) {
    throw new Error(
      "That callback does not match a pending Spoot login. Choose Log in and try again.",
    );
  }
  return callback.href;
}

export function watchOAuthPopup({
  popup,
  expectedOrigin,
  onCallback,
  onClosed,
  onTimeout,
  onError,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  clock = Date.now,
} = {}) {
  if (!popup) throw new TypeError("An OAuth popup is required.");
  if (typeof onCallback !== "function") {
    throw new TypeError("An OAuth callback handler is required.");
  }

  const origin = new URL(expectedOrigin).origin;
  const startedAt = clock();
  let timer;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearIntervalImpl.call(globalThis, timer);
  };

  const inspect = () => {
    if (stopped) return;
    if (popup.closed) {
      stop();
      onClosed?.();
      return;
    }
    if (timeoutMs > 0 && clock() - startedAt >= timeoutMs) {
      stop();
      onTimeout?.();
      return;
    }

    let callbackUrl;
    try {
      callbackUrl = new URL(popup.location.href);
    } catch {
      // Reading the popup URL is blocked while it is on accounts.spotify.com.
      return;
    }
    if (callbackUrl.origin !== origin) return;
    if (
      !callbackUrl.searchParams.has("code") &&
      !callbackUrl.searchParams.has("error")
    ) return;

    stop();
    try {
      Promise.resolve(onCallback(callbackUrl.href, popup)).catch((error) => {
        onError?.(error);
      });
    } catch (error) {
      onError?.(error);
    }
  };

  timer = setIntervalImpl.call(globalThis, inspect, intervalMs);
  inspect();
  return stop;
}
