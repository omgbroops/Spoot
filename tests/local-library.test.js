import test from "node:test";
import assert from "node:assert/strict";

import { readId3Tags } from "../src/js/local/local-library.js";

test("local metadata reads the compact ID3v1 tail without decoding the whole audio blob", async () => {
  const tail = new Uint8Array(128);
  tail.set(new TextEncoder().encode("TAG"), 0);
  tail.set(new TextEncoder().encode("OPM BABI"), 3);
  tail.set(new TextEncoder().encode("Playboi Carti"), 33);
  tail.set(new TextEncoder().encode("MUSIC"), 63);
  const blob = new Blob([new Uint8Array(1024 * 1024), tail], { type: "audio/mpeg" });
  const tags = await readId3Tags(blob);
  assert.equal(tags.title, "OPM BABI");
  assert.equal(tags.artist, "Playboi Carti");
  assert.equal(tags.album, "MUSIC");
});
