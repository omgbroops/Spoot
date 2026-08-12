const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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
