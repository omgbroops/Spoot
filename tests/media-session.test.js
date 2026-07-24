import test from "node:test";
import assert from "node:assert/strict";

import {
  setMediaSessionPreferences,
  updateMediaSessionPosition,
} from "../src/js/ui/media-session.js";

test("Media Session position state converts Spotify milliseconds to seconds", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let observed;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaSession: {
        setActionHandler() {},
        setPositionState(value) { observed = value; },
      },
    },
  });

  try {
    setMediaSessionPreferences({ enabled: true, headphoneSkip: false });
    updateMediaSessionPosition(90_000, 180_000);
    assert.deepEqual(observed, {
      duration: 180,
      position: 90,
      playbackRate: 1,
    });
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});
