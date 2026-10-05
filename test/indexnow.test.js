import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readIndexNowKey, INDEXNOW_KEY_FILE, INDEXNOW_KEY_RE } from "../site/indexnow.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inow-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const put = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };

test("the committed key is one line of 32 lowercase hexadecimal characters", () => {
  const text = fs.readFileSync(INDEXNOW_KEY_FILE, "utf8");
  assert.match(text, /^[0-9a-f]{32}\n$/);
  assert.equal(readIndexNowKey(), text.trim());
});

test("a key file is read with its trailing newline removed", () => {
  assert.equal(readIndexNowKey(put("a.key", "abcd-1234\n")), "abcd-1234");
  assert.equal(readIndexNowKey(put("b.key", "abcd1234")), "abcd1234");
  assert.equal(readIndexNowKey(put("c.key", "ABCDefgh\r\n")), "ABCDefgh");
  assert.equal(readIndexNowKey(put("d.key", "a".repeat(128) + "\n")), "a".repeat(128));
});

test("a missing key file means no key, which turns the pings off", () => {
  assert.equal(readIndexNowKey(path.join(tmp, "missing.key")), null);
});

test("a malformed key file stops the build with a clear message", () => {
  for (const bad of ["", "\n", "short", "a".repeat(129), "has space1", "abc_defgh", "abcdefgh\nijklmnop\n", "abcdéfgh", " abcdefgh"]) {
    assert.throws(() => readIndexNowKey(put("bad.key", bad)), /indexnow\.key/, JSON.stringify(bad));
  }
});

test("the key rule is 8 to 128 letters, digits and dashes, as the IndexNow documentation says", () => {
  for (const ok of ["abcdefgh", "ABCD-1234", "-".repeat(8), "0".repeat(128)]) assert.ok(INDEXNOW_KEY_RE.test(ok), ok);
  for (const bad of ["abcdefg", "0".repeat(129), "abcdefgh\n", "abc.defgh", "abc/defgh"]) assert.ok(!INDEXNOW_KEY_RE.test(bad), bad);
});
