import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManualOAuthCallbackUrl,
  watchOAuthPopup,
} from "../src/js/auth/oauth-popup.js";

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

test("manual OAuth recovery adds the sole pending PKCE state to a bare code", () => {
  const callback = new URL(buildManualOAuthCallbackUrl("spotify-code", {
    redirectUri: "https://www.kasandbox.org/",
    pendingStates: ["expected-state"],
  }));

  assert.equal(callback.origin, "https://www.kasandbox.org");
  assert.equal(callback.searchParams.get("code"), "spotify-code");
  assert.equal(callback.searchParams.get("state"), "expected-state");
});

test("manual OAuth recovery accepts a matching complete callback URL", () => {
  const callback = buildManualOAuthCallbackUrl(
    "https://www.kasandbox.org/?code=spotify-code&state=expected-state",
    {
      redirectUri: "https://www.kasandbox.org/",
      pendingStates: ["expected-state", "newer-state"],
    },
  );

  assert.equal(
    callback,
    "https://www.kasandbox.org/?code=spotify-code&state=expected-state",
  );
});

test("manual OAuth recovery refuses a bare code without one pending transaction", () => {
  assert.throws(
    () => buildManualOAuthCallbackUrl("spotify-code", {
      redirectUri: "https://www.kasandbox.org/",
      pendingStates: [],
    }),
    /Log in first/u,
  );
  assert.throws(
    () => buildManualOAuthCallbackUrl("spotify-code", {
      redirectUri: "https://www.kasandbox.org/",
      pendingStates: ["first", "second"],
    }),
    /complete callback URL/u,
  );
});

test("manual OAuth recovery rejects foreign origins and unknown state", () => {
  assert.throws(
    () => buildManualOAuthCallbackUrl(
      "https://example.com/?code=spotify-code&state=expected-state",
      {
        redirectUri: "https://www.kasandbox.org/",
        pendingStates: ["expected-state"],
      },
    ),
    /redirect origin/u,
  );
  assert.throws(
    () => buildManualOAuthCallbackUrl(
      "https://www.kasandbox.org/?code=spotify-code&state=wrong-state",
      {
        redirectUri: "https://www.kasandbox.org/",
        pendingStates: ["expected-state"],
      },
    ),
    /pending Spoot login/u,
  );
});
