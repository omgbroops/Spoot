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
import {
  AUDIO_EQ_BANDS,
  AUDIO_EQ_PRESETS,
  createAudioEffectsController,
} from "./audio/audio-effects.js";
import { SpotifyApiClient, SpotifyApiError } from "./spotify/api-client.js";
import { SpotifyPlaybackSdk } from "./spotify/playback-sdk.js";
import { PlaybackController } from "./spotify/playback-controller.js";
import { SpotifyQueueService } from "./spotify/queue-service.js";
import { SpotifyLibraryService } from "./spotify/library-service.js";
import { SpotifySearchService } from "./spotify/search-service.js";
import { SpotifyAlbumService } from "./spotify/album-service.js";
import { LyricsService } from "./lyrics/lyrics-service.js";
import { MockPlaybackController } from "./mock/mock-playback-controller.js";
import { MockLibraryService } from "./mock/mock-library-service.js";
import { MockSearchService } from "./mock/mock-search-service.js";
import { MockAlbumService } from "./mock/mock-album-service.js";
import { MockLyricsService } from "./mock/mock-lyrics-service.js";
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
import { focusSearch, renderSearch, setupSearch } from "./ui/search.js";
import { renderAlbum, setupAlbum } from "./ui/album.js";
import { renderLyrics, setupLyrics, updateLyricsPosition } from "./ui/lyrics.js";
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
let searchService;
let albumService;
let lyricsService;
let connectionState = "not-configured";
let currentPlayback = null;
let currentQueue = null;
let currentDevices = [];
let currentVolume = 1;
let librarySources = [];
let selectedLibrarySource = null;
let selectedLibraryItems = [];
let selectedLibraryNextOffset = null;
let selectedLibraryDurationMs = null;
let controllerUnsubscribers = [];
let queueVisible = true;
let dockVisible = true;
let lyricsVisible = false;
let mediaSessionEnabled = true;
let headphoneSkipEnabled = false;
let ambientAudioReaction = false;
let soundSettings = {
  speed: 1,
  reverb: 0,
  eq: AUDIO_EQ_PRESETS.Flat.slice(),
  eqPreset: "Flat",
};
let oauthPopup;
let oauthCallbackInFlightState;
let pendingOAuthCallback;
let searchAbortController;
let libraryAbortController;
let albumAbortController;
let lyricsAbortController;
let currentLyricsTrackKey;
const oauthChannel = createOAuthChannel();
const audioEffects = createAudioEffectsController({
  onCaptureChange: () => renderSoundSettings(),
});
let ambientFrame = 0;
let ambientSmoothBass = 0;
let ambientLastPaint = 0;
let preferenceSaveTimer;

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
  audioEffects.install();
  setupToast();
  setupModals();
  setupInactiveFeatures();
  setupWidgets();
  setupImmersive();
  setupLyrics({
    onSeek: (positionMs) => runMediaCommand(() => controller?.seek(positionMs)),
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
  soundSettings = normalizeSoundPreferences(preferences.sound);
  ambientAudioReaction = Boolean(preferences.ambientAudioReaction);
  applySoundSettings();
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
  renderLyrics({ status: "disconnected" });
  renderQueue({ status: "disconnected" });
  setPlaybackControlsEnabled(false, "Connect the Spool player first");

  bindPlaybackButtons();
  setupQueue({ onPlay: playQueueItem });
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
  setupAlbum({
    onPlay: playTrackNow,
    onBack: returnToSearch,
  });
  setupSearch({
    onQuery: searchSpotify,
    onPlay: playTrackNow,
    onOpenAlbum: openAlbumPage,
  });
  setupMediaSession({
    onPlay: () => currentPlayback?.paused && runMediaCommand(() => controller?.togglePlay()),
    onPause: () => currentPlayback?.isPlaying && runMediaCommand(() => controller?.togglePlay()),
    onSeek: (position) => runMediaCommand(() => controller?.seek(position * 1000)),
    onPrevious: () => runMediaCommand(() => controller?.previous()),
    onNext: () => runMediaCommand(() => controller?.next()),
  });
  bindVolume();
  bindSoundSettings();
  bindMediaSettings();
  bindSeekSurface(getElements().seek);
  bindSeekSurface(getElements().immersiveSeek);
  bindDock();
  bindKeyboard();
  renderSoundSettings();
  updateAmbientLoop();

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
    if (detail?.id === "modal-search") focusSearch();
    if (detail?.id === "modal-settings") refreshDevices();
    if (detail?.id === "modal-eq") controller?.refreshVolume?.().catch(() => {});
  });
  document.addEventListener("spool:modal-close", ({ detail }) => {
    if (detail?.id === "modal-library" && cancelLibraryRequest()) {
      selectedLibrarySource = null;
      selectedLibraryItems = [];
      selectedLibraryNextOffset = null;
      selectedLibraryDurationMs = null;
    }
    if (detail?.id === "modal-search") {
      searchAbortController?.abort();
      searchAbortController = undefined;
    }
    if (detail?.id === "modal-album") {
      albumAbortController?.abort();
      albumAbortController = undefined;
    }
  });
}

async function initializeMockMode() {
  const requested = new URL(location.href).searchParams.get("scenario") || "default";
  const scenario = MOCK_SCENARIOS.has(requested) ? requested : "default";
  controller = new MockPlaybackController({ scenario });
  libraryService = new MockLibraryService();
  searchService = new MockSearchService();
  albumService = new MockAlbumService();
  lyricsService = new MockLyricsService();
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
  searchService = new SpotifySearchService({ apiClient });
  albumService = new SpotifyAlbumService({ apiClient });
  lyricsService = new LyricsService({
    onDiagnostic: (diagnostic) => console.debug("Lyrics provider skipped.", diagnostic),
  });
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
      syncLyrics(playback);
      updateLyricsPosition(playback?.positionMs || 0, { instant: true });
      renderSteadyConnection();
      renderSettings();
    }),
    nextController.on("progress", (positionMs) => {
      if (!currentPlayback) return;
      currentPlayback = { ...currentPlayback, positionMs };
      renderProgress(positionMs, currentPlayback.durationMs);
      renderImmersive({ ...currentPlayback, positionMs });
      updateLyricsPosition(positionMs);
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
      resetLyrics("empty");
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
  updateAmbientLoop();
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
  selectedLibraryDurationMs = null;
  cancelLibraryRequest();
  searchAbortController?.abort();
  searchAbortController = undefined;
  albumAbortController?.abort();
  albumAbortController = undefined;
  resetLyrics("disconnected");
  renderSearch();
  renderAlbum();
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
  renderPreferenceToggle(getElements().ambientToggle, ambientAudioReaction);
  renderVolume();
  renderSoundSettings();
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
  searchService = undefined;
  albumService = undefined;
  lyricsService = undefined;
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

async function playTrackNow(selection) {
  if (!controller?.playNow) {
    showToast("Wait for the Spool browser player to connect.");
    return;
  }
  const request = typeof selection === "string" ? { uri: selection } : selection || {};
  try {
    if (request.contextOnly && request.contextUri) {
      await controller.playNow(null, { contextUri: request.contextUri });
    } else if (request.sourceKind === "liked") {
      const playableUris = selectedLibraryItems
        .filter((entry) => entry.playable && entry.uri)
        .map((entry) => entry.uri);
      const selectedIndex = playableUris.indexOf(request.uri);
      const orderedUris = selectedIndex < 0
        ? [request.uri]
        : playableUris.slice(selectedIndex);
      await controller.playNow(request.uri, { uris: orderedUris });
    } else {
      await controller.playNow(request.uri, {
        contextUri: request.contextUri,
        contextPosition: Number.isInteger(request.contextPosition)
          ? request.contextPosition
          : null,
      });
    }
    renderSteadyConnection();
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function searchSpotify(query) {
  const normalizedQuery = String(query || "").trim();
  searchAbortController?.abort();
  searchAbortController = undefined;
  if (!normalizedQuery) {
    renderSearch();
    return;
  }
  if (!searchService) {
    renderSearch({
      status: "error",
      query: normalizedQuery,
      message: "Log in to Spotify to search the catalog.",
    });
    return;
  }

  const request = new AbortController();
  searchAbortController = request;
  renderSearch({ status: "loading", query: normalizedQuery });
  try {
    const results = await searchService.search(normalizedQuery, { signal: request.signal });
    if (searchAbortController !== request) return;
    renderSearch({ status: "ready", query: normalizedQuery, results });
  } catch (error) {
    if (error?.name === "AbortError" || searchAbortController !== request) return;
    console.warn("Spotify search failed.", safeDiagnostic(error, "search"));
    renderSearch({ status: "error", query: normalizedQuery, message: humanizeSearchError(error) });
  } finally {
    if (searchAbortController === request) searchAbortController = undefined;
  }
}

async function openAlbumPage(selection) {
  const albumId = typeof selection === "string" ? selection : selection?.id;
  openModal("modal-album");
  albumAbortController?.abort();
  albumAbortController = undefined;
  if (!albumService || !albumId) {
    renderAlbum({
      status: "error",
      message: albumService
        ? "Spotify did not return a usable album identifier."
        : "Log in to Spotify to open albums.",
    });
    return;
  }

  const request = new AbortController();
  albumAbortController = request;
  renderAlbum({ status: "loading" });
  try {
    const result = await albumService.loadAlbum(albumId, { signal: request.signal });
    if (albumAbortController !== request) return;
    renderAlbum({ status: "ready", result });
  } catch (error) {
    if (error?.name === "AbortError" || albumAbortController !== request) return;
    console.warn("Spotify album failed to load.", safeDiagnostic(error, "album"));
    renderAlbum({ status: "error", message: humanizeAlbumError(error) });
  } finally {
    if (albumAbortController === request) albumAbortController = undefined;
  }
}

function returnToSearch() {
  albumAbortController?.abort();
  albumAbortController = undefined;
  openModal("modal-search");
  focusSearch();
}

async function syncLyrics(playback) {
  const track = playback?.currentItem || playback?.item || null;
  const trackKey = track?.id || track?.uri || null;
  if (!trackKey) {
    resetLyrics("empty");
    return;
  }
  if (trackKey === currentLyricsTrackKey) return;

  lyricsAbortController?.abort();
  lyricsAbortController = undefined;
  currentLyricsTrackKey = trackKey;

  if (track.type && track.type !== "track") {
    renderLyrics({ status: "episode", track });
    return;
  }
  if (!lyricsService) {
    renderLyrics({ status: "disconnected", track });
    return;
  }

  const request = new AbortController();
  lyricsAbortController = request;
  renderLyrics({ status: "loading", track });
  try {
    const lyrics = await lyricsService.getLyrics(track, { signal: request.signal });
    if (lyricsAbortController !== request || currentLyricsTrackKey !== trackKey) return;
    renderLyrics({ status: "ready", lyrics, track });
    updateLyricsPosition(currentPlayback?.positionMs || 0, { instant: true });
  } catch (error) {
    if (error?.name === "AbortError" || lyricsAbortController !== request) return;
    console.debug("Lyrics lookup failed.", safeDiagnostic(error, "lyrics"));
    renderLyrics({ status: "error", track });
  } finally {
    if (lyricsAbortController === request) lyricsAbortController = undefined;
  }
}

function resetLyrics(status = "empty") {
  lyricsAbortController?.abort();
  lyricsAbortController = undefined;
  currentLyricsTrackKey = undefined;
  renderLyrics({ status });
}

async function playQueueItem(selection) {
  if (!controller?.playQueueItem) {
    showToast("Wait for the Spool browser player to connect.");
    return;
  }
  try {
    await controller.playQueueItem(selection);
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
  selectedLibraryDurationMs = null;
  cancelLibraryRequest();
  const request = new AbortController();
  libraryAbortController = request;
  renderLibrarySources({ status: "loading" });
  try {
    librarySources = await libraryService.loadSources({ force, signal: request.signal });
    if (libraryAbortController !== request) return;
    showLibrarySources();
  } catch (error) {
    if (error?.name === "AbortError" || libraryAbortController !== request) return;
    console.warn("Spotify library failed to load.", safeDiagnostic(error, "library-sources"));
    renderLibrarySources({ status: "error", message: humanizeLibraryError(error) });
  } finally {
    if (libraryAbortController === request) libraryAbortController = undefined;
  }
}

function showLibrarySources() {
  cancelLibraryRequest();
  selectedLibrarySource = null;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  selectedLibraryDurationMs = null;
  renderLibrarySources({ sources: librarySources });
}

async function openLibrarySource(sourceId) {
  const source = librarySources.find((candidate) => candidate.id === sourceId);
  if (!source?.canBrowse) return;
  selectedLibrarySource = source;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  selectedLibraryDurationMs = null;
  cancelLibraryRequest();
  const request = new AbortController();
  libraryAbortController = request;
  renderLibraryDetail({ source, status: "loading", total: source.total });
  try {
    const loadSource = libraryService.loadSource?.bind(libraryService);
    const page = loadSource
      ? await loadSource(source, {
          onProgress: (progress) => {
            if (selectedLibrarySource?.id !== source.id) return;
            selectedLibraryItems = progress.items;
            selectedLibraryNextOffset = progress.nextOffset;
            selectedLibraryDurationMs = progress.durationMs;
            renderLibraryDetail({
              source,
              items: selectedLibraryItems,
              total: progress.total,
              durationMs: progress.durationMs,
              complete: progress.complete,
              nextOffset: null,
              message: progress.unavailableReason,
            });
          },
          signal: request.signal,
        })
      : await libraryService.loadSourcePage(source, { offset: 0, signal: request.signal });
    if (libraryAbortController !== request) return;
    if (selectedLibrarySource?.id !== source.id) return;
    selectedLibraryItems = page.items;
    selectedLibraryNextOffset = page.nextOffset;
    selectedLibraryDurationMs = page.durationMs ?? selectedLibraryDurationMs;
    renderLibraryDetail({
      source,
      items: selectedLibraryItems,
      total: page.total,
      durationMs: selectedLibraryDurationMs,
      complete: page.complete ?? page.nextOffset === null,
      nextOffset: loadSource ? null : page.nextOffset,
      message: page.unavailableReason,
    });
  } catch (error) {
    if (error?.name === "AbortError" || libraryAbortController !== request) return;
    console.warn("Spotify library source failed to load.", safeDiagnostic(error, "library-items"));
    renderLibraryDetail({
      source,
      status: "error",
      total: source.total,
      message: humanizeLibraryError(error),
    });
  } finally {
    if (libraryAbortController === request) libraryAbortController = undefined;
  }
}

function cancelLibraryRequest() {
  const cancelled = Boolean(libraryAbortController);
  libraryAbortController?.abort();
  libraryAbortController = undefined;
  return cancelled;
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
    selectedLibraryDurationMs = selectedLibraryItems.reduce(
      (sum, item) => sum + (Number(item.durationMs) || 0),
      0,
    );
    renderLibraryDetail({
      source,
      items: selectedLibraryItems,
      total: page.total,
      durationMs: selectedLibraryDurationMs,
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
    durationMs: selectedLibraryDurationMs ?? selectedLibrarySource.durationMs ?? null,
    complete: selectedLibraryNextOffset === null,
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

function bindSoundSettings() {
  const elements = getElements();
  elements.speedRange?.addEventListener("input", () => {
    setPlaybackSpeed(Number(elements.speedRange.value));
  });
  elements.reverbRange?.addEventListener("input", () => {
    setReverbAmount(Number(elements.reverbRange.value));
  });
  elements.eqSliders.forEach((slider, index) => {
    slider.addEventListener("input", () => {
      soundSettings.eq[index] = Math.min(12, Math.max(-12, Number(slider.value) || 0));
      soundSettings.eqPreset = presetNameForEq(soundSettings.eq) || "Custom";
      applySoundSettings();
      renderSoundSettings();
      scheduleUiPreferencesSave();
    });
  });
  elements.eqPresets?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) return;
    const preset = button.dataset.preset;
    if (!AUDIO_EQ_PRESETS[preset]) return;
    soundSettings.eq = AUDIO_EQ_PRESETS[preset].slice();
    soundSettings.eqPreset = preset;
    applySoundSettings();
    renderSoundSettings();
    scheduleUiPreferencesSave();
  });
}

function setPlaybackSpeed(speed) {
  soundSettings.speed = Math.min(2.5, Math.max(0.25, Number(speed) || 1));
  applySoundSettings();
  renderSoundSettings();
  scheduleUiPreferencesSave();
}

function setReverbAmount(reverb) {
  soundSettings.reverb = Math.min(1, Math.max(0, Number(reverb) || 0));
  applySoundSettings();
  renderSoundSettings();
  scheduleUiPreferencesSave();
}

function applySoundSettings() {
  audioEffects.setSettings({
    speed: soundSettings.speed,
    reverb: soundSettings.reverb,
    eqEnabled: true,
    eq: soundSettings.eq,
  });
}

function renderSoundSettings() {
  const elements = getElements();
  const speed = Math.min(2.5, Math.max(0.25, Number(soundSettings.speed) || 1));
  const reverb = Math.min(1, Math.max(0, Number(soundSettings.reverb) || 0));

  if (elements.speedRange) elements.speedRange.value = String(speed);
  if (elements.speedValue) elements.speedValue.textContent = `${speed.toFixed(2)}x`;
  if (elements.reverbRange) elements.reverbRange.value = String(reverb);
  if (elements.reverbValue) elements.reverbValue.textContent = `${Math.round(reverb * 100)}%`;
  if (elements.soundCaptureStatus) {
    elements.soundCaptureStatus.textContent = audioEffects.hasCapture()
      ? "Audio output captured"
      : "Audio output not captured yet";
  }
  if (elements.eqValue) {
    elements.eqValue.textContent = soundSettings.eqPreset === "Flat"
      ? "Flat"
      : soundSettings.eqPreset || "Custom";
  }

  elements.eqSliders.forEach((slider, index) => {
    slider.value = String(soundSettings.eq[index] ?? 0);
  });
  elements.eqPresets?.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === soundSettings.eqPreset);
  });
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
  getElements().ambientToggle?.addEventListener("click", () => {
    ambientAudioReaction = !ambientAudioReaction;
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
  updateAmbientLoop();
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
        const delta = event.code === "ArrowUp" ? 0.05 : -0.05;
        setPlaybackSpeed(soundSettings.speed + delta);
        showToast(`Speed ${soundSettings.speed.toFixed(2)}x`);
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
    } else if (event.key === "/") {
      event.preventDefault();
      openModal("modal-search");
      focusSearch();
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

function updateAmbientLoop() {
  const shouldRun = Boolean(
    ambientAudioReaction &&
    currentPlayback?.activeDevice &&
    currentPlayback?.isPlaying,
  );
  if (!shouldRun) {
    if (ambientFrame) cancelAnimationFrame(ambientFrame);
    ambientFrame = 0;
    ambientSmoothBass = 0;
    ambientLastPaint = 0;
    resetAmbientReaction();
    return;
  }
  if (!ambientFrame) ambientFrame = requestAnimationFrame(paintAmbientReaction);
}

function paintAmbientReaction(time) {
  ambientFrame = requestAnimationFrame(paintAmbientReaction);
  if (time - ambientLastPaint < 33) return;
  ambientLastPaint = time;

  const frequencyData = audioEffects.getFrequencyData();
  const bass = frequencyData ? bassLevel(frequencyData) : 0;
  ambientSmoothBass += (bass - ambientSmoothBass) * 0.18;
  renderAmbientReaction(ambientSmoothBass);
}

function renderAmbientReaction(level) {
  const elements = getElements();
  const bass = Math.max(0, Math.min(1, level));
  if (elements.backgroundArt) {
    elements.backgroundArt.style.transform = `scale(${(1.2 + bass * 0.09).toFixed(3)})`;
    elements.backgroundArt.style.filter = `blur(90px) saturate(1.9) brightness(${(0.58 + bass * 0.36).toFixed(3)})`;
  }
  if (elements.immersiveBackground) {
    elements.immersiveBackground.style.transform = `scale(${(1.25 + bass * 0.1).toFixed(3)})`;
    elements.immersiveBackground.style.filter = `blur(80px) saturate(1.9) brightness(${(0.5 + bass * 0.34).toFixed(3)})`;
  }
}

function resetAmbientReaction() {
  const elements = getElements();
  if (elements.backgroundArt) {
    elements.backgroundArt.style.transform = "";
    elements.backgroundArt.style.filter = "";
  }
  if (elements.immersiveBackground) {
    elements.immersiveBackground.style.transform = "";
    elements.immersiveBackground.style.filter = "";
  }
}

function bassLevel(frequencyData) {
  let total = 0;
  const end = Math.min(12, frequencyData.length);
  for (let index = 1; index < end; index += 1) total += frequencyData[index];
  return end > 1 ? total / ((end - 1) * 255) : 0;
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
      ambientAudioReaction,
      sound: {
        speed: soundSettings.speed,
        reverb: soundSettings.reverb,
        eq: soundSettings.eq,
        eqPreset: soundSettings.eqPreset,
      },
    }));
  } catch {}
}

function scheduleUiPreferencesSave() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(saveUiPreferences, 120);
}

function normalizeSoundPreferences(raw = {}) {
  const eq = AUDIO_EQ_BANDS.map((_, index) => {
    const value = Number(raw?.eq?.[index]);
    return Number.isFinite(value) ? Math.min(12, Math.max(-12, value)) : 0;
  });
  const eqPreset = AUDIO_EQ_PRESETS[raw?.eqPreset] && eqMatches(eq, AUDIO_EQ_PRESETS[raw.eqPreset])
    ? raw.eqPreset
    : presetNameForEq(eq) || "Custom";
  return {
    speed: Number.isFinite(Number(raw?.speed)) ? Math.min(2.5, Math.max(0.25, Number(raw.speed))) : 1,
    reverb: Number.isFinite(Number(raw?.reverb)) ? Math.min(1, Math.max(0, Number(raw.reverb))) : 0,
    eq,
    eqPreset,
  };
}

function presetNameForEq(eq) {
  return Object.entries(AUDIO_EQ_PRESETS).find(([, values]) => eqMatches(eq, values))?.[0] || "";
}

function eqMatches(left, right) {
  return AUDIO_EQ_BANDS.every((_, index) => Math.abs((left[index] || 0) - (right[index] || 0)) < 0.01);
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

function humanizeSearchError(error) {
  if (error instanceof SpotifyApiError && error.status === 429) {
    return "Spotify is rate limiting search. Try again shortly.";
  }
  if (error instanceof SpotifyApiError && error.status === 403) {
    return "Spotify did not allow catalog search for this app session.";
  }
  return humanizeError(error);
}

function humanizeAlbumError(error) {
  if (error instanceof SpotifyApiError && error.status === 404) {
    return "Spotify could not find that album.";
  }
  if (error instanceof SpotifyApiError && error.status === 429) {
    return "Spotify is rate limiting album requests. Try again shortly.";
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
