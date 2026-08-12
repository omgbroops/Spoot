import {
  isMockMode,
  loadConfig,
  validateDevelopmentOrigin,
} from "./config.js?v=20260808-port5174";
import {
  SpotifyAuth,
  SpotifyAuthError,
  shouldReloadOAuthPageAfterBfcacheRestore,
} from "./auth/spotify-auth.js?v=20260723-library1";
import { createOAuthTransactionStorage } from "./auth/transaction-storage.js?v=20260723-library1";
import { DEFAULT_TOKEN_STORAGE_KEY } from "./auth/token-store.js";
import { watchOAuthPopup } from "./auth/oauth-popup.js?v=20260812-sandbox-auth";
import {
  AUDIO_EQ_BANDS,
  AUDIO_EQ_PRESETS,
  createAudioEffectsController,
} from "./audio/audio-effects.js?v=20260725-hybrid3";
import { SpotifyApiClient, SpotifyApiError } from "./spotify/api-client.js?v=20260725-hybrid2";
import { SpotifyPlaybackSdk } from "./spotify/playback-sdk.js";
import { PlaybackController } from "./spotify/playback-controller.js?v=20260725-hybrid2";
import { SpotifyQueueService } from "./spotify/queue-service.js";
import { SpotifyLibraryService } from "./spotify/library-service.js?v=20260725-hybrid2";
import { SpotifySearchService } from "./spotify/search-service.js?v=20260725-hybrid2";
import { SpotifyAlbumService } from "./spotify/album-service.js?v=20260725-hybrid2";
import { SpotifyArtistService } from "./spotify/artist-service.js?v=20260725-hybrid2";
import { SpotifyTrackService } from "./spotify/track-service.js?v=20260725-hybrid2";
import { SpotifyPlaylistService } from "./spotify/playlist-service.js?v=20260725-hybrid2";
import { SpotifyPlaylistPickerService } from "./spotify/playlist-picker-service.js?v=20260725-hybrid3";
import { LocalLibraryService, localSource } from "./local/local-library.js?v=20260725-hybrid3";
import {
  HybridPlaylistService,
  hybridUpcomingItems,
  isLocalEntry,
  nextHybridIndex,
  previousHybridIndex,
} from "./local/hybrid-playlist-service.js?v=20260725-hybrid3";
import { LocalPlaybackController, localIdFromUri } from "./local/local-playback-controller.js?v=20260725-hybrid2";
import { DropboxImportService } from "./local/dropbox-service.js?v=20260725-hybrid2";
import { LyricsService, lyricsToText } from "./lyrics/lyrics-service.js?v=20260725-hybrid2";
import { MockPlaybackController } from "./mock/mock-playback-controller.js?v=20260724-command2";
import { MockLibraryService } from "./mock/mock-library-service.js";
import { MockSearchService } from "./mock/mock-search-service.js?v=20260724-command2";
import { MockAlbumService } from "./mock/mock-album-service.js?v=20260724-command2";
import { MockArtistService } from "./mock/mock-artist-service.js?v=20260724-command2";
import { MockTrackService } from "./mock/mock-track-service.js?v=20260724-command2";
import { MockPlaylistService } from "./mock/mock-playlist-service.js?v=20260724-command2";
import { MockLyricsService } from "./mock/mock-lyrics-service.js";
import { getElements } from "./ui/elements.js";
import {
  renderNowPlaying,
  renderPlaybackControls,
  renderProgress,
  setPlaybackControlsEnabled,
} from "./ui/now-playing.js";
import { renderQueue, renderQueueUnavailable, setupQueue } from "./ui/queue.js?v=20260725-hybrid3";
import {
  renderLibraryDetail,
  renderLibrarySources,
  setupLibrary,
} from "./ui/library.js?v=20260725-hybrid3";
import {
  animateSearchContent,
  focusSearch,
  getSearchResultsContainer,
  renderSearch,
  setSearchChrome,
  setupSearch,
} from "./ui/search.js?v=20260725-hybrid2";
import { renderAlbum, setupAlbum } from "./ui/album.js?v=20260725-hybrid2";
import { renderArtist, setupArtist } from "./ui/artist.js?v=20260725-hybrid2";
import { renderTrack, setupTrack } from "./ui/track.js?v=20260725-hybrid3";
import { renderPlaylist, setupPlaylistInteractions } from "./ui/playlist.js?v=20260725-hybrid2";
import {
  addPlaylistPickerSource,
  focusPlaylistPicker,
  renderPlaylistPicker,
  resetPlaylistCreateForm,
  setPlaylistPickerBusy,
  setupPlaylistPicker,
  updatePlaylistPickerMembership,
} from "./ui/playlist-picker.js?v=20260725-hybrid2";
import { setupPlaylistEditor, prepareCreatePlaylist, prepareEditPlaylist, setPlaylistEditorBusy } from "./ui/playlist-editor.js?v=20260725-hybrid2";
import { preparePlaylistCover } from "./spotify/playlist-image.js?v=20260725-hybrid2";
import { setupLyricsEditor, showLyricsEditor, showLyricsResults, deliverLyricsText, updateLyricsSyncPlayback, handleLyricsSyncKey } from "./ui/lyrics-editor.js?v=20260725-hybrid2";
import { renderDropbox, setupDropbox } from "./ui/dropbox.js?v=20260725-hybrid2";
import { renderLyrics, setupLyrics, updateLyricsPosition } from "./ui/lyrics.js?v=20260725-hybrid3";
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
import {
  closeCommandPalette,
  isCommandPaletteOpen,
  openCommandPalette,
  parseSeekArgument,
  setupCommandPalette,
} from "./ui/command-palette.js?v=20260724-command2";

const UI_PREFERENCES_KEY = "spoot.ui.preferences";
const OAUTH_POPUP_NAME = "spoot-spotify-auth";
const OAUTH_CHANNEL_NAME = "spoot:oauth";
const OAUTH_COMPLETE_MESSAGE = "spoot:oauth-complete";
const OAUTH_CALLBACK_MESSAGE = "spoot:oauth-callback";
const OAUTH_RESULT_MESSAGE = "spoot:oauth-result";
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
let controller; // Spotify playback controller
let localController;
let localLibrary;
let hybridService;
let dropboxService;
let playlistPickerService;
let playbackMode = "spotify";
let spotifyPlayback = null;
let spotifyQueue = null;
let spotifyVolume = 1;
let localTracks = [];
let playlistPickerTrack = null;
let playlistPickerCreateOnly = false;
let playlistPickerSources = [];
let playlistPickerMemberships = new Map();
let playlistCreateTrack = null;
let playlistEditTarget = null;
let hybridSession = null;
let hybridTransitioning = false;
let hybridBoundaryTimer = null;
let currentLyrics = null;
let lyricsImportTarget = "editor";
let dropboxBrowseMode = "audio";
let libraryService;
let searchService;
let albumService;
let artistService;
let trackService;
let playlistService;
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
let localControllerUnsubscribers = [];
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
let stopOAuthPopupWatch;
let oauthCallbackInFlightState;
let pendingOAuthCallback;
let searchAbortController;
let catalogAbortController;
let libraryAbortController;
let albumAbortController;
let artistAbortController;
let trackAbortController;
let lyricsAbortController;
let currentLyricsTrackKey;
let albumReturnModal = "modal-search";
let searchView = { kind: "search", status: "idle", query: "", results: null, message: null };
let catalogCurrent = searchView;
let catalogHistory = [];
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
  console.error("Spoot initialization failed.", safeDiagnostic(error));
  renderConnection("error", {
    message: "Spoot could not start. Check the console for a redacted diagnostic.",
  });
  showToast("Spoot could not start.");
});

async function initialize() {
  setupUi();
  await initializeLocalFeatures();
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
      deviceText: `Register ${config.redirectUri} as the redirect URI`,
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
      message: "Spoot added library permissions. Log in once more to approve the update.",
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
    onSeek: (positionMs) => runMediaCommand(() => activeController()?.seek(positionMs)),
    onEdit: openLyricsEditorModal,
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
  setPlaybackControlsEnabled(false, "Connect the Spoot player first");

  bindPlaybackButtons();
  setupQueue({ onPlay: playQueueItem, onAddToPlaylist: openPlaylistPicker });
  setupDevicePicker({
    onOpen: refreshDevices,
    onSelect: transferToDevice,
  });
  setupLibrary({
    onSelectSource: openLibrarySource,
    onPlay: playTrackNow,
    onPlaySource: playTrackNow,
    onAddToPlaylist: openPlaylistPicker,
    onOpenAlbum: (selection) => openCatalogFromLibrary("album", selection),
    onOpenArtist: (selection) => openCatalogFromLibrary("artist", selection),
    onBack: showLibrarySources,
    onLoadMore: loadMoreLibraryItems,
    onRefresh: refreshCurrentLibraryView,
    onEditPlaylist: openEditPlaylistModal,
    onRemovePlaylistItem: removeLibraryPlaylistItem,
    onReorderPlaylistItem: reorderLibraryPlaylistItem,
    onDeleteLocal: deleteLocalTrack,
  });
  // The original standalone detail modals remain functional for compatibility,
  // but normal navigation now renders every catalog page beneath Search.
  setupAlbum({
    onPlay: playTrackNow,
    onAddToPlaylist: openPlaylistPicker,
    onOpenArtist: (selection) => navigateCatalog("artist", selection),
    onBack: returnFromAlbum,
  });
  setupArtist({
    onPlay: playTrackNow,
    onOpenAlbum: (selection) => navigateCatalog("album", selection),
    onBack: navigateCatalogBack,
  });
  setupTrack({
    onPlay: playTrackNow,
    onAddToPlaylist: openPlaylistPicker,
    onOpenAlbum: (selection) => navigateCatalog("album", selection),
    onOpenArtist: (selection) => navigateCatalog("artist", selection),
    onBack: navigateCatalogBack,
  });
  setupSearch({
    onQuery: searchSpotify,
    onPlay: playTrackNow,
    onOpenAlbum: (selection) => navigateCatalog("album", selection),
    onOpenArtist: (selection) => navigateCatalog("artist", selection),
    onOpenTrack: (selection) => navigateCatalog("track", selection),
    onOpenPlaylist: (selection) => navigateCatalog("playlist", selection),
    onAddToPlaylist: openPlaylistPicker,
    onRefresh: refreshCatalogCurrent,
    onBack: navigateCatalogBack,
  });
  setupCommandPalette({ onCommand: executeCommand });
  setupPlaylistPicker({
    onToggle: togglePlaylistPickerMembership,
    onCheck: checkPlaylistPickerMembership,
    onNew: openCreatePlaylistModal,
  });
  setupPlaylistEditor({
    onCreate: createPlaylistFromEditor,
    onUpdate: updatePlaylistFromEditor,
  });
  setupPlaylistInteractions({
    onEdit: openEditPlaylistModal,
    onRemove: removeCatalogPlaylistItem,
    onReorder: reorderCatalogPlaylistItem,
  });
  setupLyricsEditor({
    onSave: saveEditedLyrics,
    onSearch: searchLyricsForEditor,
    onDropbox: openLyricsDropbox,
    onComputer: openLyricsComputer,
    onTogglePlay: () => runMediaCommand(togglePlayback),
    onSeek: (positionMs) => runMediaCommand(() => activeController()?.seek(positionMs)),
    onSpeed: (speed) => setPlaybackSpeed(speed),
    getPlayback: () => ({ ...(currentPlayback || {}), speed: soundSettings.speed }),
  });
  document.getElementById("lyrics-file-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { deliverImportedLyrics(await file.text()); }
    catch (error) { showToast(humanizeError(error)); }
  });
  setupDropbox({
    onConnect: connectDropbox,
    onFinish: finishDropboxConnection,
    onDisconnect: disconnectDropbox,
    onBrowse: browseDropbox,
    onRefresh: browseDropbox,
    onImport: importDropboxFile,
  });
  setupMediaSession({
    onPlay: () => currentPlayback?.paused && runMediaCommand(togglePlayback),
    onPause: () => currentPlayback?.isPlaying && runMediaCommand(togglePlayback),
    onSeek: (position) => runMediaCommand(() => activeController()?.seek(position * 1000)),
    onPrevious: () => runMediaCommand(previousPlayback),
    onNext: () => runMediaCommand(nextPlayback),
  });
  bindVolume();
  bindSoundSettings();
  bindMediaSettings();
  bindSeekSurface(getElements().seek);
  bindSeekSurface(getElements().immersiveSeek);
  bindDock();
  bindLocalImport();
  bindLibraryCreate();
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
  document.addEventListener("spoot:modal-open", ({ detail }) => {
    if (detail?.id === "modal-library") refreshLibrary();
    if (detail?.id === "modal-search") {
      renderCatalogCurrent({ animate: false });
      focusSearch();
    }
    if (detail?.id === "modal-settings") refreshDevices();
    if (detail?.id === "modal-eq") activeController()?.refreshVolume?.().catch(() => {});
    if (detail?.id === "modal-playlist") focusPlaylistPicker();
    if (detail?.id === "modal-dropbox") renderDropbox({ connected: Boolean(dropboxService?.connected) });
  });
  document.addEventListener("spoot:modal-close", ({ detail }) => {
    if (detail?.id === "modal-library" && cancelLibraryRequest()) {
      selectedLibrarySource = null;
      selectedLibraryItems = [];
      selectedLibraryNextOffset = null;
      selectedLibraryDurationMs = null;
    }
    if (detail?.id === "modal-album") {
      albumAbortController?.abort();
      albumAbortController = undefined;
    }
    if (detail?.id === "modal-artist") {
      artistAbortController?.abort();
      artistAbortController = undefined;
    }
    if (detail?.id === "modal-track") {
      trackAbortController?.abort();
      trackAbortController = undefined;
    }
  });
}


async function initializeLocalFeatures() {
  try {
    localLibrary = new LocalLibraryService();
    await localLibrary.open();
    hybridService = new HybridPlaylistService({ localLibrary });
    await hybridService.open();
    localTracks = await localLibrary.listTracks({ coverLimit: 32 });
    dropboxService = new DropboxImportService();
    if (!lyricsService || lyricsService instanceof MockLyricsService) {
      lyricsService = new LyricsService({
        onDiagnostic: (diagnostic) => console.debug("Lyrics provider skipped.", diagnostic),
      });
    }
    localController = new LocalPlaybackController({
      libraryService: localLibrary,
      onBeforePlay: async () => {
        if (spotifyPlayback?.isPlaying && controller?.togglePlay) {
          await controller.togglePlay().catch(() => {});
        }
      },
    });
    bindLocalController(localController);
    await localController.connect();
  } catch (error) {
    console.warn("Local Files could not initialize.", safeDiagnostic(error, "local-library"));
    showToast("Local Files could not initialize in this browser.");
  }
}

function bindLocalController(nextController) {
  localControllerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  localControllerUnsubscribers = [
    nextController.on("state", (playback) => {
      if (playbackMode !== "local") return;
      currentPlayback = playback;
      renderPlayback(playback);
      syncLyrics(playback);
      updateLyricsPosition(playback?.positionMs || 0, { instant: true });
      currentVolume = nextController.volume;
      renderVolume();
    }),
    nextController.on("progress", (positionMs) => {
      if (playbackMode !== "local" || !currentPlayback) return;
      currentPlayback = { ...currentPlayback, positionMs };
      renderProgress(positionMs, currentPlayback.durationMs);
      renderImmersive({ ...currentPlayback, positionMs });
      updateLyricsPosition(positionMs);
      updateLyricsSyncPlayback();
      updateMediaSessionPosition(positionMs, currentPlayback.durationMs);
      maybeEnterHybridLocal(positionMs);
    }),
    nextController.on("queue", (queue) => {
      if (playbackMode !== "local") return;
      currentQueue = queue;
      if (hybridSession) renderHybridQueue();
      else renderQueue(queue);
    }),
    nextController.on("volume", (volume) => {
      if (playbackMode !== "local") return;
      currentVolume = volume;
      renderVolume();
    }),
    nextController.on("ended", () => {
      if (hybridSession) advanceHybridAfterEnd().catch((error) => showToast(humanizeError(error)));
    }),
    nextController.on("notice", ({ message }) => showToast(message)),
    nextController.on("error", ({ message, error, operation }) => {
      console.warn("Local playback failed.", safeDiagnostic(error || new Error(message), operation || "local-playback"));
      showToast(message || "Local playback failed.");
    }),
  ];
}

function activeController() {
  return playbackMode === "local" ? localController : controller;
}

async function activateSpotifyPlayback() {
  if (playbackMode === "local") await localController?.pause?.().catch(() => {});
  playbackMode = "spotify";
  currentPlayback = spotifyPlayback;
  currentQueue = spotifyQueue;
  currentVolume = spotifyVolume;
  if (currentPlayback) renderPlayback(currentPlayback);
  if (hybridSession) renderHybridQueue();
  else if (currentQueue) renderQueue(currentQueue);
  renderVolume();
}

async function activateLocalPlayback() {
  playbackMode = "local";
  await localController?.setSpeed?.(soundSettings.speed);
  currentPlayback = localController?.playbackState || null;
  currentQueue = localController?.queue || null;
  currentVolume = localController?.volume ?? 1;
  if (currentPlayback) renderPlayback(currentPlayback);
  if (hybridSession) renderHybridQueue();
  else if (currentQueue) renderQueue(currentQueue);
  renderVolume();
}

async function initializeMockMode() {
  const requested = new URL(location.href).searchParams.get("scenario") || "default";
  const scenario = MOCK_SCENARIOS.has(requested) ? requested : "default";
  controller = new MockPlaybackController({ scenario });
  libraryService = new MockLibraryService();
  searchService = new MockSearchService();
  albumService = new MockAlbumService();
  artistService = new MockArtistService();
  trackService = new MockTrackService();
  playlistService = new MockPlaylistService();
  lyricsService = new MockLyricsService();
  bindController(controller);
  renderConnection("logged-in", {
    title: "Spoot mock mode",
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
      title: "Spoot mock mode",
      message: `Scenario: ${scenario}. No Spotify requests are being made.`,
    });
  } catch (error) {
    const state = scenario === "auth-error" ? "authorization-expired" : "error";
    renderConnection(state, {
      title: "Spoot mock mode",
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
  artistService = new SpotifyArtistService({ apiClient });
  trackService = new SpotifyTrackService({ apiClient });
  playlistService = new SpotifyPlaylistService({ apiClient, profileProvider: () => libraryService?.profile });
  playlistPickerService = new SpotifyPlaylistPickerService({ apiClient, libraryService, hybridService });
  if (!lyricsService || lyricsService instanceof MockLyricsService) {
    lyricsService = new LyricsService({
      onDiagnostic: (diagnostic) => console.debug("Lyrics provider skipped.", diagnostic),
    });
  }
  controller = new PlaybackController({ apiClient, sdk, queueService });
  bindController(controller);
}

function bindController(nextController) {
  controllerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  controllerUnsubscribers = [
    nextController.on("connection", (status) => {
      connectionState = status.state;
      if (["active", "player-ready"].includes(status.state)) renderSteadyConnection(status);
      else renderConnection(status.state, status);
      renderSettings(status);
    }),
    nextController.on("state", (playback) => {
      spotifyPlayback = playback;
      if (playbackMode === "local" && playback?.isPlaying) {
        localController?.pause?.().catch(() => {});
        playbackMode = "spotify";
      }
      if (playbackMode !== "spotify") {
        renderSteadyConnection();
        renderSettings();
        return;
      }
      currentPlayback = playback;
      syncHybridSpotifyIndex(playback);
      renderPlayback(playback);
      syncLyrics(playback);
      updateLyricsPosition(playback?.positionMs || 0, { instant: true });
      updateLyricsSyncPlayback();
      if (hybridSession) renderHybridQueue();
      renderSteadyConnection();
      renderSettings();
    }),
    nextController.on("progress", (positionMs) => {
      if (playbackMode !== "spotify" || !currentPlayback) return;
      currentPlayback = { ...currentPlayback, positionMs };
      spotifyPlayback = { ...spotifyPlayback, positionMs };
      renderProgress(positionMs, currentPlayback.durationMs);
      renderImmersive({ ...currentPlayback, positionMs });
      updateLyricsPosition(positionMs);
      updateLyricsSyncPlayback();
      updateMediaSessionPosition(positionMs, currentPlayback.durationMs);
      maybeEnterHybridLocal(positionMs);
    }),
    nextController.on("queue", (queue) => {
      spotifyQueue = queue;
      if (playbackMode !== "spotify") return;
      if (hybridSession) {
        renderHybridQueue();
        return;
      }
      currentQueue = queue;
      renderQueue(queue);
    }),
    nextController.on("devices", (devices) => {
      currentDevices = devices;
      renderSettings();
    }),
    nextController.on("volume", (volume) => {
      spotifyVolume = volume;
      if (playbackMode !== "spotify") return;
      currentVolume = volume;
      renderVolume();
    }),
    nextController.on("ended", () => {
      if (hybridSession) advanceHybridAfterEnd().catch((error) => showToast(humanizeError(error)));
    }),
    nextController.on("notice", ({ message }) => showToast(message)),
    nextController.on("null-state", ({ message }) => {
      if (playbackMode !== "spotify") return;
      showToast(message);
      renderNowPlaying({ emptyMessage: "No active Spotify playback" });
      renderImmersive({ emptyMessage: "No active Spotify playback" });
      resetLyrics("empty");
    }),
    nextController.on("error", ({ message, error, operation, type }) => {
      const diagnosticError = error || { name: "SpotifySdkError", code: type, message };
      console.warn("Spotify operation failed.", safeDiagnostic(diagnosticError, operation || type));
      if (operation !== "refresh-devices") showToast(message || humanizeError(error));
      if (operation === "refresh-queue" && playbackMode === "spotify") renderQueueUnavailable(message);
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
    hasItem ? "Use Spoot as the active device first" : "Start a track in Spotify first",
  );

  document.title = playback?.title ? `${playback.title} — Spoot` : "Spoot";
  if (selectedLibrarySource) renderSelectedLibrary();
  if (catalogCurrent?.kind && catalogCurrent.kind !== "search" && isModalOpen("modal-search")) {
    renderCatalogCurrent({ animate: false });
  }
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
  if (spotifyPlayback?.activeDevice && controller?.deviceId) {
    renderConnection("active", { hidden: true });
    return;
  }

  const externalDevice = spotifyPlayback?.device?.isActive
    ? spotifyPlayback.device
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
      ? "Choose Listen here to start using Spoot."
      : status.message || "Preparing the Spoot browser player…",
    primaryLabel: controller?.deviceId ? "Listen here" : "Connecting…",
    primaryDisabled: !controller?.deviceId,
    onPrimary: transferHere,
  });
}

function renderLoggedOut() {
  spotifyPlayback = null;
  spotifyQueue = null;
  currentDevices = [];
  libraryService?.clearSessionCache?.();
  playlistPickerService?.clear?.();
  playlistPickerService = undefined;
  librarySources = localLibrary ? [localSource(localTracks)] : [];
  selectedLibrarySource = null;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  selectedLibraryDurationMs = null;
  cancelLibraryRequest();
  searchAbortController?.abort();
  searchAbortController = undefined;
  albumAbortController?.abort();
  artistAbortController?.abort();
  trackAbortController?.abort();
  albumAbortController = undefined;
  artistAbortController = undefined;
  trackAbortController = undefined;
  albumReturnModal = "modal-search";
  renderSearch();
  renderAlbum();
  renderArtist();
  renderTrack();
  setHiddenMode(false);
  renderConnection("logged-out");
  if (playbackMode !== "local") {
    currentPlayback = null;
    currentQueue = null;
    resetLyrics("disconnected");
    renderNowPlaying({ emptyMessage: "Log in to Spotify or open Local Files" });
    renderImmersive({ emptyMessage: "Log in to Spotify or open Local Files" });
    renderQueue({ status: "disconnected", message: "Open Local Files or log in to Spotify." });
    renderMediaSession(null);
    setPlaybackControlsEnabled(false, "Choose a local song or log in to Spotify");
  }
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
      ? spotifyPlayback?.activeDevice
        ? "Spoot is the active device"
        : spotifyPlayback?.device?.isActive
          ? `Listening on ${spotifyPlayback.device.name || "another device"}`
          : "Spoot device ready"
      : status.message || "Spoot device unavailable",
    transfer: {
      label: "Listen here",
      onClick: transferHere,
      hidden: !loggedIn || !controller?.deviceId || Boolean(spotifyPlayback?.activeDevice),
      disabled: connectionState === "transferring-playback",
    },
    onConnect: login,
    onTransfer: transferHere,
    onDisconnect: logout,
  });
  renderDevicePicker({
    devices: currentDevices,
    activeDeviceId: spotifyPlayback?.device?.isActive ? spotifyPlayback.device.id : null,
    activeDeviceName: spotifyPlayback?.device?.isActive ? spotifyPlayback.device.name : null,
    spootDeviceId: controller?.deviceId ?? null,
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
  stopOAuthPopupWatch?.();
  stopOAuthPopupWatch = undefined;
  oauthPopup = window.open(
    "about:blank",
    OAUTH_POPUP_NAME,
    "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes",
  );
  if (!oauthPopup) {
    renderConnection("error", {
      message: `Allow popups for ${location.hostname || "this site"}, then try logging in again.`,
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
    const watchedPopup = oauthPopup;
    stopOAuthPopupWatch = watchOAuthPopup({
      popup: watchedPopup,
      expectedOrigin: new URL(config.redirectUri).origin,
      onCallback: (url, source) => {
        // The redirect response itself may be a host-level 403. Once its URL
        // is same-origin, the code and state are enough to finish PKCE here.
        try { source.close(); } catch {}
        return handleOAuthCallbackMessage({ url }, source);
      },
      onClosed: () => handleOAuthPopupClosed(watchedPopup),
      onTimeout: () => handleOAuthPopupTimeout(watchedPopup),
      onError: (error) => {
        console.warn("Spotify popup inspection failed.", safeDiagnostic(error, "oauth-popup"));
      },
    });
    oauthPopup.focus();
  } catch (error) {
    stopOAuthPopupWatch?.();
    stopOAuthPopupWatch = undefined;
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
  // Broadcasts reach every open Spoot tab. Only the tab whose sessionStorage
  // owns this state may exchange it. A direct popup message can still surface
  // a precise missing-transaction error instead of hanging silently.
  if (!ownsTransaction && !source) return;
  const inFlightKey = callbackState || "missing-callback-state";
  if (oauthCallbackInFlightState === inFlightKey) return;
  oauthCallbackInFlightState = inFlightKey;
  const callbackPopup = source || oauthPopup;

  renderConnection("authorizing", {
    message: "Finishing Spotify sign-in…",
  });
  try {
    await auth.handleCallback({ url: callbackUrl.href, cleanup: false });
    if (!auth.hasGrantedScopes(config.scopes)) {
      auth.logout();
      throw new SpotifyAuthError(
        "Spotify did not grant every permission required by Spoot.",
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
    stopOAuthPopupWatch?.();
    stopOAuthPopupWatch = undefined;
    try {
      if (callbackPopup && !callbackPopup.closed) callbackPopup.close();
    } catch {}
    oauthPopup = undefined;
    if (oauthCallbackInFlightState === inFlightKey) {
      oauthCallbackInFlightState = undefined;
    }
  }
}

function handleOAuthPopupClosed(popup) {
  if (oauthPopup !== popup || oauthCallbackInFlightState) return;
  oauthPopup = undefined;
  stopOAuthPopupWatch = undefined;
  if (connectionState !== "authorizing") return;
  renderLoggedOut();
  renderConnection("logged-out", {
    message: "Spotify sign-in was cancelled. Choose Log in to try again.",
  });
}

function handleOAuthPopupTimeout(popup) {
  if (oauthPopup !== popup || oauthCallbackInFlightState) return;
  try {
    if (!popup.closed) popup.close();
  } catch {}
  oauthPopup = undefined;
  stopOAuthPopupWatch = undefined;
  renderConnection("error", {
    message: "Spotify sign-in timed out. Choose Log in to try again.",
  });
  renderSpotifySettings({ loggedIn: false, onConnect: login });
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
      showToast("Spoot is ready. Start a track in Spotify, then press play here once if needed.", { duration: 4200 });
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
  artistService = undefined;
  trackService = undefined;
  playlistService = undefined;
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
    showToast(deviceId === controller.deviceId ? "Listening through Spoot." : "Spotify device changed.");
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function playTrackNow(selection) {
  const request = typeof selection === "string" ? { uri: selection } : selection || {};
  if (request.hybridPlaylistId && Number.isInteger(request.hybridPosition)) {
    return startHybridPlayback(request.hybridPlaylistId, request.hybridPosition);
  }

  const localId = request.localId || localIdFromUri(request.uri);
  if (request.localSourceId) {
    if (!localTracks.length) {
      showToast("Import songs into Local Files first.");
      return;
    }
    return playTrackNow({ localId: localTracks[0].id, uri: localTracks[0].uri });
  }
  if (localId) {
    hybridSession = null;
    if (!localController) {
      showToast("Local Files is unavailable in this browser.");
      return;
    }
    try {
      await activateLocalPlayback();
      const contextIds = selectedLibrarySource?.kind === "local"
        ? selectedLibraryItems.map((item) => item.localId || item.id).filter(Boolean)
        : localTracks.map((track) => track.id);
      await localController.playTrack(localId, { contextIds, autoAdvance: true });
      return;
    } catch (error) {
      showToast(humanizeError(error));
      return;
    }
  }

  if (!controller?.playNow) {
    showToast("Log in and wait for the Spoot browser player to connect.");
    return;
  }
  hybridSession = null;
  try {
    await activateSpotifyPlayback();
    if (request.contextOnly && request.contextUri) {
      await controller.playNow(null, { contextUri: request.contextUri });
    } else if (request.sourceKind === "liked") {
      const playableUris = selectedLibraryItems
        .filter((entry) => !isLocalEntry(entry) && entry.playable && entry.uri)
        .map((entry) => entry.uri);
      const selectedIndex = playableUris.indexOf(request.uri);
      const orderedUris = selectedIndex < 0 ? [request.uri] : playableUris.slice(selectedIndex);
      await controller.playNow(request.uri, { uris: orderedUris });
    } else {
      await controller.playNow(request.uri, {
        contextUri: request.contextUri,
        contextPosition: Number.isInteger(request.contextPosition) ? request.contextPosition : null,
      });
    }
    renderSteadyConnection();
  } catch (error) {
    showToast(humanizeError(error));
  }
}



async function startHybridPlayback(playlistId, requestedIndex = 0) {
  const collection = await resolveHybridCollection(playlistId);
  if (!collection?.items?.length) {
    showToast("That playlist has no playable songs.");
    return;
  }
  const items = collection.items.filter((entry) => entry?.uri && entry?.playable !== false);
  const position = Math.max(0, Math.min(items.length - 1, Number(requestedIndex) || 0));
  if (!items.some(isLocalEntry)) {
    const selected = items[position];
    return playTrackNow({
      uri: selected.uri,
      contextUri: collection.contextUri,
      contextPosition: Number.isInteger(selected.spotifyPosition) ? selected.spotifyPosition : null,
      sourceKind: collection.kind,
    });
  }

  clearTimeout(hybridBoundaryTimer);
  hybridBoundaryTimer = null;
  hybridSession = {
    playlistId: String(playlistId),
    contextUri: collection.contextUri || null,
    kind: collection.kind || "playlist",
    items,
    index: position,
    enteredLocal: false,
    repeatMode: ["off", "context", "track"].includes(spotifyPlayback?.repeatMode)
      ? spotifyPlayback.repeatMode
      : "off",
  };
  return playHybridIndex(position);
}

async function resolveHybridCollection(playlistId) {
  const id = String(playlistId || "");
  if (catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === id) {
    return {
      kind: "playlist",
      contextUri: catalogCurrent.result.playlist.uri,
      items: catalogCurrent.result.items || [],
    };
  }
  if (selectedLibrarySource?.id === id) {
    return {
      kind: selectedLibrarySource.kind,
      contextUri: selectedLibrarySource.uri,
      items: selectedLibraryItems || [],
    };
  }
  if (id === "local-files") {
    return {
      kind: "local",
      contextUri: null,
      items: localTracks.map(normalizeLocalLibraryEntry),
    };
  }

  const source = librarySources.find((candidate) => candidate.id === id);
  if (!source || !libraryService) return null;
  const page = await libraryService.loadSource(source, { force: false });
  const spotifyItems = page.items || [];
  const items = hybridService && ["liked", "playlist"].includes(source.kind)
    ? await hybridService.mergeCollection(source.id, spotifyItems)
    : spotifyItems;
  return { kind: source.kind, contextUri: source.uri || null, items };
}

async function playHybridIndex(index, { fromEnded = false } = {}) {
  clearTimeout(hybridBoundaryTimer);
  hybridBoundaryTimer = null;
  if (!hybridSession || hybridTransitioning) return;
  if (index < 0) index = 0;
  if (index >= hybridSession.items.length) {
    index = fromEnded && hybridSession.repeatMode === "track"
      ? hybridSession.index
      : hybridSession.repeatMode === "context" ? index % hybridSession.items.length : -1;
  }
  if (index < 0) return finishHybridPlayback();
  const item = hybridSession.items[index];
  if (!item?.uri) return playHybridIndex(index + 1, { fromEnded });
  hybridTransitioning = true;
  hybridSession.index = index;
  try {
    if (isLocalEntry(item)) {
      hybridSession.enteredLocal = true;
      const localId = item.localId || localIdFromUri(item.uri);
      if (!localId || !localController) throw new Error("That local song is unavailable.");
      await activateLocalPlayback();
      await localController.setRepeat(hybridSession.repeatMode);
      await localController.playTrack(localId, { contextIds: [localId], autoAdvance: false });
    } else {
      await activateSpotifyPlayback();
      await controller.playNow(item.uri, {
        // A Spotify context cannot contain Spoot's client-only local rows.
        // Start exactly one remote item and let the hybrid session own every
        // transition so natural endings, skips, previous, and repeat agree.
        uris: [item.uri],
      });
    }
    renderHybridQueue();
  } finally {
    hybridTransitioning = false;
  }
}

function syncHybridSpotifyIndex(playback) {
  if (!hybridSession || playbackMode !== "spotify" || hybridTransitioning) return;
  const uri = playback?.itemUri || playback?.currentItem?.uri || playback?.item?.uri;
  if (!uri) return;
  const expected = hybridSession.items[hybridSession.index];
  if (!isLocalEntry(expected) && expected?.uri === uri) return;

  // A throttled/background tab may miss the end timer and Spotify may expose
  // an autoplay item. Reassert the next merged row instead of skipping a local
  // placement or abandoning the selected playlist.
  const target = nextHybridIndex(hybridSession.items, hybridSession.index, {
    repeatMode: hybridSession.repeatMode,
    fromEnded: true,
  });
  if (target === null) finishHybridPlayback().catch(() => {});
  else playHybridIndex(target, { fromEnded: true }).catch((error) => showToast(humanizeError(error)));
}

function maybeEnterHybridLocal(positionMs) {
  if (!hybridSession || hybridTransitioning || hybridBoundaryTimer) return;
  const current = hybridSession.items[hybridSession.index];
  if (!current || playbackMode !== "spotify" || !currentPlayback?.isPlaying) return;
  const remaining = Math.max(0, (Number(currentPlayback.durationMs) || 0) - (Number(positionMs) || 0));
  if (!Number(currentPlayback.durationMs) || remaining > 1_500) return;
  const session = hybridSession;
  const expectedIndex = session.index;
  const delay = Math.max(0, remaining - 70);
  hybridBoundaryTimer = setTimeout(async () => {
    hybridBoundaryTimer = null;
    if (!hybridSession || hybridSession !== session || hybridSession.index !== expectedIndex || hybridTransitioning) return;
    try {
      const target = nextHybridIndex(hybridSession.items, hybridSession.index, {
        repeatMode: hybridSession.repeatMode,
        fromEnded: true,
      });
      if (target === null) await finishHybridPlayback({ allowCurrentToEnd: true });
      else await playHybridIndex(target, { fromEnded: true });
    } catch (error) {
      showToast(humanizeError(error));
    }
  }, delay);
}

async function finishHybridPlayback({ allowCurrentToEnd = false } = {}) {
  clearTimeout(hybridBoundaryTimer);
  hybridBoundaryTimer = null;
  const session = hybridSession;
  hybridSession = null;
  if (!session) return;
  if (playbackMode === "local") await localController?.pause?.().catch(() => {});
  else if (!allowCurrentToEnd && spotifyPlayback?.isPlaying) await controller?.togglePlay?.().catch(() => {});
  currentQueue = {
    status: "ready",
    source: playbackMode,
    currentItem: currentPlayback?.currentItem || currentPlayback?.item || null,
    items: [],
  };
  renderQueue(currentQueue);
}

function renderHybridQueue() {
  if (!hybridSession) return;
  const current = hybridSession.items[hybridSession.index] || currentPlayback?.currentItem || null;
  const hybridUpcoming = hybridUpcomingItems(hybridSession.items, hybridSession.index, {
    repeatMode: hybridSession.repeatMode,
  });
  currentQueue = {
    status: "ready",
    source: "hybrid",
    currentItem: current,
    items: hybridUpcoming,
    hybridLength: hybridUpcoming.length,
  };
  renderQueue(currentQueue);
}

async function nextPlayback() {
  if (hybridSession) {
    const target = nextHybridIndex(hybridSession.items, hybridSession.index, {
      repeatMode: hybridSession.repeatMode,
    });
    return target === null ? finishHybridPlayback() : playHybridIndex(target);
  }
  return activeController()?.next?.();
}

async function advanceHybridAfterEnd() {
  if (!hybridSession) return;
  const target = nextHybridIndex(hybridSession.items, hybridSession.index, {
    repeatMode: hybridSession.repeatMode,
    fromEnded: true,
  });
  return target === null ? finishHybridPlayback() : playHybridIndex(target, { fromEnded: true });
}

async function previousPlayback() {
  if (hybridSession) {
    if ((Number(currentPlayback?.positionMs) || 0) > 3_000) return activeController()?.seek?.(0);
    return playHybridIndex(previousHybridIndex(hybridSession.items, hybridSession.index, {
      repeatMode: hybridSession.repeatMode,
    }));
  }
  return activeController()?.previous?.();
}

async function togglePlayback() {
  return activeController()?.togglePlay?.();
}

async function setRepeatPlayback(mode) {
  if (!hybridSession) return activeController()?.setRepeat?.(mode);
  hybridSession.repeatMode = mode;
  if (playbackMode === "spotify") await controller?.setRepeat?.(mode);
  else await localController?.setRepeat?.(mode);
  const mirror = playbackMode === "spotify" ? localController : controller;
  mirror?.setRepeat?.(mode).catch(() => {});
  renderHybridQueue();
  return mode;
}

async function cycleRepeatPlayback() {
  if (!hybridSession) return activeController()?.cycleRepeat?.();
  const modes = ["off", "context", "track"];
  const current = modes.includes(hybridSession.repeatMode) ? hybridSession.repeatMode : "off";
  return setRepeatPlayback(modes[(modes.indexOf(current) + 1) % modes.length]);
}

async function searchSpotify(query, { force = false } = {}) {
  const normalizedQuery = String(query || "").trim();
  if (
    !force &&
    normalizedQuery &&
    searchView.query === normalizedQuery &&
    ["loading", "ready"].includes(searchView.status)
  ) {
    catalogHistory = [];
    catalogCurrent = searchView;
    renderCatalogCurrent({ animate: false });
    return;
  }
  searchAbortController?.abort();
  catalogAbortController?.abort();
  searchAbortController = undefined;
  catalogAbortController = undefined;
  catalogHistory = [];
  searchView = {
    kind: "search",
    status: normalizedQuery ? "loading" : "idle",
    query: normalizedQuery,
    results: null,
    message: null,
  };
  catalogCurrent = searchView;
  renderCatalogCurrent();
  if (!normalizedQuery) return;
  if (!searchService) {
    searchView = {
      ...searchView,
      status: "error",
      message: "Log in to Spotify to search the catalog.",
    };
    catalogCurrent = searchView;
    renderCatalogCurrent();
    return;
  }

  const request = new AbortController();
  searchAbortController = request;
  try {
    const results = await searchService.search(normalizedQuery, { signal: request.signal, force });
    if (searchAbortController !== request) return;
    searchView = { ...searchView, status: "ready", results, message: null };
    catalogCurrent = searchView;
    renderCatalogCurrent();
  } catch (error) {
    if (error?.name === "AbortError" || searchAbortController !== request) return;
    console.warn("Spotify search failed.", safeDiagnostic(error, "search"));
    searchView = {
      ...searchView,
      status: "error",
      message: humanizeSearchError(error),
    };
    catalogCurrent = searchView;
    renderCatalogCurrent();
  } finally {
    if (searchAbortController === request) searchAbortController = undefined;
  }
}

function openCatalogFromLibrary(kind, selection) {
  catalogHistory = [{ kind: "library" }];
  catalogCurrent = createCatalogEntry(kind, selection);
  openModal("modal-search");
  loadCatalogEntry(catalogCurrent);
}

function navigateCatalog(kind, selection) {
  const entry = createCatalogEntry(kind, selection);
  if (!entry.id) {
    showToast("Spotify did not return a usable page identifier.");
    return;
  }
  if (catalogCurrent) catalogHistory.push(snapshotCatalogEntry(catalogCurrent));
  catalogCurrent = entry;
  openModal("modal-search");
  loadCatalogEntry(entry);
}

function navigateCatalogBack() {
  catalogAbortController?.abort();
  catalogAbortController = undefined;
  const previous = catalogHistory.pop();
  if (!previous) {
    catalogCurrent = searchView;
    renderCatalogCurrent();
    focusSearch();
    return;
  }
  if (previous.kind === "library") {
    catalogHistory = [];
    catalogCurrent = searchView;
    openModal("modal-library");
    renderSelectedLibrary();
    return;
  }
  catalogCurrent = previous;
  openModal("modal-search");
  if (previous.status === "ready" || previous.status === "error") {
    renderCatalogCurrent();
  } else {
    loadCatalogEntry(previous);
  }
}

function createCatalogEntry(kind, selection) {
  const id = typeof selection === "string" ? selection : selection?.id;
  return {
    kind,
    id: typeof id === "string" ? id : null,
    status: "loading",
    result: null,
    message: null,
  };
}

function snapshotCatalogEntry(entry) {
  if (entry?.kind === "search") return { ...searchView };
  return { ...entry };
}

async function loadCatalogEntry(entry, { force = false } = {}) {
  catalogAbortController?.abort();
  catalogAbortController = undefined;
  if (!entry?.id) {
    entry.status = "error";
    entry.message = "Spotify did not return a usable page identifier.";
    renderCatalogCurrent();
    return;
  }
  const service = catalogService(entry.kind);
  if (!service) {
    entry.status = "error";
    entry.message = `Log in to Spotify to open ${catalogKindLabel(entry.kind, true)}.`;
    renderCatalogCurrent();
    return;
  }
  entry.status = "loading";
  renderCatalogCurrent();
  const request = new AbortController();
  catalogAbortController = request;
  try {
    const method = {
      album: "loadAlbum",
      artist: "loadArtist",
      track: "loadTrack",
      playlist: "loadPlaylist",
    }[entry.kind];
    let result = await service[method](entry.id, { signal: request.signal, force });
    if (entry.kind === "playlist" && hybridService && result?.playlist) {
      const spotifyItems = result.spotifyItems || result.items || [];
      const items = await hybridService.mergeCollection(entry.id, spotifyItems);
      result = {
        ...result,
        spotifyItems,
        items,
        total: items.length,
        durationMs: items.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0),
        playlist: { ...result.playlist, total: items.length },
      };
    }
    if (catalogAbortController !== request || catalogCurrent !== entry) return;
    entry.status = "ready";
    entry.result = result;
    entry.message = null;
    renderCatalogCurrent();
  } catch (error) {
    if (error?.name === "AbortError" || catalogAbortController !== request || catalogCurrent !== entry) return;
    console.warn(`Spotify ${entry.kind} failed to load.`, safeDiagnostic(error, entry.kind));
    entry.status = "error";
    entry.message = humanizeCatalogError(entry.kind, error);
    renderCatalogCurrent();
  } finally {
    if (catalogAbortController === request) catalogAbortController = undefined;
  }
}


function refreshCatalogCurrent() {
  if (!catalogCurrent || catalogCurrent.kind === "search") {
    if (searchView.query) return searchSpotify(searchView.query, { force: true });
    return;
  }
  return loadCatalogEntry(catalogCurrent, { force: true });
}

function catalogService(kind) {
  return { album: albumService, artist: artistService, track: trackService, playlist: playlistService }[kind];
}

function renderCatalogCurrent({ animate = true } = {}) {
  const container = getSearchResultsContainer();
  if (!container) return;
  const current = catalogCurrent || searchView;
  container.classList.toggle("catalog-detail", current.kind !== "search");
  if (current.kind === "search") {
    renderSearch({
      status: current.status,
      query: current.query,
      results: current.results,
      message: current.message,
      animate,
    });
    setSearchChrome({
      expanded: current.status !== "idle" && Boolean(current.query),
      canGoBack: catalogHistory.length > 0,
      query: current.query,
    });
    return;
  }

  setSearchChrome({
    expanded: true,
    canGoBack: catalogHistory.length > 0,
    query: searchView.query,
  });
  const options = {
    container,
    status: current.status,
    result: current.result,
    message: current.message,
    currentUri: currentPlayback?.itemUri || null,
  };
  if (current.kind === "album") renderAlbum(options);
  else if (current.kind === "artist") renderArtist(options);
  else if (current.kind === "track") renderTrack(options);
  else if (current.kind === "playlist") renderPlaylist(options);
  if (animate) animateSearchContent(container);
}

function catalogKindLabel(kind, plural = false) {
  const singular = { album: "releases", artist: "artists", track: "songs", playlist: "playlists" }[kind] || "pages";
  return plural ? singular : singular.replace(/s$/u, "");
}

function humanizeCatalogError(kind, error) {
  if (kind === "album") return humanizeAlbumError(error);
  if (kind === "artist") return humanizeArtistError(error);
  if (kind === "track") return humanizeTrackError(error);
  if (error instanceof SpotifyApiError && error.status === 403) {
    return "Spotify returned the playlist metadata but does not allow Spoot to read its songs.";
  }
  return humanizeError(error);
}

// Compatibility wrappers retained for code/tests that still reference the old
// standalone detail-page names.
function openAlbumPage(selection) {
  navigateCatalog("album", selection);
}

function openArtistPage(selection) {
  navigateCatalog("artist", selection);
}

function openTrackPage(selection) {
  navigateCatalog("track", selection);
}

function returnFromAlbum() {
  navigateCatalogBack();
}

function returnToSearch() {
  navigateCatalogBack();
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
  currentLyrics = null;

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
    currentLyrics = lyrics;
    renderLyrics({ status: "ready", lyrics, track });
    updateLyricsPosition(currentPlayback?.positionMs || 0, { instant: true });
  } catch (error) {
    if (error?.name === "AbortError" || lyricsAbortController !== request) return;
    console.debug("Lyrics lookup failed.", safeDiagnostic(error, "lyrics"));
    currentLyrics = null;
    renderLyrics({ status: "error", track });
  } finally {
    if (lyricsAbortController === request) lyricsAbortController = undefined;
  }
}


function resetLyrics(status = "empty") {
  lyricsAbortController?.abort();
  lyricsAbortController = undefined;
  currentLyricsTrackKey = undefined;
  currentLyrics = null;
  renderLyrics({ status });
}



function currentLyricsTrack() {
  return currentPlayback?.currentItem || currentPlayback?.item || null;
}

function openLyricsEditorModal() {
  const track = currentLyricsTrack();
  if (!track || track.type === "episode") {
    showToast("Play a song before editing lyrics.");
    return;
  }
  showLyricsEditor({
    currentTrack: track,
    lyrics: currentLyrics,
    mode: currentLyrics?.lines?.length || currentLyrics?.instrumental ? "editor" : "choose",
  });
  openModal("modal-lyrics");
}

async function saveEditedLyrics(track, text) {
  if (!lyricsService || !track) return;
  try {
    currentLyrics = await lyricsService.save(track, text, {
      source: "manual",
      userModified: true,
    });
    currentLyricsTrackKey = track.id || track.uri || currentLyricsTrackKey;
    renderLyrics({ status: "ready", lyrics: currentLyrics, track });
    updateLyricsPosition(currentPlayback?.positionMs || 0, { instant: true });
    closeModals();
    showToast("Lyrics saved.");
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function searchLyricsForEditor(track, { target = "editor" } = {}) {
  if (!lyricsService || !track) return;
  lyricsImportTarget = target;
  try {
    showLyricsResults([]);
    const results = await lyricsService.search(track);
    showLyricsResults(results);
  } catch (error) {
    showLyricsResults([]);
    showToast(humanizeError(error));
  }
}

function openLyricsComputer({ target = "editor" } = {}) {
  lyricsImportTarget = target;
  document.getElementById("lyrics-file-input")?.click();
}

function openLyricsDropbox({ target = "editor" } = {}) {
  lyricsImportTarget = target;
  if (!dropboxService?.connected) {
    showToast("Connect Dropbox in Settings first.");
    openModal("modal-settings");
    return;
  }
  openModal("modal-dropbox");
  renderDropbox({ connected: true, status: "loading", path: "", mode: "lyrics" });
  browseDropbox("", { mode: "lyrics" });
}

function deliverImportedLyrics(text) {
  deliverLyricsText(text, { sync: lyricsImportTarget === "sync" });
  openModal("modal-lyrics");
}

async function playQueueItem(selection) {
  const queueIndex = Math.max(0, Number(selection?.index) || 0);
  if (hybridSession && currentQueue?.source === "hybrid") {
    const hybridUpcoming = Math.max(0, Number(currentQueue.hybridLength) || 0);
    try {
      if (queueIndex < hybridUpcoming) {
        const target = hybridSession.repeatMode === "track"
          ? hybridSession.index
          : (hybridSession.index + 1 + queueIndex) % hybridSession.items.length;
        await playHybridIndex(target);
      } else {
        // The Spotify-generated tail is still owned by Spotify. Preserve that
        // live context and advance through it rather than replacing it with a
        // copied URI list.
        const tailIndex = queueIndex - hybridUpcoming;
        hybridSession = null;
        await activateSpotifyPlayback();
        await controller?.playQueueItem?.({ ...selection, index: tailIndex });
      }
      renderSteadyConnection();
    } catch (error) {
      showToast(humanizeError(error));
    }
    return;
  }

  const target = activeController();
  if (!target?.playQueueItem) {
    showToast("Choose a song or wait for the player to connect.");
    return;
  }
  try {
    await target.playQueueItem(selection);
    if (playbackMode === "spotify") renderSteadyConnection();
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function refreshLibrary({ force = false } = {}) {
  if (force && localLibrary) localTracks = await localLibrary.listTracks({ coverLimit: 32 });
  const local = localLibrary ? localSource(localTracks) : null;

  if (!libraryService) {
    librarySources = local ? [local] : [];
    showLibrarySources();
    return;
  }
  if (librarySources.length && !force) {
    if (selectedLibrarySource) renderSelectedLibrary();
    else showLibrarySources();
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
    const spotifySources = await libraryService.loadSources({ force, signal: request.signal });
    if (libraryAbortController !== request) return;
    librarySources = mergeLocalSource(spotifySources, local);
    showLibrarySources();
  } catch (error) {
    if (error?.name === "AbortError" || libraryAbortController !== request) return;
    console.warn("Spotify library failed to load.", safeDiagnostic(error, "library-sources"));
    librarySources = local ? [local] : [];
    if (librarySources.length) {
      showLibrarySources();
      showToast("Spotify playlists could not refresh. Local Files is still available.");
    } else {
      renderLibrarySources({ status: "error", message: humanizeLibraryError(error) });
    }
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

async function refreshCurrentLibraryView() {
  if (!selectedLibrarySource) return refreshLibrary({ force: true });
  return openLibrarySource(selectedLibrarySource.id, { force: true });
}

async function openLibrarySource(sourceId, { force = false } = {}) {
  const source = librarySources.find((candidate) => candidate.id === sourceId);
  if (!source?.canBrowse) return;
  selectedLibrarySource = source;
  selectedLibraryItems = [];
  selectedLibraryNextOffset = null;
  selectedLibraryDurationMs = null;
  cancelLibraryRequest();

  if (source.kind === "local") {
    renderLibraryDetail({ source, status: "loading", total: source.total, currentUri: currentPlayback?.itemUri || null });
    try {
      if (force || !localTracks.length) localTracks = await localLibrary.listTracks({ coverLimit: 32 });
      selectedLibrarySource = localSource(localTracks);
      librarySources = mergeLocalSource(librarySources.filter((entry) => entry.kind !== "local"), selectedLibrarySource);
      selectedLibraryItems = localTracks.map(normalizeLocalLibraryEntry);
      selectedLibraryDurationMs = selectedLibraryItems.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
      selectedLibraryNextOffset = null;
      renderSelectedLibrary();
    } catch (error) {
      renderLibraryDetail({ source, status: "error", total: source.total, message: humanizeError(error), currentUri: currentPlayback?.itemUri || null });
    }
    return;
  }

  if (!libraryService) {
    renderLibraryDetail({ source, status: "error", total: source.total, message: "Log in to Spotify to open this playlist." });
    return;
  }
  if (force) libraryService.invalidateSource?.(source.id);
  const request = new AbortController();
  libraryAbortController = request;
  renderLibraryDetail({ source, status: "loading", total: source.total, currentUri: currentPlayback?.itemUri || null });
  try {
    const loadSource = libraryService.loadSource?.bind(libraryService);
    const page = loadSource
      ? await loadSource(source, { force, signal: request.signal })
      : await libraryService.loadSourcePage(source, { offset: 0, signal: request.signal });
    if (libraryAbortController !== request || selectedLibrarySource?.id !== source.id) return;
    const spotifyItems = page.items || [];
    selectedLibraryItems = hybridService && ["liked", "playlist"].includes(source.kind)
      ? await hybridService.mergeCollection(source.id, spotifyItems)
      : spotifyItems;
    selectedLibraryNextOffset = page.nextOffset;
    selectedLibraryDurationMs = selectedLibraryItems.reduce(
      (sum, item) => sum + (Number(item.durationMs) || 0),
      0,
    );
    source.total = selectedLibraryItems.length;
    renderLibraryDetail({
      source,
      currentUri: currentPlayback?.itemUri || null,
      items: selectedLibraryItems,
      total: selectedLibraryItems.length,
      durationMs: selectedLibraryDurationMs,
      complete: page.complete ?? page.nextOffset === null,
      nextOffset: loadSource ? null : page.nextOffset,
      message: page.unavailableReason,
    });
  } catch (error) {
    if (error?.name === "AbortError" || libraryAbortController !== request) return;
    console.warn("Spotify library source failed to load.", safeDiagnostic(error, "library-items"));
    renderLibraryDetail({ source, currentUri: currentPlayback?.itemUri || null, status: "error", total: source.total, message: humanizeLibraryError(error) });
  } finally {
    if (libraryAbortController === request) libraryAbortController = undefined;
  }
}



function mergeLocalSource(sources = [], local = localLibrary ? localSource(localTracks) : null) {
  const remote = (sources || []).filter((source) => source?.kind !== "local");
  if (!local) return remote;
  const likedIndex = remote.findIndex((source) => source.kind === "liked");
  const index = likedIndex >= 0 ? likedIndex + 1 : 0;
  remote.splice(index, 0, local);
  return remote;
}

function normalizeLocalLibraryEntry(track) {
  return {
    ...track,
    key: track.id,
    id: track.id,
    localId: track.id,
    item: { ...track, id: track.id, uri: track.uri, type: "track", isLocal: true },
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    artists: track.artists,
    albumName: track.albumName || "Local Files",
    durationMs: track.durationMs || 0,
    playable: true,
    unavailableReason: null,
    isLocal: true,
  };
}

function cancelLibraryRequest() {
  const cancelled = Boolean(libraryAbortController);
  libraryAbortController?.abort();
  libraryAbortController = undefined;
  return cancelled;
}

async function loadMoreLibraryItems() {
  if (!selectedLibrarySource || selectedLibraryNextOffset === null || !libraryService) return;
  const source = selectedLibrarySource;
  const offset = selectedLibraryNextOffset;
  selectedLibraryNextOffset = null;
  renderSelectedLibrary();
  try {
    const page = await libraryService.loadSourcePage(source, { offset });
    if (selectedLibrarySource?.id !== source.id) return;
    const combinedSpotify = [
      ...selectedLibraryItems.filter((entry) => !isLocalEntry(entry)),
      ...(page.items || []),
    ];
    selectedLibraryItems = hybridService && ["liked", "playlist"].includes(source.kind)
      ? await hybridService.mergeCollection(source.id, combinedSpotify)
      : combinedSpotify;
    selectedLibraryNextOffset = page.nextOffset;
    selectedLibraryDurationMs = selectedLibraryItems.reduce(
      (sum, item) => sum + (Number(item.durationMs) || 0),
      0,
    );
    source.total = selectedLibraryItems.length;
    renderSelectedLibrary();
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
    currentUri: currentPlayback?.itemUri || null,
  });
}


function bindLocalImport() {
  const fileInput = document.getElementById("local-file-input");
  const computer = document.getElementById("import-computer");
  const dropbox = document.getElementById("import-dropbox");
  computer?.addEventListener("click", () => fileInput?.click());
  dropbox?.addEventListener("click", () => {
    openModal("modal-dropbox");
    renderDropbox({ connected: Boolean(dropboxService?.connected) });
    if (dropboxService?.connected) browseDropbox("");
  });
  fileInput?.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    if (!files.length || !localLibrary) return;
    const progress = document.getElementById("import-progress");
    try {
      if (progress) { progress.hidden = false; progress.textContent = `Importing ${files.length} file${files.length === 1 ? "" : "s"}…`; }
      const imported = await localLibrary.importFiles(files, {
        source: "computer",
        onProgress: ({ current, total, name }) => {
          if (progress) progress.textContent = `Importing ${current}/${total}: ${name}`;
        },
      });
      await refreshLocalFilesAfterImport(imported.length);
      closeModals();
      openModal("modal-library");
      await openLibrarySource("local-files", { force: true });
    } catch (error) {
      showToast(humanizeError(error));
    } finally {
      if (progress) progress.hidden = true;
    }
  });
}

function bindLibraryCreate() {
  document.getElementById("lib-new")?.addEventListener("click", () => openCreatePlaylistModal());
}


async function refreshLocalFilesAfterImport(count = 0) {
  localTracks = await localLibrary.listTracks({ coverLimit: 32 });
  const source = localSource(localTracks);
  librarySources = mergeLocalSource(librarySources, source);
  if (selectedLibrarySource?.kind === "local") {
    selectedLibrarySource = source;
    selectedLibraryItems = localTracks.map(normalizeLocalLibraryEntry);
    selectedLibraryDurationMs = selectedLibraryItems.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
    renderSelectedLibrary();
  }
  if (count) showToast(`Added ${count} song${count === 1 ? "" : "s"} to Local Files.`);
}

async function openPlaylistPicker(track) {
  playlistPickerCreateOnly = false;
  const uri = track?.uri || "";
  playlistPickerTrack = track && /^(?:spotify:track|spoot:local):/u.test(uri) ? {
    id: track.id || track.localId || uri.split(":").pop(),
    localId: track.localId || localIdFromUri(uri),
    uri,
    title: track.title || "Song",
    isLocal: uri.startsWith("spoot:local:"),
  } : null;
  if (!playlistPickerTrack) {
    showToast("Choose a song before adding it to a playlist.");
    return;
  }
  playlistPickerMemberships = new Map();
  resetPlaylistCreateForm();
  openModal("modal-playlist");

  if (!playlistPickerService) {
    renderPlaylistPicker({ track: playlistPickerTrack, status: "error", message: "Log in again to approve playlist permissions." });
    return;
  }
  renderPlaylistPicker({ track: playlistPickerTrack, status: "loading" });
  try {
    playlistPickerSources = await playlistPickerService.loadDestinations();
    renderPlaylistPicker({
      track: playlistPickerTrack,
      sources: playlistPickerSources,
      memberships: playlistPickerMemberships,
    });
    focusPlaylistPicker();
  } catch (error) {
    renderPlaylistPicker({ track: playlistPickerTrack, status: "error", message: humanizeError(error) });
  }
}


async function checkPlaylistPickerMembership(source) {
  if (!source || !playlistPickerTrack || !playlistPickerService) return;
  const current = playlistPickerMemberships.get(source.id);
  if (["checking", "ready", "saving"].includes(current?.status)) return;
  const pending = { status: "checking", value: Boolean(current?.value) };
  playlistPickerMemberships.set(source.id, pending);
  updatePlaylistPickerMembership(source.id, pending);
  try {
    const value = await playlistPickerService.membership(source, playlistPickerTrack);
    const ready = { status: "ready", value };
    playlistPickerMemberships.set(source.id, ready);
    updatePlaylistPickerMembership(source.id, ready);
  } catch (error) {
    const failed = { status: "error", value: false };
    playlistPickerMemberships.set(source.id, failed);
    updatePlaylistPickerMembership(source.id, failed);
  }
}

async function togglePlaylistPickerMembership(source) {
  if (!source || !playlistPickerTrack || !playlistPickerService) return;
  let current = playlistPickerMemberships.get(source.id);
  if (!current || current.status === "unknown" || current.status === "error") {
    await checkPlaylistPickerMembership(source);
    current = playlistPickerMemberships.get(source.id);
  }
  if (current?.status !== "ready") return;
  const desired = !current.value;
  const saving = { status: "saving", value: current.value };
  playlistPickerMemberships.set(source.id, saving);
  updatePlaylistPickerMembership(source.id, saving);
  try {
    const mergedItems = source.id === selectedLibrarySource?.id
      ? selectedLibraryItems
      : catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === source.id
        ? catalogCurrent.result.items
        : undefined;
    await playlistPickerService.setMembership(source, playlistPickerTrack, desired, { mergedItems });
    const ready = { status: "ready", value: desired };
    playlistPickerMemberships.set(source.id, ready);
    updatePlaylistPickerMembership(source.id, ready);
    await refreshVisiblePlaylistAfterMutation(source.id);
    showToast(desired ? `Added to ${source.name}.` : `Removed from ${source.name}.`);
  } catch (error) {
    playlistPickerMemberships.set(source.id, current);
    updatePlaylistPickerMembership(source.id, current);
    showToast(humanizeError(error));
  }
}


function createPlaylistFromPicker() {
  return openCreatePlaylistModal();
}



function openCreatePlaylistModal() {
  playlistCreateTrack = playlistPickerTrack;
  prepareCreatePlaylist({ track: playlistCreateTrack });
  openModal("modal-playlist-create");
}

async function createPlaylistFromEditor({ name, description, public: isPublic, coverFile, track } = {}) {
  if (!playlistPickerService) {
    showToast("Log in to Spotify before creating a playlist.");
    return;
  }
  setPlaylistEditorBusy("create", true, "Creating playlist…");
  try {
    const source = await playlistPickerService.createPlaylist({
      name,
      description,
      public: isPublic,
    });
    if (coverFile && playlistService) {
      const prepared = await preparePlaylistCover(coverFile);
      await playlistService.uploadCover(source.id, prepared);
    }
    if (track?.uri) {
      await playlistPickerService.setMembership(source, track, true);
    }
    playlistPickerSources = [source, ...playlistPickerSources.filter((item) => item.id !== source.id)];
    librarySources = mergeLocalSource(libraryService?.sources || librarySources, localLibrary ? localSource(localTracks) : null);
    playlistPickerMemberships.set(source.id, { status: "ready", value: Boolean(track) });
    closeModals();
    showToast(track ? `Created ${source.name} and added the song.` : `Created ${source.name}.`);
    await refreshLibrary({ force: true });
  } catch (error) {
    setPlaylistEditorBusy("create", false, humanizeError(error));
    showToast(humanizeError(error));
    return;
  }
  setPlaylistEditorBusy("create", false);
}

function openEditPlaylistModal(playlistId) {
  const playlist = findPlaylistModel(playlistId);
  if (!playlist?.owned) {
    showToast("Only playlists you own can have their details edited.");
    return;
  }
  playlistEditTarget = playlist;
  prepareEditPlaylist(playlist);
  openModal("modal-playlist-edit");
}

async function updatePlaylistFromEditor({ playlist, name, description, public: isPublic, coverFile } = {}) {
  if (!playlistService || !playlist?.id) return;
  setPlaylistEditorBusy("edit", true, "Saving playlist…");
  try {
    await playlistService.updateDetails(playlist.id, { name, description, public: isPublic });
    if (coverFile) {
      const prepared = await preparePlaylistCover(coverFile);
      await playlistService.uploadCover(playlist.id, prepared);
    }
    updatePlaylistModels(playlist.id, {
      name,
      description,
      public: isPublic,
      ...(coverFile ? { artworkUrl: null } : {}),
    });
    closeModals();
    showToast("Playlist details saved.");
    await refreshVisiblePlaylistAfterMutation(playlist.id, { force: true });
  } catch (error) {
    setPlaylistEditorBusy("edit", false, humanizeError(error));
    showToast(humanizeError(error));
    return;
  }
  setPlaylistEditorBusy("edit", false);
}

function findPlaylistModel(playlistId) {
  const id = String(playlistId || "");
  if (catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === id) {
    return catalogCurrent.result.playlist;
  }
  if (selectedLibrarySource?.id === id) return selectedLibrarySource;
  return librarySources.find((source) => source.id === id) || null;
}

function updatePlaylistModels(playlistId, patch) {
  const id = String(playlistId || "");
  librarySources = librarySources.map((source) => source.id === id ? { ...source, ...patch } : source);
  if (selectedLibrarySource?.id === id) selectedLibrarySource = { ...selectedLibrarySource, ...patch };
  if (catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === id) {
    catalogCurrent.result.playlist = { ...catalogCurrent.result.playlist, ...patch };
  }
}

async function refreshVisiblePlaylistAfterMutation(playlistId, { force = false } = {}) {
  playlistService?.invalidate?.(playlistId);
  libraryService?.invalidateSource?.(playlistId);
  if (catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === playlistId) {
    await loadCatalogEntry(catalogCurrent, { force: true });
  }
  if (selectedLibrarySource?.id === playlistId) {
    await openLibrarySource(playlistId, { force: true });
  }
  if (selectedLibrarySource?.id === "liked-songs" && playlistId === "liked-songs") {
    await openLibrarySource("liked-songs", { force: true });
  }
}

async function reorderCatalogPlaylistItem({ playlistId, fromIndex, toIndex }) {
  return reorderMergedPlaylist(playlistId, fromIndex, toIndex, {
    items: catalogCurrent?.result?.items,
    playlist: catalogCurrent?.result?.playlist,
  });
}

async function reorderLibraryPlaylistItem({ sourceId, fromIndex, toIndex }) {
  return reorderMergedPlaylist(sourceId, fromIndex, toIndex, {
    items: selectedLibraryItems,
    playlist: selectedLibrarySource,
  });
}

async function reorderMergedPlaylist(playlistId, fromIndex, toIndex, { items, playlist } = {}) {
  if (!Array.isArray(items) || fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return;
  const original = [...items];
  const moved = original[fromIndex];
  const reordered = [...original];
  reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  applyMergedItemsToVisiblePlaylist(playlistId, reordered);
  try {
    if (isLocalEntry(moved)) {
      await hybridService.saveMergedOrder(playlistId, reordered);
    } else {
      if (!playlist?.canModifyItems) throw new Error("Spotify does not allow Spoot to reorder this playlist.");
      const originalSpotify = original.filter((item) => !isLocalEntry(item));
      const reorderedSpotify = reordered.filter((item) => !isLocalEntry(item));
      const remoteOrderChanged = originalSpotify.some((item, index) => item !== reorderedSpotify[index]);
      if (remoteOrderChanged) {
        const fromSpotify = originalSpotify.indexOf(moved);
        const targetSpotify = reorderedSpotify.indexOf(moved);
        const insertBefore = targetSpotify > fromSpotify ? targetSpotify + 1 : targetSpotify;
        await playlistService.reorder(playlistId, {
          rangeStart: fromSpotify,
          insertBefore,
          snapshotId: playlist.snapshotId || null,
        });
      }
      // Moving a Spotify row across only local rows does not alter Spotify's
      // remote sequence; in that case only the local placement anchors change.
      await hybridService.saveMergedOrder(playlistId, reordered);
    }
    showToast("Playlist order updated.");
    await refreshVisiblePlaylistAfterMutation(playlistId, { force: true });
  } catch (error) {
    applyMergedItemsToVisiblePlaylist(playlistId, original);
    showToast(humanizeError(error));
  }
}

async function removeCatalogPlaylistItem({ playlistId, index }) {
  return removeMergedPlaylistItem(playlistId, index, {
    items: catalogCurrent?.result?.items,
    playlist: catalogCurrent?.result?.playlist,
  });
}

async function removeLibraryPlaylistItem({ sourceId, index }) {
  return removeMergedPlaylistItem(sourceId, index, {
    items: selectedLibraryItems,
    playlist: selectedLibrarySource,
  });
}

async function removeMergedPlaylistItem(playlistId, index, { items, playlist } = {}) {
  if (!Array.isArray(items) || index < 0 || index >= items.length) return;
  const entry = items[index];
  const next = items.filter((_, itemIndex) => itemIndex !== index);
  try {
    if (isLocalEntry(entry)) {
      await hybridService.setLocalTrackMembership(playlistId, entry.localId || localIdFromUri(entry.uri), false);
      await hybridService.saveMergedOrder(playlistId, next);
    } else if (playlistId === "liked-songs") {
      await playlistPickerService.setMembership({ id: "liked-songs", kind: "liked", name: "Liked Songs" }, entry, false);
    } else {
      if (!playlist?.canModifyItems) throw new Error("Spotify does not allow Spoot to remove songs from this playlist.");
      await playlistService.removeItem(playlistId, entry, { snapshotId: playlist.snapshotId || null });
      await hybridService.saveMergedOrder(playlistId, next);
    }
    applyMergedItemsToVisiblePlaylist(playlistId, next);
    showToast(`Removed ${entry.title || "song"} from the playlist.`);
    await refreshVisiblePlaylistAfterMutation(playlistId, { force: true });
  } catch (error) {
    showToast(humanizeError(error));
  }
}

function applyMergedItemsToVisiblePlaylist(playlistId, items) {
  const durationMs = items.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
  if (catalogCurrent?.kind === "playlist" && catalogCurrent.result?.playlist?.id === playlistId) {
    catalogCurrent.result.items = items;
    catalogCurrent.result.durationMs = durationMs;
    catalogCurrent.result.playlist.total = items.length;
    renderCatalogCurrent({ animate: false });
  }
  if (selectedLibrarySource?.id === playlistId) {
    selectedLibraryItems = items;
    selectedLibraryDurationMs = durationMs;
    selectedLibrarySource.total = items.length;
    renderSelectedLibrary();
  }
}

async function deleteLocalTrack(localId) {
  const track = localTracks.find((item) => item.id === localId);
  if (!track) return;
  if (!confirm(`Delete “${track.title}” from Local Files and every Spoot playlist?`)) return;
  try {
    if (currentPlayback?.itemUri === track.uri) await localController?.pause?.();
    await Promise.all([
      hybridService?.removeLocalTrackEverywhere(localId),
      lyricsService?.clear?.(track),
    ]);
    await localLibrary.deleteTrack(localId);
    if (hybridSession) {
      const nextItems = hybridSession.items.filter((entry) => (
        !isLocalEntry(entry) || (entry.localId || localIdFromUri(entry.uri)) !== localId
      ));
      const removedBeforeCurrent = hybridSession.items
        .slice(0, hybridSession.index)
        .some((entry) => isLocalEntry(entry) && (entry.localId || localIdFromUri(entry.uri)) === localId);
      hybridSession.items = nextItems;
      if (removedBeforeCurrent) hybridSession.index = Math.max(0, hybridSession.index - 1);
      if (!nextItems.length) hybridSession = null;
    }
    localTracks = await localLibrary.listTracks({ coverLimit: 32 });
    librarySources = mergeLocalSource(librarySources, localSource(localTracks));
    if (selectedLibrarySource?.kind === "local") await openLibrarySource("local-files", { force: true });
    if (catalogCurrent?.kind === "playlist") await loadCatalogEntry(catalogCurrent, { force: true });
    showToast("Local file deleted.");
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function connectDropbox() {
  try {
    await dropboxService?.beginConnect();
    renderDropbox({ connected: false, message: "Dropbox opened in a new tab. Paste the returned code here." });
  } catch (error) {
    showToast(humanizeError(error));
  }
}

async function finishDropboxConnection(code) {
  if (!code) return showToast("Paste the Dropbox authorization code first.");
  try {
    await dropboxService.finishConnect(code);
    showToast("Dropbox connected.");
    await browseDropbox("", { mode: dropboxBrowseMode });
  } catch (error) {
    renderDropbox({ connected: false, message: humanizeError(error) });
  }
}

function disconnectDropbox() {
  dropboxService?.disconnect();
  renderDropbox({ connected: false });
  showToast("Dropbox disconnected.");
}

async function browseDropbox(path = "", { mode = dropboxBrowseMode, force = false } = {}) {
  dropboxBrowseMode = mode === "lyrics" ? "lyrics" : "audio";
  if (!dropboxService?.connected) {
    renderDropbox({ connected: false, mode: dropboxBrowseMode });
    openModal("modal-dropbox");
    return;
  }
  renderDropbox({ connected: true, status: "loading", path, mode: dropboxBrowseMode });
  openModal("modal-dropbox");
  try {
    const entries = await dropboxService.list(path, { mode: dropboxBrowseMode, force });
    renderDropbox({ connected: true, status: "ready", path, entries, mode: dropboxBrowseMode });
  } catch (error) {
    renderDropbox({ connected: true, status: "error", path, message: humanizeError(error), mode: dropboxBrowseMode });
  }
}

async function importDropboxFile({ path, name, mode = dropboxBrowseMode }) {
  if (!path) return;
  try {
    if (mode === "lyrics") {
      const blob = await dropboxService.download(path);
      deliverImportedLyrics(await blob.text());
      return;
    }
    if (!localLibrary) return;
    showToast(`Importing ${name}…`);
    const blob = await dropboxService.download(path);
    await localLibrary.importBlob(blob, name, { source: "dropbox" });
    await refreshLocalFilesAfterImport(1);
  } catch (error) {
    showToast(humanizeError(error));
  }
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
      const target = activeController();
      try {
        await target?.setVolume?.(currentVolume);
      } catch (error) {
        showToast(humanizeError(error));
        target?.refreshVolume?.().catch(() => {});
      }
    }, 70);
  });
}

function renderVolume() {
  const { volumeRange, volumeValue } = getElements();
  if (!volumeRange || !volumeValue) return;
  const volume = Math.min(1, Math.max(0, Number(currentVolume) || 0));
  volumeRange.value = String(volume);
  volumeRange.disabled = !activeController();
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
  if (playbackMode === "local") localController?.setSpeed?.(soundSettings.speed).catch(() => {});
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
    analysisEnabled: ambientAudioReaction,
  });
}

function renderSoundSettings() {
  const elements = getElements();
  const speed = Math.min(2.5, Math.max(0.25, Number(soundSettings.speed) || 1));
  const reverb = Math.min(1, Math.max(0, Number(soundSettings.reverb) || 0));
  const captured = audioEffects.hasCapture();
  const localActive = playbackMode === "local";

  if (elements.speedRange) {
    elements.speedRange.value = String(speed);
    elements.speedRange.disabled = !(captured || localActive);
  }
  if (elements.speedValue) elements.speedValue.textContent = `${speed.toFixed(2)}x`;
  if (elements.reverbRange) {
    elements.reverbRange.value = String(reverb);
    elements.reverbRange.disabled = !(captured || localActive);
  }
  if (elements.reverbValue) elements.reverbValue.textContent = `${Math.round(reverb * 100)}%`;
  if (elements.soundCaptureStatus) {
    elements.soundCaptureStatus.textContent = localActive
      ? "Local file playback — speed is available"
      : captured
        ? "Audio output captured"
        : "Spotify audio is not exposed to page capture";
  }
  if (elements.eqValue) {
    elements.eqValue.textContent = soundSettings.eqPreset === "Flat"
      ? "Flat"
      : soundSettings.eqPreset || "Custom";
  }

  elements.eqSliders.forEach((slider, index) => {
    slider.value = String(soundSettings.eq[index] ?? 0);
    slider.disabled = !(captured || localActive);
  });
  elements.eqPresets?.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === soundSettings.eqPreset);
    button.disabled = !(captured || localActive);
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
  applySoundSettings();
  updateAmbientLoop();
  saveUiPreferences();
}

function renderPreferenceToggle(toggle, active) {
  if (!toggle) return;
  toggle.classList.toggle("on", Boolean(active));
  toggle.setAttribute("aria-checked", String(Boolean(active)));
}

async function runMediaCommand(command) {
  if (!activeController() || !currentPlayback?.activeDevice) return;
  try { await command(); } catch (error) { showToast(humanizeError(error)); }
}

function bindPlaybackButtons() {
  const elements = getElements();
  bindCommand([elements.play, elements.immersivePlay], togglePlayback);
  bindCommand([elements.previous, elements.immersivePrevious], previousPlayback);
  bindCommand([elements.next, elements.immersiveNext], nextPlayback);
  for (const shuffle of [elements.shuffle, elements.immersiveShuffle].filter(Boolean)) {
    shuffle.disabled = true;
    shuffle.setAttribute("aria-disabled", "true");
    shuffle.title = "Shuffle is disabled while Spoot develops hybrid playlist playback";
  }
  bindCommand([elements.repeat, elements.immersiveRepeat], cycleRepeatPlayback);
}

function bindCommand(elements, command) {
  for (const element of elements.filter(Boolean)) {
    element.addEventListener("click", async () => {
      if (!activeController()) {
        showToast("Choose a local song or connect Spotify first.");
        return;
      }
      try { await command(); } catch (error) { showToast(humanizeError(error)); }
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
  surface.addEventListener("pointermove", (event) => { if (dragging) preview(event.clientX); });
  surface.addEventListener("pointerup", async (event) => {
    if (!dragging) return;
    dragging = false;
    preview(event.clientX);
    try { await activeController()?.seek(previewPosition); }
    catch (error) { renderPlayback(currentPlayback); showToast(humanizeError(error)); }
  });
  surface.addEventListener("keydown", async (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const target = activeController();
    if (!target || !currentPlayback?.durationMs) return;
    event.preventDefault();
    const delta = event.shiftKey ? 15_000 : 5_000;
    const position = event.key === "Home" ? 0 : event.key === "End" ? currentPlayback.durationMs : currentPlayback.positionMs + (event.key === "ArrowRight" ? delta : -delta);
    try { await target.seek(position); } catch (error) { showToast(humanizeError(error)); }
  });
}

function bindDock() {
  getElements().dockQueue?.addEventListener("click", () => {
    queueVisible = !queueVisible;
    setQueueVisible(queueVisible);
    saveUiPreferences();
    if (queueVisible) activeController()?.refreshQueue?.().catch(() => {});
  });
}

async function executeCommand(command) {
  const { name, args, argument } = command;
  const requirePlayback = () => {
    const target = activeController();
    if (!target || !currentPlayback?.activeDevice) {
      throw new Error("Choose a local song or use Spoot as the active Spotify device first.");
    }
    return target;
  };

  if (name === "help" || name === "?") {
    return {
      keepOpen: true,
      message: "play [song/artist/album/playlist] · pause · next · prev · seek 1:20/+30 · volume 65 · repeat off/context/track · queue [song] · open artist/album/song/playlist · search · library · lyrics · fullscreen · device",
    };
  }
  if (name === "play" && !argument) { requirePlayback(); await togglePlayback(); return; }
  if (name === "pause") {
    requirePlayback();
    if (currentPlayback?.isPlaying) await togglePlayback();
    return;
  }
  if (name === "next") { requirePlayback(); await nextPlayback(); return; }
  if (name === "prev") { requirePlayback(); await previousPlayback(); return; }
  if (name === "seek") {
    const targetController = requirePlayback();
    const target = parseSeekArgument(argument, currentPlayback?.positionMs || 0);
    if (target === null) throw new Error("Use seek 1:20, seek 75, seek +30, or seek -15.");
    await targetController.seek(target);
    return;
  }
  if (name === "volume") {
    const target = requirePlayback();
    const numeric = Number(argument.replace(/%$/u, ""));
    if (!Number.isFinite(numeric)) throw new Error("Use volume 0-100.");
    const volume = numeric > 1 ? numeric / 100 : numeric;
    await target.setVolume(Math.max(0, Math.min(1, volume)));
    return;
  }
  if (name === "speed") {
    const numeric = Number(argument.replace(/x$/iu, ""));
    if (!Number.isFinite(numeric)) throw new Error("Use speed 0.5-2.5.");
    setPlaybackSpeed(numeric);
    return;
  }
  if (name === "shuffle") {
    throw new Error("Shuffle is temporarily disabled while Spoot develops hybrid playlist playback.");
  }
  if (name === "repeat") {
    requirePlayback();
    const value = argument.toLowerCase();
    const mode = value === "all" ? "context" : value === "one" ? "track" : value;
    if (!mode) await cycleRepeatPlayback();
    else if (["off", "context", "track"].includes(mode)) await setRepeatPlayback(mode);
    else throw new Error("Use repeat off, repeat context, or repeat track.");
    return;
  }
  if (name === "queue") {
    if (!argument) {
      queueVisible = !queueVisible;
      setQueueVisible(queueVisible);
      saveUiPreferences();
      if (queueVisible) await activeController()?.refreshQueue?.();
      return;
    }
    if (!controller) throw new Error("Log in to Spotify to search and add to its queue.");
    const results = await commandSearch(argument);
    const track = results.tracks?.[0];
    if (!track?.uri) throw new Error(`No playable song found for “${argument}”.`);
    await controller.addToQueue(track.uri);
    showToast(`Queued ${track.title}.`);
    return;
  }
  if (name === "search") {
    openModal("modal-search");
    if (argument) await searchSpotify(argument);
    else renderCatalogCurrent({ animate: false });
    focusSearch();
    return;
  }
  if (name === "open") { await executeOpenCommand(args); return; }
  if (name === "library") { openModal("modal-library"); return; }
  if (name === "lyrics") {
    lyricsVisible = !lyricsVisible;
    setLyricsVisible(lyricsVisible);
    saveUiPreferences();
    return;
  }
  if (name === "fullscreen") { toggleImmersive(); return; }
  if (name === "settings") { openModal("modal-settings"); return; }
  if (name === "sound") { openModal("modal-eq"); return; }
  if (name === "device") { await executeDeviceCommand(argument); return; }
  if (name === "status") {
    return { keepOpen: true, message: currentPlayback?.title ? `${currentPlayback.title} — ${currentPlayback.artist || "Unknown artist"} · ${currentPlayback.isPlaying ? "playing" : "paused"} · ${playbackMode}` : "Nothing is playing." };
  }
  if (name === "play") { await executePlayCommand(args); return; }

  await executePlayCommand([command.raw]);
}

async function executePlayCommand(args) {
  const requestedType = normalizeCatalogType(args[0]);
  const query = requestedType ? args.slice(1).join(" ") : args.join(" ");
  if (!query) throw new Error("Add a song, artist, album, or playlist name after play.");
  const results = await commandSearch(query);
  const item = chooseCommandResult(results, requestedType);
  if (!item) throw new Error(`No playable Spotify result found for “${query}”.`);
  if (item.type === "track") await playTrackNow({ uri: item.uri });
  else await playTrackNow({ contextUri: item.contextUri, contextOnly: true });
}

async function executeOpenCommand(args) {
  let requestedType = normalizeCatalogType(args[0]);
  let query = requestedType ? args.slice(1).join(" ") : args.join(" ");
  if (query.toLowerCase() === "current" || (!query && requestedType)) {
    const current = currentPlayback?.currentItem || currentPlayback?.item;
    if (requestedType === "album" && current?.albumId) return navigateCatalog("album", { id: current.albumId });
    if (requestedType === "artist" && current?.artists?.[0]?.id) return navigateCatalog("artist", { id: current.artists[0].id });
    if (requestedType === "track" && current?.id) return navigateCatalog("track", { id: current.id });
    throw new Error("The current item does not expose that Spotify page.");
  }
  if (!query) throw new Error("Use open artist, open album, open song, or open playlist followed by a name.");
  const results = await commandSearch(query);
  const item = chooseCommandResult(results, requestedType, { requireBrowseable: true });
  if (!item?.id) throw new Error(`No matching Spotify page found for “${query}”.`);
  requestedType = item.type === "track" ? "track" : item.type;
  navigateCatalog(requestedType, { id: item.id });
}

async function executeDeviceCommand(argument) {
  if (!controller) throw new Error("Connect Spotify first.");
  const query = argument.trim().toLowerCase();
  if (!query) {
    openModal("modal-settings");
    await refreshDevices();
    return;
  }
  if (["spoot", "here", "browser"].includes(query)) return transferHere();
  if (!currentDevices.length) await refreshDevices();
  const device = currentDevices.find((candidate) => candidate.name?.toLowerCase().includes(query));
  if (!device) throw new Error(`No Spotify device matched “${argument}”.`);
  await transferToDevice(device.id);
}

async function commandSearch(query) {
  if (!searchService) throw new Error("Log in to Spotify before searching.");
  return searchService.search(String(query || "").trim());
}

function chooseCommandResult(results, requestedType, { requireBrowseable = false } = {}) {
  const group = requestedType === "track"
    ? results.tracks
    : requestedType === "artist"
      ? results.artists
      : requestedType === "album"
        ? results.albums
        : requestedType === "playlist"
          ? results.playlists
          : [...(results.tracks || []), ...(results.artists || []), ...(results.albums || []), ...(results.playlists || [])];
  return (group || []).find((item) => (
    (!requireBrowseable || item.browseable !== false) &&
    (requireBrowseable ? Boolean(item.id) : Boolean(item.uri || item.contextUri))
  )) || null;
}

function normalizeCatalogType(value) {
  const normalized = String(value || "").toLowerCase();
  if (["song", "track"].includes(normalized)) return "track";
  if (["artist", "album", "playlist"].includes(normalized)) return normalized;
  if (["single", "release"].includes(normalized)) return "album";
  return null;
}

function bindKeyboard() {
  window.addEventListener("keydown", async (event) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey && event.shiftKey && event.code === "Slash") {
      event.preventDefault();
      if (isCommandPaletteOpen()) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.code === "KeyH") {
      event.preventDefault();
      if (config?.mock || auth?.hasSession() || localTracks.length) toggleHiddenMode({ userInitiated: true });
      else showToast("Play or import something before using hidden mode.");
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (document.body.classList.contains("hidden-mode")) return;

    if (event.code === "Space") {
      event.preventDefault();
      await runKeyboardCommand(togglePlayback);
    } else if (event.code === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      await runKeyboardCommand(nextPlayback);
    } else if (event.code === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      await runKeyboardCommand(previousPlayback);
    } else if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      const delta = event.code === "ArrowRight" ? 5_000 : -5_000;
      await runKeyboardCommand(() => activeController()?.seek((currentPlayback?.positionMs || 0) + delta));
    } else if (event.code === "ArrowUp" || event.code === "ArrowDown") {
      event.preventDefault();
      if (event.shiftKey) {
        const delta = event.code === "ArrowUp" ? 0.05 : -0.05;
        setPlaybackSpeed(soundSettings.speed + delta);
        showToast(`Speed ${soundSettings.speed.toFixed(2)}x`);
      } else {
        const delta = event.code === "ArrowUp" ? 0.05 : -0.05;
        await runKeyboardCommand(() => activeController()?.setVolume(
          Math.min(1, Math.max(0, currentVolume + delta)),
        ));
      }
    } else if (event.code === "KeyQ") {
      queueVisible = !queueVisible;
      setQueueVisible(queueVisible);
      saveUiPreferences();
      if (queueVisible) activeController()?.refreshQueue?.().catch(() => {});
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
      if (config?.mock || auth?.hasSession() || localTracks.length) toggleHiddenMode({ userInitiated: true });
      else showToast("Play or import something before using hidden mode.");
    } else if (event.code === "KeyA") {
      openModal("modal-import");
    } else if (event.key === "/") {
      event.preventDefault();
      openModal("modal-search");
      renderCatalogCurrent({ animate: false });
      focusSearch();
    } else if (event.code === "Tab" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openModal("modal-library");
    } else if (event.code === "KeyS") {
      openModal(event.shiftKey ? "modal-eq" : "modal-settings");
    } else if (event.key === "Escape") {
      if (isCommandPaletteOpen()) closeCommandPalette();
      else if (isImmersiveOpen()) closeImmersive();
      else if (isModalOpen()) closeModals();
    }
  });
}

async function runKeyboardCommand(command) {
  if (!activeController() || !currentPlayback?.activeDevice) {
    showToast("Choose a local song or use Spoot as the active Spotify device first.");
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

function humanizeArtistError(error) {
  if (error instanceof SpotifyApiError && error.status === 404) {
    return "Spotify could not find that artist.";
  }
  if (error instanceof SpotifyApiError && error.status === 429) {
    return "Spotify is rate limiting artist requests. Try again shortly.";
  }
  return humanizeError(error);
}

function humanizeTrackError(error) {
  if (error instanceof SpotifyApiError && error.status === 404) {
    return "Spotify could not find that song.";
  }
  if (error instanceof SpotifyApiError && error.status === 429) {
    return "Spotify is rate limiting song requests. Try again shortly.";
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
      return "Spotify did not grant every permission Spoot needs. Log in and approve all requested access.";
    }
    if (error.code === "invalid_state") {
      if (error.details?.reason === "missing_transaction") {
        return "Spotify returned, but this tab lost the temporary login verifier. Close other Spoot tabs, reload, and try again.";
      }
      if (error.details?.reason === "state_mismatch") {
        return "Spotify returned a different login state. Close other Spoot tabs, reload, and try again.";
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
