import { createHash } from "node:crypto";

export interface ImportPage {
  title: string;
  namespace: number;
  text: string;
}

export interface ImportMetadata {
  username: string;
  summary: string;
  timestamp: string;
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sha1Base36(value: string) {
  const digest = createHash("sha1").update(value).digest("hex");
  return BigInt("0x" + digest).toString(36);
}

export function renderImportXml(pages: ImportPage[], metadata: ImportMetadata) {
  const revisions = pages.map((page, index) => {
    const pageId = index + 1;
    const revisionId = pages.length + index + 1;
    return [
      "  <page>",
      "    <title>" + escapeXml(page.title) + "</title>",
      "    <ns>" + page.namespace + "</ns>",
      "    <id>" + pageId + "</id>",
      "    <revision>",
      "      <id>" + revisionId + "</id>",
      "      <timestamp>" + escapeXml(metadata.timestamp) + "</timestamp>",
      "      <contributor><username>" +
        escapeXml(metadata.username) +
        "</username></contributor>",
      "      <comment>" + escapeXml(metadata.summary) + "</comment>",
      "      <origin>" + revisionId + "</origin>",
      "      <model>wikitext</model>",
      "      <format>text/x-wiki</format>",
      '      <text bytes="' +
        Buffer.byteLength(page.text) +
        '" xml:space="preserve">' +
        escapeXml(page.text) +
        "</text>",
      "      <sha1>" + sha1Base36(page.text) + "</sha1>",
      "    </revision>",
      "  </page>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="en">',
    ...revisions,
    "</mediawiki>",
    "",
  ].join("\n");
}

export function importBatches(
  pages: ImportPage[],
  maxPages: number,
  maxBytes: number,
) {
  const batches: ImportPage[][] = [];
  let batch: ImportPage[] = [];
  let bytes = 0;
  for (const page of pages) {
    const pageBytes =
      Buffer.byteLength(page.title) + Buffer.byteLength(page.text);
    if (
      batch.length &&
      (batch.length >= maxPages || bytes + pageBytes > maxBytes)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(page);
    bytes += pageBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
