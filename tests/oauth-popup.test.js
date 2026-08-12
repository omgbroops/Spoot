import test from "node:test";
import assert from "node:assert/strict";

import { watchOAuthPopup } from "../src/js/auth/oauth-popup.js";

function popupHarness(initialHref = "about:blank") {
  let href = initialHref;
  let blocked = false;
  const popup = {
    closed: false,
    location: {
      get href() {
        if (blocked) throw new DOMException("Blocked a frame with origin", "SecurityError");
        return href;
      },
    },
  };
  return {
    popup,
    setHref(value) {
      href = value;
    },
    setBlocked(value) {
      blocked = value;
    },
  };
}

function scheduler() {
  let inspect;
  const cleared = [];
  return {
    setIntervalImpl(callback) {
      inspect = callback;
      return 17;
    },
    clearIntervalImpl(timer) {
      cleared.push(timer);
    },
    tick() {
      inspect();
    },
    cleared,
  };
}

test("OAuth popup polling captures a same-origin callback even when its document is a 403", () => {
  const harness = popupHarness();
  const timers = scheduler();
  const callbacks = [];
  harness.setBlocked(true);

  watchOAuthPopup({
    popup: harness.popup,
    expectedOrigin: "https://www.kasandbox.org/",
    onCallback: (url, source) => callbacks.push({ url, source }),
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
  });
  timers.tick();
  assert.equal(callbacks.length, 0, "Spotify's cross-origin URL stays unreadable");

  harness.setBlocked(false);
  harness.setHref("https://www.kasandbox.org/?code=spotify-code&state=expected-state");
  timers.tick();

  assert.equal(callbacks.length, 1);
  assert.equal(
    callbacks[0].url,
    "https://www.kasandbox.org/?code=spotify-code&state=expected-state",
  );
  assert.equal(callbacks[0].source, harness.popup);
  assert.deepEqual(timers.cleared, [17]);
});

test("OAuth popup polling ignores callback parameters from another origin", () => {
  const harness = popupHarness("https://example.com/?code=stolen&state=wrong");
  const timers = scheduler();
  let callbackCount = 0;

  watchOAuthPopup({
    popup: harness.popup,
    expectedOrigin: "https://www.kasandbox.org/",
    onCallback: () => { callbackCount += 1; },
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
  });
  timers.tick();

  assert.equal(callbackCount, 0);
  assert.deepEqual(timers.cleared, []);
});

test("OAuth popup polling reports a popup closed before callback", () => {
  const harness = popupHarness();
  const timers = scheduler();
  let closedCount = 0;

  watchOAuthPopup({
    popup: harness.popup,
    expectedOrigin: "https://www.kasandbox.org/",
    onCallback: () => assert.fail("closed popup must not produce a callback"),
    onClosed: () => { closedCount += 1; },
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
  });
  harness.popup.closed = true;
  timers.tick();

  assert.equal(closedCount, 1);
  assert.deepEqual(timers.cleared, [17]);
});
