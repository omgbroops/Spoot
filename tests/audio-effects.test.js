import test from "node:test";
import assert from "node:assert/strict";

import { requiresAudioGraph } from "../src/js/audio/audio-effects.js";

test("flat local playback avoids a Web Audio graph until an effect or visualizer needs it", () => {
  const flat = { eqEnabled: true, eq: [0, 0, 0, 0, 0, 0, 0, 0], reverb: 0, analysisEnabled: false };
  assert.equal(requiresAudioGraph(flat), false);
  assert.equal(requiresAudioGraph({ ...flat, eq: [0, 0, 3, 0, 0, 0, 0, 0] }), true);
  assert.equal(requiresAudioGraph({ ...flat, reverb: 0.2 }), true);
  assert.equal(requiresAudioGraph({ ...flat, analysisEnabled: true }), true);
});
