import {
  isMockMode,
  loadConfig,
  validateDevelopmentOrigin,
} from "./config.js";
import {
  SpotifyAuth,
  SpotifyAuthError,
  shouldReloadOAuthPageAfterBfcacheRestore,
} from "./auth/spotify-auth.js?v=20260723-oauth6";
import { createOAuthTransactionStorage } from "./auth/transaction-storage.js?v=20260723-oauth6";
import { DEFAULT_TOKEN_STORAGE_KEY } from "./auth/token-store.js";
import { SpotifyApiClient, SpotifyApiError } from "./spotify/api-client.js";
import { SpotifyPlaybackSdk } from "./spotify/playback-sdk.js";
import { PlaybackController } from "./spotify/playback-controller.js";
import { SpotifyQueueService } from "./spotify/queue-service.js";
import { MockPlaybackController } from "./mock/mock-playback-controller.js";
import { getElements } from "./ui/elements.js";
import {
  renderNowPlaying,
  renderPlaybackControls,
  renderProgress,
  setPlaybackControlsEnabled,
} from "./ui/now-playing.js";
import { renderQueue, renderQueueUnavailable } from "./ui/queue.js";
import {
  closeImmersive,
  isImmersiveOpen,
  renderImmersive,
  setupImmersive,
  toggleImmersive,
} from "./ui/immersive.js";
import {
  setupWidgets,
  setDockVisible,
  setHiddenMode,
  setLyricsVisible,
  setQueueVisible,
  toggleHiddenMode,
} from "./ui/widgets.js";
import {
  renderConnectionStatus,
  renderSpotifySettings,
  setupConnectionStatus,
} from "./ui/connection-status.js";
import {
  closeModals,
  isModalOpen,
  openModal,
  setupModals,
} from "./ui/modals.js";
import {
  explainInactiveFeature,
  setupInactiveFeatures,
} from "./ui/inactive-features.js";
import { setupToast, showToast } from "./ui/toast.js";

const UI_PREFERENCES_KEY = "spool.ui.preferences";
const OAUTH_POPUP_NAME = "spool-spotify-auth";
const OAUTH_COMPLETE_MESSAGE = "spool:oauth-complete";
const MOCK_SCENARIOS = new Set([
  "default",
  "paused",
  "empty-queue",
  "auth-error",
  "sdk-error",
  "rate-limit",
  "null",
]);

let config;
let auth;
let controller;
let connectionState = "not-configured";
let currentPlayback = null;
let currentQueue = null;
let controllerUnsubscribers = [];
let queueVisible = true;
let dockVisible = true;
let lyricsVisible = false;

window.addEventListener("pageshow", (event) => {
  if (
    shouldReloadOAuthPageAfterBfcacheRestore({
      persisted: event.persisted,
      url: location.href,
      connectionState,
    })
  ) {
    location.reload();
  }
});
window.addEventListener("message", (event) => {
  if (
    event.origin === location.origin &&
    event.data?.type === OAUTH_COMPLETE_MESSAGE
  ) {
    completeOAuthOnOriginalTab();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === DEFAULT_TOKEN_STORAGE_KEY && event.newValue) {
    completeOAuthOnOriginalTab();
  }
});

await initialize().catch((error) => {
  console.error("Spool initialization failed.", safeDiagnostic(error));
  renderConnection("error", {
    message: "Spool could not start. Check the console for a redacted diagnostic.",
  });
  showToast("Spool could not start.");
});

async function initialize() {
  setupUi();
  config = await loadConfig();

  if (config.mock) {
    await initializeMockMode();
    return;
  }

  const originProblems = validateDevelopmentOrigin(config.redirectUri);
  if (!config.configured || originProblems.length) {
    const message = originProblems[0] || "Copy config.example.js to config.local.js and add your Client ID.";
    renderConnection("not-configured", { message });
    renderSpotifySettings({
      loggedIn: false,
      accountText: "Spotify Client ID missing",
      deviceText: "Register http://127.0.0.1:5173/ as the redirect URI",
      onConnect: showSetupHelp,
      connectLabel: "Setup help",
    });
    return;
  }

  auth = new SpotifyAuth({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    storage: localStorage,
    // Mirror the short-lived verifier across both browser storage scopes: the
    // current tab can use sessionStorage, while a fresh callback tab can fall
    // back to same-origin localStorage. The matching entry is then consumed.
    transactionStorage: createOAuthTransactionStorage({
      localStorage,
      sessionStorage,
    }),
  });

  const callback = new URL(location.href).searchParams;
  if (callback.has("code") || callback.has("error")) {
    renderConnection("authorizing");
    try {
      await auth.handleCallback();
      showToast("Spotify connected.");
      if (notifyOAuthOpener()) return;
    } catch (error) {
      console.warn(
        "Spotify authorization callback failed.",
        safeDiagnostic(error, "oauth-callback"),
      );
      const state = isAuthorizationExpired(error) ? "authorization-expired" : "error";
      renderConnection(state, { message: humanizeError(error) });
      renderSpotifySettings({ loggedIn: false, onConnect: login });
      return;
    }
  }

  if (!auth.hasSession()) {
    renderLoggedOut();
    return;
  }

  createLiveController();
  renderConnection("logged-in");
  renderSettings();
}

function setupUi() {
  setupToast();
  setupModals();
  setupInactiveFeatures();
  setupWidgets();
  setupImmersive({
    onLyricsToggle: (visible) => {
      if (visible) showToast("Lyrics are not connected yet.");
    },
  });
  setupConnectionStatus({
    onPrimary: handlePrimaryAction,
    onConnect: login,
    onTransfer: transferHere,
    onDisconnect: logout,
  });

  const preferences = readUiPreferences();
  queueVisible = preferences.queueVisible !== false;
  dockVisible = preferences.dockVisible !== false;
  lyricsVisible = Boolean(preferences.lyricsVisible);
  setQueueVisible(queueVisible);
  setDockVisible(dockVisible);
  setLyricsVisible(lyricsVisible);
  setHiddenMode(false);

  renderNowPlaying({ emptyMessage: "Connect Spotify to start" });
  renderImmersive({ emptyMessage: "Connect Spotify to start" });
  renderQueue({ status: "disconnected" });
  setPlaybackControlsEnabled(false, "Connect the Spool player first");

  bindPlaybackButtons();
  bindSeekSurface(getElements().seek);
  bindSeekSurface(getElements().immersiveSeek);
  bindDock();
  bindKeyboard();

  window.addEventListener("online", () => {
    showToast("Network restored. Rechecking Spotify…");
    reconcilePlayback();
  });
  window.addEventListener("offline", () => {
    showToast("Network unavailable.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcilePlayback();
  });
}

async function initializeMockMode() {
  const requested = new URL(location.href).searchParams.get("scenario") || "default";
  const scenario = MOCK_SCENARIOS.has(requested) ? requested : "default";
  controller = new MockPlaybackController({ scenario });
  bindController(controller);
  renderConnection("logged-in", {
    title: "Spool mock mode",
    message: "No Spotify credentials or requests are used in mock mode.",
  });

  try {
    await controller.connect();
    await controller.transferHere();

    if (scenario === "rate-limit") {
      await controller.refreshState();
    } else {
      await Promise.all([controller.refreshState(), controller.refreshQueue()]);
    }

    renderConnection("active", {
      title: "Spool mock mode",
      message: `Scenario: ${scenario}. No Spotify requests are being made.`,
    });
  } catch (error) {
    const state = scenario === "auth-error" ? "authorization-expired" : "error";
    renderConnection(state, {
      title: "Spool mock mode",
      message: humanizeError(error),
    });
  }
  renderSettings();
}

function createLiveController() {
  const apiClient = new SpotifyApiClient({ tokenProvider: auth });
  const sdk = new SpotifyPlaybackSdk({
    tokenProvider: auth,
    name: config.deviceName,
  });
  const queueService = new SpotifyQueueService({ apiClient });
  controller = new PlaybackController({ apiClient, sdk, queueService });
  bindController(controller);
}

function bindController(nextController) {
  controllerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  controllerUnsubscribers = [
    nextController.on("connection", (status) => {
      renderConnection(status.state, status);
      renderSettings(status);
    }),
    nextController.on("state", (playback) => {
      currentPlayback = playback;
      renderPlayback(playback);
      renderSettings();
    }),
    nextController.on("progress", (positionMs) => {
      if (!currentPlayback) return;
      renderProgress(positionMs, currentPlayback.durationMs);
      renderImmersive({ ...currentPlayback, positionMs });
    }),
    nextController.on("queue", (queue) => {
      currentQueue = queue;
      renderQueue(queue);
    }),
    nextController.on("notice", ({ message }) => showToast(message)),
    nextController.on("null-state", ({ message }) => {
      showToast(message);
      renderNowPlaying({ emptyMessage: "No active Spotify playback" });
      renderImmersive({ emptyMessage: "No active Spotify playback" });
    }),
    nextController.on("error", ({ message, error, operation }) => {
      console.warn("Spotify operation failed.", safeDiagnostic(error, operation));
      showToast(message || humanizeError(error));
      if (operation === "refresh-queue") {
        renderQueueUnavailable(message);
      }
    }),
  ];
}

function renderPlayback(playback) {
  const normalized = playback || { emptyMessage: "No active Spotify playback" };
  renderNowPlaying(normalized);
  renderImmersive(normalized);
  renderPlaybackControls(normalized);

  const hasItem = Boolean(playback?.item || playback?.currentItem);
  const enabled = Boolean(playback?.activeDevice && hasItem);
  setPlaybackControlsEnabled(
    enabled,
    hasItem ? "Use Spool as the active device first" : "Start a track in Spotify first",
  );

  document.title = playback?.title ? `${playback.title} — Spool` : "Spool";
}

function renderConnection(state, overrides = {}) {
  connectionState = state;
  renderConnectionStatus({
    state,
    ...overrides,
    onPrimary: overrides.onPrimary || handlePrimaryAction,
    secondary: state === "not-configured"
      ? { label: "README", onClick: () => open("./README.md", "_blank", "noopener") }
      : overrides.secondary,
  });
}

function renderLoggedOut() {
  currentPlayback = null;
  currentQueue = null;
  setHiddenMode(false);
  renderConnection("logged-out");
  renderNowPlaying({ emptyMessage: "Log in to Spotify to start" });
  renderImmersive({ emptyMessage: "Log in to Spotify to start" });
  renderQueue({ status: "disconnected" });
  setPlaybackControlsEnabled(false, "Log in to Spotify first");
  renderSettings();
}

function renderSettings(status = {}) {
  const loggedIn = Boolean(config?.mock || auth?.hasSession());
  renderSpotifySettings({
    loggedIn,
    deviceReady: Boolean(controller?.deviceId),
    transferring: connectionState === "transferring-playback",
    accountText: config?.mock ? "Mock session" : loggedIn ? "Spotify connected" : "Not connected",
    deviceText: controller?.deviceId
      ? connectionState === "active" ? "Spool is the active device" : "Spool device ready"
      : status.message || "Spool device unavailable",
    onConnect: login,
    onTransfer: transferHere,
    onDisconnect: logout,
  });
}

async function handlePrimaryAction() {
  if (connectionState === "not-configured") return showSetupHelp();
  if (connectionState === "logged-out" || connectionState === "authorization-expired") return login();
  if (connectionState === "logged-in") return connectPlayer();
  if (connectionState === "player-ready") return transferHere();
  if (connectionState === "temporarily-unavailable" || connectionState === "error") {
    return controller ? connectPlayer() : login();
  }
}

async function login() {
  if (config?.mock) {
    showToast("Mock mode does not contact Spotify.");
    return;
  }
  if (!auth) {
    showSetupHelp();
    return;
  }
  const popup = window.open(
    "about:blank",
    OAUTH_POPUP_NAME,
    "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes",
  );
  if (!popup) {
    renderConnection("error", {
      message: "Allow popups for 127.0.0.1, then try logging in again.",
    });
    return;
  }

  renderConnection("authorizing", {
    message: "Finish signing in through the Spotify popup.",
  });
  try {
    await auth.beginAuthorization({
      // Keep the original 127.0.0.1 tab open. Privacy browsers may erase all
      // first-party storage when the last tab for a site navigates away.
      navigate: (url) => popup.location.replace(url),
    });
    popup.focus();
  } catch (error) {
    popup.close();
    renderConnection("error", { message: humanizeError(error) });
  }
}

function completeOAuthOnOriginalTab() {
  if (!auth?.hasSession() || controller) return;
  createLiveController();
  renderConnection("logged-in");
  renderSettings();
  showToast("Spotify connected.");
}

function notifyOAuthOpener() {
  try {
    if (!window.opener || window.opener.closed) return false;
    window.opener.postMessage({ type: OAUTH_COMPLETE_MESSAGE }, location.origin);
    window.close();
    return true;
  } catch {
    return false;
  }
}

async function connectPlayer() {
  if (!controller && auth?.hasSession()) createLiveController();
  if (!controller) return login();
  try {
    await controller.connect();
  } catch (error) {
    renderConnection(isAuthorizationExpired(error) ? "authorization-expired" : "error", {
      message: humanizeError(error),
    });
  }
}

async function transferHere() {
  if (!controller) return;
  try {
    await controller.transferHere();
    if (!controller.playbackState?.item) {
      showToast("Spool is ready. Start a track in Spotify, then press play here once if needed.", { duration: 4200 });
    } else if (!controller.playbackState?.isPlaying) {
      showToast("Press play once if the browser is waiting for audio permission.", { duration: 3600 });
    }
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function logout() {
  try {
    await controller?.disconnect?.();
    controller?.destroy?.();
  } catch (error) {
    console.warn("Player disconnect failed.", safeDiagnostic(error));
  }
  controllerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  controllerUnsubscribers = [];
  controller = undefined;
  auth?.logout();
  renderLoggedOut();
  showToast("Spotify disconnected.");
}

function bindPlaybackButtons() {
  const elements = getElements();
  bindCommand([elements.play, elements.immersivePlay], () => controller?.togglePlay());
  bindCommand([elements.previous, elements.immersivePrevious], () => controller?.previous());
  bindCommand([elements.next, elements.immersiveNext], () => controller?.next());
  bindCommand([elements.shuffle, elements.immersiveShuffle], () =>
    controller?.setShuffle(!currentPlayback?.shuffleEnabled),
  );
  bindCommand([elements.repeat, elements.immersiveRepeat], () => controller?.cycleRepeat());
}

function bindCommand(elements, command) {
  for (const element of elements.filter(Boolean)) {
    element.addEventListener("click", async () => {
      if (!controller) {
        showToast("Connect the Spool player first.");
        return;
      }
      try {
        await command();
      } catch (error) {
        showToast(humanizeError(error));
      }
    });
  }
}

function bindSeekSurface(surface) {
  if (!surface) return;
  let dragging = false;
  let previewPosition = 0;

  const preview = (clientX) => {
    const track = surface.querySelector(".seek-track");
    const duration = currentPlayback?.durationMs || 0;
    if (!track || !duration) return 0;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    previewPosition = fraction * duration;
    renderProgress(previewPosition, duration);
    renderImmersive({ ...currentPlayback, positionMs: previewPosition });
    return previewPosition;
  };

  surface.addEventListener("pointerdown", (event) => {
    if (!currentPlayback?.activeDevice || !currentPlayback.durationMs) return;
    dragging = true;
    surface.setPointerCapture(event.pointerId);
    preview(event.clientX);
    event.preventDefault();
  });
  surface.addEventListener("pointermove", (event) => {
    if (dragging) preview(event.clientX);
  });
  surface.addEventListener("pointerup", async (event) => {
    if (!dragging) return;
    dragging = false;
    preview(event.clientX);
    try {
      await controller?.seek(previewPosition);
    } catch (error) {
      renderPlayback(currentPlayback);
      showToast(humanizeError(error));
    }
  });
  surface.addEventListener("keydown", async (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (!controller || !currentPlayback?.durationMs) return;
    event.preventDefault();
    const delta = event.shiftKey ? 15_000 : 5_000;
    const position = event.key === "Home"
      ? 0
      : event.key === "End"
        ? currentPlayback.durationMs
        : currentPlayback.positionMs + (event.key === "ArrowRight" ? delta : -delta);
    try {
      await controller.seek(position);
    } catch (error) {
      showToast(humanizeError(error));
    }
  });
}

function bindDock() {
  getElements().dockQueue?.addEventListener("click", () => {
    queueVisible = !queueVisible;
    setQueueVisible(queueVisible);
    saveUiPreferences();
    if (queueVisible) controller?.refreshQueue?.().catch(() => {});
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", async (event) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey && event.shiftKey && event.code === "KeyH") {
      event.preventDefault();
      if (config?.mock || auth?.hasSession()) toggleHiddenMode({ userInitiated: true });
      else showToast("Finish setup before using hidden mode.");
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (document.body.classList.contains("hidden-mode")) return;

    if (event.code === "Space") {
      event.preventDefault();
      await runKeyboardCommand(() => controller?.togglePlay());
    } else if (event.code === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      await runKeyboardCommand(() => controller?.next());
    } else if (event.code === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      await runKeyboardCommand(() => controller?.previous());
    } else if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      const delta = event.code === "ArrowRight" ? 5_000 : -5_000;
      await runKeyboardCommand(() => controller?.seek((currentPlayback?.positionMs || 0) + delta));
    } else if (event.code === "ArrowUp" || event.code === "ArrowDown") {
      event.preventDefault();
      explainInactiveFeature(event.shiftKey ? "Playback speed" : "Spotify volume control");
    } else if (event.code === "KeyQ") {
      queueVisible = !queueVisible;
      setQueueVisible(queueVisible);
      saveUiPreferences();
      if (queueVisible) controller?.refreshQueue?.().catch(() => {});
    } else if (event.code === "KeyL") {
      lyricsVisible = !lyricsVisible;
      setLyricsVisible(lyricsVisible);
      saveUiPreferences();
      if (lyricsVisible) showToast("Lyrics are not connected yet.");
    } else if (event.code === "KeyF") {
      toggleImmersive();
    } else if (event.code === "KeyO") {
      dockVisible = !dockVisible;
      setDockVisible(dockVisible);
      saveUiPreferences();
    } else if (event.code === "KeyH" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (config?.mock || auth?.hasSession()) toggleHiddenMode({ userInitiated: true });
      else showToast("Finish setup before using hidden mode.");
    } else if (event.code === "KeyA") {
      openModal("modal-import");
    } else if (event.code === "Tab" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openModal("modal-library");
    } else if (event.code === "KeyS") {
      openModal(event.shiftKey ? "modal-eq" : "modal-settings");
    } else if (event.key === "Escape") {
      if (isImmersiveOpen()) closeImmersive();
      else if (isModalOpen()) closeModals();
    }
  });
}

async function runKeyboardCommand(command) {
  if (!controller || !currentPlayback?.activeDevice) {
    showToast("Use Spool as the active Spotify device first.");
    return;
  }
  try {
    await command();
  } catch (error) {
    showToast(humanizeError(error));
  }
}

function reconcilePlayback() {
  if (!controller || connectionState === "logged-out" || connectionState === "not-configured") return;
  controller.refreshState?.().catch(() => {});
  if (queueVisible) controller.refreshQueue?.().catch(() => {});
}

function showSetupHelp() {
  openModal("modal-settings");
  showToast("Copy config.example.js to config.local.js, then add only your Spotify Client ID.", { duration: 5200 });
}

function readUiPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiPreferences() {
  try {
    localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({
      queueVisible,
      dockVisible,
      lyricsVisible,
    }));
  } catch {}
}

function humanizeError(error) {
  if (!error) return "Spotify is temporarily unavailable.";
  if (error instanceof SpotifyApiError) {
    if (error.reason === "QUOTA_EXCEEDED") return "This Spotify app has reached its Development Mode quota.";
    if (error.status === 429) return "Spotify is rate limiting requests. Try again after the indicated delay.";
    if (error.status === 403) return "Spotify denied access. Check Premium and the app's user allowlist.";
    if (error.status === 401) return "Spotify authorization expired. Log in again.";
  }
  if (error instanceof SpotifyAuthError) {
    if (error.code === "access_denied") return "Spotify authorization was denied.";
    if (error.code === "invalid_state") {
      if (error.details?.reason === "missing_transaction") {
        return "Spotify returned, but this tab lost the temporary login verifier. Close other Spool tabs, reload, and try again.";
      }
      if (error.details?.reason === "state_mismatch") {
        return "Spotify returned a different login state. Close other Spool tabs, reload, and try again.";
      }
      return "Spotify sign-in returned without its verification state. Please reload and try again.";
    }
    if (isAuthorizationExpired(error)) return "Spotify authorization expired. Log in again.";
  }
  if (navigator.onLine === false) return "The network is offline.";
  return error.message || "Spotify is temporarily unavailable.";
}

function isAuthorizationExpired(error) {
  return [
    "authorization_required",
    "authentication_error",
    "invalid_grant",
    "refresh_token_expired",
  ].includes(error?.code || error?.type);
}

function safeDiagnostic(error, operation) {
  return {
    name: error?.name || "Error",
    code: error?.code,
    status: error?.status,
    reason: error?.reason,
    authReason: error?.details?.reason,
    pendingTransactions: error?.details?.pendingTransactionCount,
    operation,
    message: error?.message,
  };
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select") || target.isContentEditable
  );
}
