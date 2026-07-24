export const AUDIO_EQ_BANDS = [60, 150, 400, 1000, 2400, 6000, 9000, 14000];

export const AUDIO_EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [7, 6, 4, 1, 0, 0, 0, 0],
  Vocal: [-2, -1, 1, 3, 4, 3, 1, 0],
  Treble: [0, 0, 0, 0, 2, 4, 6, 7],
  "Lo-Fi": [4, 3, 0, -2, -4, -6, -9, -12],
  Podcast: [-4, -2, 2, 4, 3, 2, 0, -2],
};

const DEFAULTS = {
  speed: 1,
  reverb: 0,
  eqEnabled: true,
  eq: AUDIO_EQ_PRESETS.Flat,
};

export function createAudioEffectsController({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  onCaptureChange,
  child = false,
} = {}) {
  const mediaElements = new Set();
  const chains = new Set();
  const frameControllers = new Map();
  const elementChains = new WeakMap();
  const sourceChains = new WeakMap();
  const internalConnect = new WeakSet();
  const state = normalizeSettings(DEFAULTS);
  const AudioContextClass = windowRef?.AudioContext || windowRef?.webkitAudioContext;

  let installed = false;
  let observer;
  let context;
  let internalRateSet = false;
  let lastCaptureCount = 0;
  let nativeConnect;

  function install() {
    if (installed || !windowRef || !documentRef) return api;
    installed = true;

    patchMediaElementSource();
    patchAudioNodeConnect();
    patchMediaCreation();
    bindMediaEvents();
    startObserver();
    queueMicrotask(() => scanMedia("install"));
    if (!child) queueMicrotask(() => scanFrames("install"));
    return api;
  }

  function setSettings(next = {}) {
    const normalized = normalizeSettings({ ...state, ...next });
    const reverbConnectionChanged = (state.reverb > 0) !== (normalized.reverb > 0);
    Object.assign(state, normalized);
    applyToKnownMedia("settings");
    applyToCapturedChains({ reroute: reverbConnectionChanged });
  }

  function getSettings() {
    return {
      speed: state.speed,
      reverb: state.reverb,
      eqEnabled: state.eqEnabled,
      eq: state.eq.slice(),
    };
  }

  function getFrequencyData() {
    for (const chain of chains) {
      if (!isActiveMedia(chain.el)) continue;
      chain.analyser.getByteFrequencyData(chain.freqData);
      return chain.freqData;
    }
    for (const controller of frameControllers.values()) {
      const data = controller.getFrequencyData();
      if (data) return data;
    }
    return null;
  }

  function hasCapture() {
    if (chains.size > 0) return true;
    for (const controller of frameControllers.values()) {
      if (controller.hasCapture()) return true;
    }
    return false;
  }

  function hasPlayingMedia() {
    for (const el of mediaElements) {
      if (isActiveMedia(el)) return true;
    }
    for (const controller of frameControllers.values()) {
      if (controller.hasPlayingMedia()) return true;
    }
    return false;
  }

  function scanMedia(reason = "scan") {
    documentRef.querySelectorAll?.("audio, video").forEach((el) => applyToMedia(el, reason));
    if (!child) scanFrames(reason);
  }

  function scanFrames(reason = "frames") {
    documentRef.querySelectorAll?.("iframe").forEach((frame) => installFrame(frame, reason));
  }

  function installFrame(frame, reason) {
    if (frameControllers.has(frame)) return;
    try {
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument || frameWindow?.document;
      if (!frameWindow || !frameDocument) return;
      const controller = createAudioEffectsController({
        windowRef: frameWindow,
        documentRef: frameDocument,
        onCaptureChange: emitCaptureChange,
        child: true,
      });
      frameControllers.set(frame, controller.install());
      controller.setSettings(state);
      controller.scan(reason);
    } catch {}
  }

  function getAudioContext() {
    if (context) return context;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  function resumeContext(ctx) {
    try {
      if (ctx?.state === "suspended") ctx.resume().catch(() => {});
    } catch {}
  }

  function applyPitch(el) {
    try {
      if ("preservesPitch" in el) el.preservesPitch = false;
      if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = false;
      if ("mozPreservesPitch" in el) el.mozPreservesPitch = false;
    } catch {}
  }

  function applySpeed(el) {
    if (!(el instanceof windowRef.HTMLMediaElement)) return;
    const rate = state.speed;
    internalRateSet = true;
    try {
      if (Math.abs((Number(el.playbackRate) || 1) - rate) > 0.001) el.playbackRate = rate;
      if (Math.abs((Number(el.defaultPlaybackRate) || 1) - rate) > 0.001) el.defaultPlaybackRate = rate;
      applyPitch(el);
    } catch (error) {
      console.warn("Spool could not apply playback speed.", error);
    } finally {
      internalRateSet = false;
    }
  }

  function applyEqToChain(chain) {
    chain.filters.forEach((filter, index) => {
      filter.type = filterType(index, chain.filters.length);
      filter.frequency.value = AUDIO_EQ_BANDS[index];
      filter.Q.value = 1;
      filter.gain.value = state.eqEnabled ? state.eq[index] || 0 : 0;
    });
    chain.wetGain.gain.value = state.reverb * 0.85;
  }

  function makeChain(ctx, el, source, mode) {
    const existing = elementChains.get(el);
    if (existing) return existing;

    const chain = {
      ctx,
      el,
      source,
      mode,
      filters: AUDIO_EQ_BANDS.map((frequency, index) => {
        const filter = ctx.createBiquadFilter();
        filter.type = filterType(index, AUDIO_EQ_BANDS.length);
        filter.frequency.value = frequency;
        filter.Q.value = 1;
        return filter;
      }),
      analyser: ctx.createAnalyser(),
      convolver: ctx.createConvolver(),
      wetGain: ctx.createGain(),
      outputArgs: null,
      originalConnect: null,
      freqData: null,
    };
    chain.analyser.fftSize = 1024;
    chain.analyser.smoothingTimeConstant = 0.82;
    chain.freqData = new Uint8Array(chain.analyser.frequencyBinCount);
    chain.convolver.buffer = makeImpulseResponse(ctx);
    chain.wetGain.gain.value = 0;

    elementChains.set(el, chain);
    sourceChains.set(source, chain);
    chains.add(chain);
    applyEqToChain(chain);
    emitCaptureChange();
    return chain;
  }

  function routeChain(chain, originalConnect, args) {
    const destination = args?.[0] || chain.ctx.destination;
    const outputArgs = destination ? [destination, ...Array.from(args || []).slice(1)] : [chain.ctx.destination];
    chain.originalConnect = originalConnect;
    chain.outputArgs = outputArgs;

    try {
      const nodes = [chain.source, ...chain.filters, chain.analyser, chain.convolver, chain.wetGain];
      nodes.forEach((node) => internalConnect.add(node));
      nodes.forEach(disconnectQuietly);

      originalConnect.call(chain.source, chain.filters[0]);
      for (let index = 0; index < chain.filters.length - 1; index += 1) {
        originalConnect.call(chain.filters[index], chain.filters[index + 1]);
      }

      const tail = chain.filters[chain.filters.length - 1];
      originalConnect.call(tail, chain.analyser);
      originalConnect.apply(chain.analyser, outputArgs);

      if (state.reverb > 0) {
        originalConnect.call(tail, chain.convolver);
        originalConnect.call(chain.convolver, chain.wetGain);
        originalConnect.apply(chain.wetGain, outputArgs);
      }
      return chain.analyser;
    } catch (error) {
      console.warn("Spool audio effects routing failed.", error);
      return originalConnect.apply(chain.source, args);
    } finally {
      [chain.source, ...chain.filters, chain.analyser, chain.convolver, chain.wetGain]
        .forEach((node) => internalConnect.delete(node));
    }
  }

  function rerouteChain(chain) {
    if (!chain.originalConnect || !chain.outputArgs) return;
    routeChain(chain, chain.originalConnect, chain.outputArgs);
  }

  function tryCreateOwnChain(el) {
    if (!(el instanceof windowRef.HTMLMediaElement) || elementChains.has(el)) {
      return elementChains.get(el) || null;
    }
    const ctx = getAudioContext();
    if (!ctx) return null;

    try {
      const source = ctx.createMediaElementSource(el);
      const chain = makeChain(ctx, el, source, "media-element");
      routeChain(chain, nativeConnect || windowRef.AudioNode.prototype.connect, [ctx.destination]);
      return chain;
    } catch {
      return elementChains.get(el) || null;
    }
  }

  function applyToMedia(el, reason = "apply") {
    if (!(el instanceof windowRef.HTMLMediaElement)) return;
    remember(el);
    applySpeed(el);
    const chain = elementChains.get(el) || (shouldCreateOwnSource(el, reason) ? tryCreateOwnChain(el) : null);
    if (chain) {
      resumeContext(chain.ctx);
      applyEqToChain(chain);
    }
  }

  function applyToKnownMedia(reason) {
    mediaElements.forEach((el) => applyToMedia(el, reason));
    scanMedia(reason);
  }

  function applyToCapturedChains({ reroute = false } = {}) {
    chains.forEach((chain) => {
      applySpeed(chain.el);
      applyEqToChain(chain);
      if (reroute) rerouteChain(chain);
      resumeContext(chain.ctx);
    });
    frameControllers.forEach((controller) => controller.setSettings(state));
  }

  function remember(el) {
    if (!(el instanceof windowRef.HTMLMediaElement)) return;
    mediaElements.add(el);
  }

  function patchMediaElementSource() {
    if (!AudioContextClass?.prototype?.createMediaElementSource) return;
    const proto = AudioContextClass.prototype;
    if (proto.__spoolCreateMediaElementSourcePatched) return;
    proto.__spoolCreateMediaElementSourcePatched = true;

    const original = proto.createMediaElementSource;
    proto.createMediaElementSource = function createMediaElementSource(el) {
      const source = original.call(this, el);
      if (el instanceof windowRef.HTMLMediaElement) {
        remember(el);
        makeChain(this, el, source, "captured-source");
        applySpeed(el);
      }
      return source;
    };
  }

  function patchAudioNodeConnect() {
    if (!windowRef.AudioNode?.prototype?.connect) return;
    const proto = windowRef.AudioNode.prototype;
    if (proto.__spoolConnectPatched) return;
    proto.__spoolConnectPatched = true;

    const original = proto.connect;
    nativeConnect = original;
    proto.connect = function connect(...args) {
      if (internalConnect.has(this)) return original.apply(this, args);
      const chain = sourceChains.get(this);
      if (chain) {
        applyEqToChain(chain);
        return routeChain(chain, original, args);
      }
      return original.apply(this, args);
    };
  }

  function patchMediaCreation() {
    const originalCreateElement = windowRef.Document?.prototype?.createElement;
    if (originalCreateElement && !windowRef.Document.prototype.__spoolCreateElementPatched) {
      windowRef.Document.prototype.__spoolCreateElementPatched = true;
      windowRef.Document.prototype.createElement = function createElement(tagName, options) {
        const el = originalCreateElement.call(this, tagName, options);
        if (["audio", "video"].includes(String(tagName || "").toLowerCase())) {
          queueMicrotask(() => applyToMedia(el, "createElement"));
        } else if (!child && String(tagName || "").toLowerCase() === "iframe") {
          el.addEventListener?.("load", () => installFrame(el, "iframe-load"));
          queueMicrotask(() => installFrame(el, "createElement"));
        }
        return el;
      };
    }

    const originalPlay = windowRef.HTMLMediaElement?.prototype?.play;
    if (originalPlay && !windowRef.HTMLMediaElement.prototype.__spoolPlayPatched) {
      windowRef.HTMLMediaElement.prototype.__spoolPlayPatched = true;
      windowRef.HTMLMediaElement.prototype.play = function play(...args) {
        applyToMedia(this, "play");
        return originalPlay.apply(this, args);
      };
    }

    const srcDescriptor = Object.getOwnPropertyDescriptor(windowRef.HTMLMediaElement.prototype, "src");
    if (srcDescriptor?.set && srcDescriptor?.get && !windowRef.HTMLMediaElement.prototype.__spoolSrcPatched) {
      windowRef.HTMLMediaElement.prototype.__spoolSrcPatched = true;
      Object.defineProperty(windowRef.HTMLMediaElement.prototype, "src", {
        configurable: true,
        enumerable: srcDescriptor.enumerable,
        get() {
          return srcDescriptor.get.call(this);
        },
        set(value) {
          srcDescriptor.set.call(this, value);
          queueMicrotask(() => applyToMedia(this, "src"));
        },
      });
    }
  }

  function bindMediaEvents() {
    ["loadedmetadata", "canplay", "play", "playing", "ratechange"].forEach((eventName) => {
      documentRef.addEventListener(
        eventName,
        (event) => {
          if (event.type === "ratechange" && internalRateSet) return;
          if (event.target instanceof windowRef.HTMLMediaElement) applyToMedia(event.target, eventName);
        },
        true,
      );
    });
  }

  function startObserver() {
    if (!windowRef.MutationObserver || observer || !documentRef.documentElement) return;
    observer = new windowRef.MutationObserver(() => scanMedia("mutation"));
    observer.observe(documentRef.documentElement, { childList: true, subtree: true });
  }

  function emitCaptureChange() {
    if (chains.size === lastCaptureCount) return;
    lastCaptureCount = chains.size;
    onCaptureChange?.({ captured: chains.size });
  }

  function shouldCreateOwnSource(el, reason) {
    return reason === "playing" || (reason === "settings" && isActiveMedia(el));
  }

  function isActiveMedia(el) {
    return el instanceof windowRef.HTMLMediaElement && !el.paused && !el.ended && el.readyState > 0;
  }

  const api = {
    install,
    setSettings,
    getSettings,
    getFrequencyData,
    hasCapture,
    hasPlayingMedia,
    scan: scanMedia,
  };
  return api;
}

function normalizeSettings(raw = {}) {
  const speed = clamp(Number(raw.speed), 0.25, 2.5, DEFAULTS.speed);
  const reverb = clamp(Number(raw.reverb), 0, 1, DEFAULTS.reverb);
  const eqEnabled = raw.eqEnabled !== false;
  const eq = AUDIO_EQ_BANDS.map((_, index) => clamp(Number(raw.eq?.[index]), -12, 12, 0));
  return { speed, reverb, eqEnabled, eq };
}

function filterType(index, total) {
  if (index === 0) return "lowshelf";
  if (index === total - 1) return "highshelf";
  return "peaking";
}

function makeImpulseResponse(ctx) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * 2.4);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * ((1 - index / length) ** 2.6);
    }
  }
  return buffer;
}

function disconnectQuietly(node) {
  try {
    node.disconnect();
  } catch {}
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
