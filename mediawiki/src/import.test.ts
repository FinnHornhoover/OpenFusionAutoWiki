import assert from "node:assert/strict";
import test from "node:test";

import { importBatches, renderImportXml } from "./import.js";

test("renders valid escaped MediaWiki import XML", () => {
  const xml = renderImportXml(
    [{ title: "A & B <Set>", namespace: 0, text: 'x < y & "quoted"\n' }],
    {
      username: "LocalAdmin",
      summary: "Generated & merged",
      timestamp: "2026-07-20T00:00:00.000Z",
    },
  );
  assert.match(xml, /<title>A &amp; B &lt;Set&gt;<\/title>/);
  assert.match(xml, /<text bytes="17" xml:space="preserve">/);
  assert.match(xml, /x &lt; y &amp; &quot;quoted&quot;/);
  assert.match(xml, /<sha1>[0-9a-z]+<\/sha1>/);
});

test("batches imports by page count and approximate source bytes", () => {
  const pages = [
    { title: "One", namespace: 0, text: "1234" },
    { title: "Two", namespace: 0, text: "5678" },
    { title: "Three", namespace: 0, text: "9" },
  ];
  assert.deepEqual(
    importBatches(pages, 2, 100).map((batch) => batch.length),
    [2, 1],
  );
  assert.deepEqual(
    importBatches(pages, 10, 8).map((batch) => batch.length),
    [1, 1, 1],
  );
});
