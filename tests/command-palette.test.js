import test from "node:test";
import assert from "node:assert/strict";

import { parseCommand, parseSeekArgument } from "../src/js/ui/command-palette.js";

test("command parser preserves quoted Spotify queries and expands aliases", () => {
  assert.deepEqual(parseCommand('p song "red walls"'), {
    raw: 'p song "red walls"',
    name: "play",
    args: ["song", "red walls"],
    argument: "song red walls",
  });
  assert.equal(parseCommand("rep track").name, "repeat");
  assert.equal(parseCommand("tv").name, "fullscreen");
  assert.equal(parseCommand("   "), null);
});

test("seek parser supports absolute timestamps and relative offsets", () => {
  assert.equal(parseSeekArgument("1:20"), 80_000);
  assert.equal(parseSeekArgument("75"), 75_000);
  assert.equal(parseSeekArgument("+30", 10_000), 40_000);
  assert.equal(parseSeekArgument("-15", 10_000), 0);
  assert.equal(parseSeekArgument("not-a-time", 10_000), null);
});
