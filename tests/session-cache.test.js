import test from "node:test";
import assert from "node:assert/strict";

import { SessionCache } from "../src/js/core/session-cache.js";

test("session cache is bounded and refreshes recently used entries", () => {
  const cache = new SessionCache({ maxEntries: 2 });
  cache.set("first", 1);
  cache.set("second", 2);
  assert.equal(cache.get("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.has("first"), true);
  assert.equal(cache.has("second"), false);
  assert.equal(cache.get("third"), 3);
  assert.equal(cache.size, 2);
});
