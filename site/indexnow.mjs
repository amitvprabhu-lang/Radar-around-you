// The IndexNow key (docs/superpowers/specs/2026-10-06-live-hazard-pages-design.md, section 2b). The key is public by design: the site
// serves it as <key>.txt so search engines can check that whoever pings them owns the site. It proves ownership and gives no access, so
// it is committed (site/indexnow.key) and is not a secret. Deleting the file turns the pings off: the site build then writes no key file
// and the live index carries no key, so the server sends nothing.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const INDEXNOW_KEY_FILE = fileURLToPath(new URL("indexnow.key", import.meta.url));
// From the IndexNow documentation (read 2026-10-06): 8 to 128 characters of letters, digits and dashes.
export const INDEXNOW_KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

// The key, or null when the file does not exist. A file that exists but does not hold exactly one valid key (one trailing line break is
// allowed) throws, so a damaged file stops the build instead of quietly turning the pings off or publishing a wrong key file.
export function readIndexNowKey(file = INDEXNOW_KEY_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const key = text.replace(/\r?\n$/, "");
  if (!INDEXNOW_KEY_RE.test(key)) throw new Error("indexnow: site/indexnow.key must hold one key of 8 to 128 letters, digits and dashes on one line (delete the file to turn IndexNow off)");
  return key;
}
