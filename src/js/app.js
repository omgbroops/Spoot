import {
  isMockMode,
  loadConfig,
  validateDevelopmentOrigin,
} from "./config.js";
import {
  SpotifyAuth,
  SpotifyAuthError,
  shouldReloadOAuthPageAfterBfcacheRestore,
} from "./auth/spotify-auth.js?v=20260723-library1";
import { createOAuthTransactionStorage } from "./auth/transaction-storage.js?v=20260723-library1";
import { DEFAULT_TOKEN_STORAGE_KEY } from "./auth/token-store.js";
import { SpotifyApiClient, SpotifyApiError } from "./spotify/api-client.js";
import { SpotifyPlaybackSdk } from "./spotify/playback-sdk.js";
import { PlaybackController } from "./spotify/playback-controller.js";
import { SpotifyQueueService } from "./spotify/queue-service.js";
import { SpotifyLibraryService } from "./spotify/library-service.js";
import { MockPlaybackController } from "./mock/mock-playback-controller.js";
import { MockLibraryService } from "./mock/mock-library-service.js";
import { getElements } from "./ui/elements.js";
import {
  renderNowPlaying,
  renderPlaybackControls,
  renderProgress,
  setPlaybackControlsEnabled,
} from "./ui/now-playing.js";
import { renderQueue, renderQueueUnavailable, setupQueue } from "./ui/queue.js";
import {
  renderLibraryDetail,
  renderLibrarySources,
  setupLibrary,
} from "./ui/library.js";
import { renderDevicePicker, setupDevicePicker } from "./ui/device-picker.js";
import {
  renderMediaSession,
  setMediaSessionPreferences,
  setupMediaSession,
  updateMediaSessionPosition,
} from "./ui/media-session.js";
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
const OAUTH_CHANNEL_NAME = "spool:oauth";
const OAUTH_COMPLETE_MESSAGE = "spool:oauth-complete";
const OAUTH_CALLBACK_MESSAGE = "spool:oauth-callback";
const OAUTH_RESULT_MESSAGE = "spool:oauth-result";
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
let libraryService;
let connectionState = "not-configured";
let currentPlayback = null;
let currentQueue = null;
let currentDevices = [];
let currentVolume = 1;
let librarySources = [];
let selectedLibrarySource = null;
let selectedLibraryItems = [];
let selectedLibraryNextOffset = null;
let controllerUnsubscribers = [];
let queueVisible = true;
let dockVisible = true;
let lyricsVisible = false;
let mediaSessionEnabled = true;
let headphoneSkipEnabled = false;
let oauthPopup;
let oauthCallbackInFlightState;
let pendingOAuthCallback;
const oauthChannel = createOAuthChannel();

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
  if (event.origin !== location.origin) return;
  if (event.data?.type === OAUTH_CALLBACK_MESSAGE) {
    handleOAuthCallbackMessage(event.data, event.source);
    return;
  }
  if (event.data?.type === OAUTH_RESULT_MESSAGE) {
    handleOAuthResultMessage(event.data);
    return;
  }
  if (event.data?.type === OAUTH_COMPLETE_MESSAGE) {
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
  removeLegacyOAuthQuery();
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
    if (forwardOAuthCallback()) return;
    try {
      await auth.handleCallback();
      showToast("Spotify connected.");
      if (notifyOAuthOpener()) return;
    } catch (error) {
      renderOAuthCallbackFailure(error);
      return;
    }
  }

  if (!auth.hasSession()) {
    renderLoggedOut();
    return;
  }

  if (!auth.hasGrantedScopes(config.scopes)) {
    auth.logout();
    renderLoggedOut();
    renderConnection("logged-out", {
      message: "Spool added library permissions. Log in once more to approve the update.",
    });
    return;
  }

  createLiveController();
  await connectPlayer();
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
  mediaSessionEnabled = preferences.mediaSessionEnabled !== false;
  headphoneSkipEnabled = Boolean(preferences.headphoneSkipEnabled);
  setQueueVisible(queueVisible);
  setDockVisible(dockVisible);
  setLyricsVisible(lyricsVisible);
  setHiddenMode(false);
  setMediaSessionPreferences({
    enabled: mediaSessionEnabled,
    headphoneSkip: headphoneSkipEnabled,
  });

  renderNowPlaying({ emptyMessage: "Connect Spotify to start" });
  renderImmersive({ emptyMessage: "Connect Spotify to start" });
  renderQueue({ status: "disconnected" });
  setPlaybackControlsEnabled(false, "Connect the Spool player first");

  bindPlaybackButtons();
  setupQueue({ onPlay: playTrackNow });
  setupDevicePicker({
    onOpen: refreshDevices,
    onSelect: transferToDevice,
  });
  setupLibrary({
    onSelectSource: openLibrarySource,
    onPlay: playTrackNow,
    onBack: showLibrarySources,
    onLoadMore: loadMoreLibraryItems,
    onRefresh: () => refreshLibrary({ force: true }),
  });
  setupMediaSession({
    onPlay: () => currentPlayback?.paused && runMediaCommand(() => controller?.togglePlay()),
    onPause: () => currentPlayback?.isPlaying && runMediaCommand(() => controller?.togglePlay()),
    onSeek: (position) => runMediaCommand(() => controller?.seek(position * 1000)),
    onPrevious: () => runMediaCommand(() => controller?.previous()),
    onNext: () => runMediaCommand(() => controller?.next()),
  });
  bindVolume();
  bindMediaSettings();
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
  document.addEventListener("spool:modal-open", ({ detail }) => {
    if (detail?.id === "modal-library") refreshLibrary();
    if (detail?.id === "modal-settings") refreshDevices();
    if (detail?.id === "modal-eq") controller?.refreshVolume?.().catch(() => {});
  });
}

async function initializeMockMode() {
  const requested = new URL(location.href).searchParams.get("scenario") || "default";
  const scenario = MOCK_SCENARIOS.has(requested) ? requested : "default";
  controller = new MockPlaybackController({ scenario });
  libraryService = new MockLibraryService();
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
      hidden: true,
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
  libraryService = new SpotifyLibraryService({ apiClient });
  controller = new PlaybackController({ apiClient, sdk, queueService });
  bindController(controller);
}

function bindController(nextController) {
  controllerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  controllerUnsubscribers = [
    nextController.on("connection", (status) => {
      connectionState = status.state;
      if (["active", "player-ready"].includes(status.state)) {
        renderSteadyConnection(status);
      } else {
        renderConnection(status.state, status);
      }
      renderSettings(status);
    }),
    nextController.on("state", (playback) => {
      currentPlayback = playback;
      renderPlayback(playback);
      renderSteadyConnection();
      renderSettings();
    }),
    nextController.on("progress", (positionMs) => {
      if (!currentPlayback) return;
      currentPlayback = { ...currentPlayback, positionMs };
      renderProgress(positionMs, currentPlayback.durationMs);
      renderImmersive({ ...currentPlayback, positionMs });
      updateMediaSessionPosition(positionMs, currentPlayback.durationMs);
    }),
    nextController.on("queue", (queue) => {
      currentQueue = queue;
      renderQueue(queue);
    }),
    nextController.on("devices", (devices) => {
      currentDevices = devices;
      renderSettings();
    }),
    nextController.on("volume", (volume) => {
      currentVolume = volume;
      renderVolume();
    }),
    nextController.on("notice", ({ message }) => showToast(message)),
    nextController.on("null-state", ({ message }) => {
      showToast(message);
      renderNowPlaying({ emptyMessage: "No active Spotify playback" });
      renderImmersive({ emptyMessage: "No active Spotify playback" });
    }),
    nextController.on("error", ({ message, error, operation, type }) => {
      const diagnosticError = error || {
        name: "SpotifySdkError",
        code: type,
        message,
      };
      console.warn(
        "Spotify operation failed.",
        safeDiagnostic(diagnosticError, operation || type),
      );
      if (operation !== "refresh-devices") {
        showToast(message || humanizeError(error));
      }
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
  renderMediaSession(playback);

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

function renderSteadyConnection(status = {}) {
  if (!(config?.mock || auth?.hasSession())) return;
  if (currentPlayback?.activeDevice && controller?.deviceId) {
    renderConnection("active", { hidden: true });
    return;
  }

  const externalDevice = currentPlayback?.device?.isActive
    ? currentPlayback.device
    : null;
  if (externalDevice && externalDevice.id !== controller?.deviceId) {
    const name = externalDevice.name?.trim();
    renderConnection("external-device", {
      title: name ? `Listening on ${name}` : "Listening on another device",
      message: "Spotify is playing somewhere else.",
      primaryLabel: "Listen here",
      primaryDisabled: !controller?.deviceId,
      onPrimary: transferHere,
    });
    return;
  }

  renderConnection(controller?.deviceId ? "player-ready" : "logged-in", {
    title: controller?.deviceId ? "No active Spotify device" : "Spotify connected",
    message: controller?.deviceId
      ? "Choose Listen here to start using Spool."
      : status.message || "Preparing the Spool browser player…",
    primaryLabel: controller?.deviceId ? "Listen here" : "Connecting…",
    primaryDisabled: !controller?.deviceId,
    onPrimary: transferHere,
  });
}

function renderLoggedOut() {
  currentPlayback = null;
  currentQueue = null;
  currentDevices = [];
  librarySources = [];
  selectedLibrarySource = null;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  setHiddenMode(false);
  renderConnection("logged-out");
  renderNowPlaying({ emptyMessage: "Log in to Spotify to start" });
  renderImmersive({ emptyMessage: "Log in to Spotify to start" });
  renderQueue({ status: "disconnected" });
  renderMediaSession(null);
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
      ? currentPlayback?.activeDevice
        ? "Spool is the active device"
        : currentPlayback?.device?.isActive
          ? `Listening on ${currentPlayback.device.name || "another device"}`
          : "Spool device ready"
      : status.message || "Spool device unavailable",
    transfer: {
      label: "Listen here",
      onClick: transferHere,
      hidden: !loggedIn || !controller?.deviceId || Boolean(currentPlayback?.activeDevice),
      disabled: connectionState === "transferring-playback",
    },
    onConnect: login,
    onTransfer: transferHere,
    onDisconnect: logout,
  });
  renderDevicePicker({
    devices: currentDevices,
    activeDeviceId: currentPlayback?.device?.isActive ? currentPlayback.device.id : null,
    activeDeviceName: currentPlayback?.device?.isActive ? currentPlayback.device.name : null,
    spoolDeviceId: controller?.deviceId ?? null,
    loading: connectionState === "loading-sdk" || connectionState === "connecting-player",
    loggedIn,
  });
  renderPreferenceToggle(getElements().mediaToggle, mediaSessionEnabled);
  renderPreferenceToggle(getElements().headphoneSkipToggle, headphoneSkipEnabled);
  renderVolume();
}

async function handlePrimaryAction() {
  if (connectionState === "not-configured") return showSetupHelp();
  if (connectionState === "logged-out" || connectionState === "authorization-expired") return login();
  if (connectionState === "logged-in") return connectPlayer();
  if (connectionState === "player-ready" || connectionState === "external-device") return transferHere();
  if (connectionState === "temporarily-unavailable" || connectionState === "error") {
    if (pendingOAuthCallback) return retryPendingOAuthCallback();
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
  pendingOAuthCallback = undefined;
  oauthPopup = window.open(
    "about:blank",
    OAUTH_POPUP_NAME,
    "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes",
  );
  if (!oauthPopup) {
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
      // Keep the auth instance that created the verifier alive in this tab.
      navigate: (url) => oauthPopup.location.replace(url),
    });
    oauthPopup.focus();
  } catch (error) {
    oauthPopup.close();
    oauthPopup = undefined;
    renderConnection("error", { message: humanizeError(error) });
  }
}

async function handleOAuthCallbackMessage(data, source = null) {
  if (!auth) return;
  if (source && oauthPopup && source !== oauthPopup) return;

  let callbackUrl;
  try {
    callbackUrl = new URL(data?.url);
    if (callbackUrl.origin !== location.origin) return;
  } catch {
    return;
  }

  const callbackState = callbackUrl.searchParams.get("state");
  const ownsTransaction = Boolean(
    callbackState && auth.readTransaction(callbackState),
  );
  // Broadcasts reach every open Spool tab. Only the tab whose sessionStorage
  // owns this state may exchange it. A direct popup message can still surface
  // a precise missing-transaction error instead of hanging silently.
  if (!ownsTransaction && !source) return;
  const inFlightKey = callbackState || "missing-callback-state";
  if (oauthCallbackInFlightState === inFlightKey) return;
  oauthCallbackInFlightState = inFlightKey;

  renderConnection("authorizing", {
    message: "Finishing Spotify sign-in…",
  });
  try {
    await auth.handleCallback({ url: callbackUrl.href, cleanup: false });
    if (!auth.hasGrantedScopes(config.scopes)) {
      auth.logout();
      throw new SpotifyAuthError(
        "Spotify did not grant every permission required by Spool.",
        { code: "insufficient_scope" },
      );
    }
    pendingOAuthCallback = undefined;
    completeOAuthOnOriginalTab();
    postOAuthResult(source, { ok: true, state: callbackState });
  } catch (error) {
    pendingOAuthCallback = error?.code === "token_network_error"
      ? { url: callbackUrl.href, state: callbackState }
      : undefined;
    renderOAuthCallbackFailure(error);
    postOAuthResult(source, {
      ok: false,
      state: callbackState,
      message: humanizeError(error),
      close: true,
    });
  } finally {
    oauthPopup = undefined;
    if (oauthCallbackInFlightState === inFlightKey) {
      oauthCallbackInFlightState = undefined;
    }
  }
}

function retryPendingOAuthCallback() {
  if (!pendingOAuthCallback) return login();
  return handleOAuthCallbackMessage({ url: pendingOAuthCallback.url });
}

function postOAuthResult(target, result) {
  const message = { type: OAUTH_RESULT_MESSAGE, ...result };
  try {
    target?.postMessage(message, location.origin);
  } catch {
    // The exchange result remains authoritative if the popup was closed early.
  }
  try {
    oauthChannel?.postMessage(message);
  } catch {}
}

function forwardOAuthCallback() {
  const message = { type: OAUTH_CALLBACK_MESSAGE, url: location.href };
  let forwarded = false;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(message, location.origin);
      forwarded = true;
    }
  } catch {}
  try {
    if (oauthChannel) {
      oauthChannel.postMessage(message);
      forwarded = true;
    }
  } catch {}
  return forwarded;
}

function handleOAuthResultMessage(message) {
  const callbackState = new URL(location.href).searchParams.get("state");
  if (!callbackState || message.state !== callbackState) return;
  if (message.ok) {
    window.close();
    return;
  }
  renderConnection("error", {
    message: typeof message.message === "string"
      ? message.message
      : "Spotify sign-in could not be completed. Please try again.",
  });
  if (message.close) window.close();
}

function createOAuthChannel() {
  try {
    if (typeof BroadcastChannel !== "function") return null;
    const channel = new BroadcastChannel(OAUTH_CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      if (event.data?.type === OAUTH_CALLBACK_MESSAGE) {
        handleOAuthCallbackMessage(event.data);
      } else if (event.data?.type === OAUTH_RESULT_MESSAGE) {
        handleOAuthResultMessage(event.data);
      }
    });
    return channel;
  } catch {
    return null;
  }
}

function renderOAuthCallbackFailure(error) {
  console.warn(
    "Spotify authorization callback failed.",
    safeDiagnostic(error, "oauth-callback"),
  );
  const state = isAuthorizationExpired(error) ? "authorization-expired" : "error";
  renderConnection(state, { message: humanizeError(error) });
  renderSpotifySettings({ loggedIn: false, onConnect: login });
}

function completeOAuthOnOriginalTab() {
  if (
    !auth?.hasSession() ||
    !auth.hasGrantedScopes(config?.scopes ?? [])
  ) return;
  if (!controller) createLiveController();
  connectPlayer();
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
    await Promise.allSettled([
      controller.refreshState?.(),
      controller.refreshQueue?.(),
      controller.refreshDevices?.(),
      controller.refreshVolume?.(),
    ]);
    renderSteadyConnection();
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
    renderSteadyConnection();
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
  libraryService = undefined;
  auth?.logout();
  renderLoggedOut();
  showToast("Spotify disconnected.");
}

async function refreshDevices() {
  if (!controller?.refreshDevices) return;
  try {
    await controller.refreshDevices();
  } catch {
    renderSettings({ message: "Spotify devices are temporarily unavailable." });
  }
}

async function transferToDevice(deviceId) {
  if (!controller?.transferToDevice) return;
  try {
    await controller.transferToDevice(deviceId);
    renderSteadyConnection();
    showToast(deviceId === controller.deviceId ? "Listening through Spool." : "Spotify device changed.");
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function playTrackNow(uri) {
  if (!controller?.playNow) {
    showToast("Wait for the Spool browser player to connect.");
    return;
  }
  try {
    await controller.playNow(uri);
    renderSteadyConnection();
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function refreshLibrary({ force = false } = {}) {
  if (!libraryService) {
    renderLibrarySources({
      status: "error",
      message: "Log in to Spotify to open your Library.",
    });
    return;
  }
  if (librarySources.length && !force) {
    if (selectedLibrarySource) {
      renderSelectedLibrary();
    } else {
      showLibrarySources();
    }
    return;
  }

  selectedLibrarySource = null;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  renderLibrarySources({ status: "loading" });
  try {
    librarySources = await libraryService.loadSources({ force });
    showLibrarySources();
  } catch (error) {
    console.warn("Spotify library failed to load.", safeDiagnostic(error, "library-sources"));
    renderLibrarySources({ status: "error", message: humanizeLibraryError(error) });
  }
}

function showLibrarySources() {
  selectedLibrarySource = null;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  renderLibrarySources({ sources: librarySources });
}

async function openLibrarySource(sourceId) {
  const source = librarySources.find((candidate) => candidate.id === sourceId);
  if (!source?.canBrowse) return;
  selectedLibrarySource = source;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  renderLibraryDetail({ source, status: "loading", total: source.total });
  try {
    const page = await libraryService.loadSourcePage(source, { offset: 0 });
    if (selectedLibrarySource?.id !== source.id) return;
    selectedLibraryItems = page.items;
    selectedLibraryNextOffset = page.nextOffset;
    renderLibraryDetail({
      source,
      items: selectedLibraryItems,
      total: page.total,
      nextOffset: page.nextOffset,
      message: page.unavailableReason,
    });
  } catch (error) {
    console.warn("Spotify library source failed to load.", safeDiagnostic(error, "library-items"));
    renderLibraryDetail({
      source,
      status: "error",
      total: source.total,
      message: humanizeLibraryError(error),
    });
  }
}

async function loadMoreLibraryItems() {
  if (!selectedLibrarySource || selectedLibraryNextOffset === null) return;
  const source = selectedLibrarySource;
  const offset = selectedLibraryNextOffset;
  selectedLibraryNextOffset = null;
  renderSelectedLibrary();
  try {
    const page = await libraryService.loadSourcePage(source, { offset });
    if (selectedLibrarySource?.id !== source.id) return;
    selectedLibraryItems = [...selectedLibraryItems, ...page.items];
    selectedLibraryNextOffset = page.nextOffset;
    renderLibraryDetail({
      source,
      items: selectedLibraryItems,
      total: page.total,
      nextOffset: page.nextOffset,
      message: page.unavailableReason,
    });
  } catch (error) {
    selectedLibraryNextOffset = offset;
    showToast(humanizeLibraryError(error));
    renderSelectedLibrary();
  }
}

function renderSelectedLibrary() {
  if (!selectedLibrarySource) return showLibrarySources();
  renderLibraryDetail({
    source: selectedLibrarySource,
    items: selectedLibraryItems,
    total: selectedLibrarySource.total,
    nextOffset: selectedLibraryNextOffset,
    message: selectedLibrarySource.canBrowse
      ? null
      : selectedLibrarySource.unavailableReason,
  });
}

function bindVolume() {
  const range = getElements().volumeRange;
  if (!range) return;
  let timer;
  range.addEventListener("input", () => {
    currentVolume = Number(range.value);
    renderVolume();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await controller?.setVolume?.(currentVolume);
      } catch (error) {
        showToast(humanizeError(error));
        controller?.refreshVolume?.().catch(() => {});
      }
    }, 70);
  });
}

function renderVolume() {
  const { volumeRange, volumeValue } = getElements();
  if (!volumeRange || !volumeValue) return;
  const volume = Math.min(1, Math.max(0, Number(currentVolume) || 0));
  volumeRange.value = String(volume);
  volumeRange.disabled = !controller?.deviceId;
  volumeValue.textContent = `${Math.round(volume * 100)}%`;
}

function bindMediaSettings() {
  getElements().mediaToggle?.addEventListener("click", () => {
    mediaSessionEnabled = !mediaSessionEnabled;
    updateMediaPreferences();
  });
  getElements().headphoneSkipToggle?.addEventListener("click", () => {
    headphoneSkipEnabled = !headphoneSkipEnabled;
    updateMediaPreferences();
  });
}

function updateMediaPreferences() {
  setMediaSessionPreferences({
    enabled: mediaSessionEnabled,
    headphoneSkip: headphoneSkipEnabled,
  });
  renderMediaSession(currentPlayback);
  renderSettings();
  saveUiPreferences();
}

function renderPreferenceToggle(toggle, active) {
  if (!toggle) return;
  toggle.classList.toggle("on", Boolean(active));
  toggle.setAttribute("aria-checked", String(Boolean(active)));
}

async function runMediaCommand(command) {
  if (!controller || !currentPlayback?.activeDevice) return;
  try {
    await command();
  } catch (error) {
    showToast(humanizeError(error));
  }
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
      if (event.shiftKey) {
        explainInactiveFeature("Playback speed");
      } else {
        const delta = event.code === "ArrowUp" ? 0.05 : -0.05;
        await runKeyboardCommand(() => controller?.setVolume(
          Math.min(1, Math.max(0, currentVolume + delta)),
        ));
      }
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
  if (
    !controller ||
    ["logged-out", "not-configured", "authorization-expired", "error"].includes(connectionState)
  ) return;
  if (!controller.deviceId) controller.connect?.().catch(() => {});
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
      mediaSessionEnabled,
      headphoneSkipEnabled,
    }));
  } catch {}
}

function removeLegacyOAuthQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has("oauth") || url.searchParams.has("code") || url.searchParams.has("error")) return;
  url.searchParams.delete("oauth");
  history.replaceState(history.state, "", url);
}

function humanizeLibraryError(error) {
  if (error instanceof SpotifyApiError && error.status === 403) {
    return "Spotify returned this playlist's metadata but does not allow this app to read its songs.";
  }
  if (error instanceof SpotifyApiError && error.status === 429) {
    return "Spotify is rate limiting Library requests. Try again shortly.";
  }
  return humanizeError(error);
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
    if (error.code === "insufficient_scope") {
      return "Spotify did not grant every permission Spool needs. Log in and approve all requested access.";
    }
    if (error.code === "invalid_state") {
      if (error.details?.reason === "missing_transaction") {
        return "Spotify returned, but this tab lost the temporary login verifier. Close other Spool tabs, reload, and try again.";
      }
      if (error.details?.reason === "state_mismatch") {
        return "Spotify returned a different login state. Close other Spool tabs, reload, and try again.";
      }
      return "Spotify sign-in returned without its verification state. Please reload and try again.";
    }
    if (error.code === "token_network_error") {
      return "The browser blocked Spotify's token request. Your login verifier was kept; press Retry after allowing accounts.spotify.com.";
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
    transport: error?.details?.transport,
    fetchFailure: error?.details?.fetchFailure,
    xhrFailure: error?.details?.xhrFailure,
    cause: error?.cause
      ? {
          name: error.cause.name || "Error",
          message: error.cause.message || "Unknown failure.",
        }
      : undefined,
    operation,
    message: error?.message,
  };
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select") || target.isContentEditable
  );
}
