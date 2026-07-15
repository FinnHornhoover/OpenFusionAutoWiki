import assert from "node:assert/strict";
import test from "node:test";

import { buildEditParams, isEditConflict, mergeContinuedPage } from "./edit.js";

test("protects existing page edits with the base revision", () => {
  const params = buildEditParams("Page", "text", "summary", "token", {
    revisions: [{ revid: 42 }],
  });
  assert.equal(params.baserevid, "42");
  assert.equal(params.createonly, undefined);
});

test("protects new page edits with createonly", () => {
  const params = buildEditParams("Page", "text", "summary", "token", {
    missing: true,
  });
  assert.equal(params.createonly, "1");
  assert.equal(params.baserevid, undefined);
});

test("recognizes edit races that require a fresh merge", () => {
  assert.equal(isEditConflict("editconflict: stale revision"), true);
  assert.equal(isEditConflict("articleexists: page was created"), true);
  assert.equal(isEditConflict("pagedeleted: page was deleted"), true);
  assert.equal(isEditConflict("permissiondenied: blocked"), false);
});

test("retains revision data while merging query continuation pages", () => {
  const merged = mergeContinuedPage(
    { title: "Page", revisions: [{ revid: 42 }] },
    { title: "Page", pageid: 7 },
  );
  assert.deepEqual(merged.revisions, [{ revid: 42 }]);
  assert.equal(merged.pageid, 7);
});
