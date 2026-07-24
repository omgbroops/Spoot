import test from "node:test";
import assert from "node:assert/strict";

import { MockPlaybackController } from "../src/js/mock/mock-playback-controller.js";

test("mock controller drives the real controller-shaped playback flow", async () => {
  const controller = new MockPlaybackController();
  const states = [];
  const queues = [];
  controller.on("state", (state) => states.push(state));
  controller.on("queue", (queue) => queues.push(queue));

  await controller.connect();
  assert.equal(controller.deviceId, "spool-mock-device");
  assert.equal(controller.playbackState.title, "Silver Thread");
  assert.equal(controller.queue.upcoming.length, 2);

  await controller.togglePlay();
  assert.equal(controller.playbackState.paused, true);
  await controller.seek(9_999_999);
  assert.equal(
    controller.playbackState.positionMs,
    controller.playbackState.durationMs,
  );
  await controller.next();
  assert.equal(controller.playbackState.title, "Slow Orbit");
  await controller.setShuffle(true);
  assert.equal(controller.playbackState.shuffleEnabled, true);
  assert.equal(await controller.cycleRepeat(), "context");
  assert.equal((await controller.refreshDevices()).length, 2);
  await controller.transferToDevice("mock-living-room");
  assert.equal(controller.playbackState.activeDevice, false);
  await controller.playNow("spotify:track:mock-silver-thread");
  assert.equal(controller.playbackState.activeDevice, true);
  assert.equal(await controller.setVolume(0.4), 0.4);

  assert.ok(states.length >= 6);
  assert.ok(queues.length >= 2);
  await controller.disconnect();
});

test("mock controller exposes empty, null, and error scenarios", async () => {
  const empty = new MockPlaybackController({ scenario: "empty-queue" });
  await empty.connect();
  assert.deepEqual(empty.queue.upcoming, []);
  await empty.disconnect();

  const nullState = new MockPlaybackController({ scenario: "null" });
  await nullState.connect();
  assert.equal(await nullState.refreshState(), null);
  await nullState.disconnect();

  const authError = new MockPlaybackController({ scenario: "auth-error" });
  await assert.rejects(authError.connect(), /authorization failed/);

  const sdkError = new MockPlaybackController({ scenario: "sdk-error" });
  await assert.rejects(sdkError.connect(), /SDK failed/);

  const rateLimit = new MockPlaybackController({ scenario: "rate-limit" });
  await rateLimit.connect();
  await assert.rejects(rateLimit.refreshState(), /rate limit/);
  await rateLimit.disconnect();
});
