import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeOwnedSections,
  pageTextEqual,
  stripOwnedSections,
} from "./merge.js";

const generated = `== Game data ==
<!-- OFAW:topic-data:v2 -->
__NOEDITSECTION__
<tabbertransclude>
Project:OpenFusionAutoWiki/Data/example/retrobution|Retrobution
</tabbertransclude>
`;

test("does not duplicate an unchanged owned section", () => {
  assert.equal(mergeOwnedSections(generated, generated), generated);
});

test("ignores the final newline stripped by MediaWiki", () => {
  assert.equal(pageTextEqual(generated, generated.trimEnd()), true);
});

test("replaces owned sections while preserving user prose", () => {
  const existing = `User-written introduction.

== Old heading ==
<!-- OFAW:topic-data:v1 -->
Old generated body.

== Notes ==
User-written notes.
`;

  assert.equal(
    mergeOwnedSections(existing, generated),
    `User-written introduction.

== Game data ==
<!-- OFAW:topic-data:v2 -->
__NOEDITSECTION__
<tabbertransclude>
Project:OpenFusionAutoWiki/Data/example/retrobution|Retrobution
</tabbertransclude>

== Notes ==
User-written notes.
`,
  );
});

test("removes obsolete owned sections from an active article", () => {
  const existing = `== Old generated ==
<!-- OFAW:obsolete:v1 -->
Old body.

== Notes ==
User notes.
`;

  assert.equal(
    mergeOwnedSections(existing, generated),
    `== Notes ==
User notes.

${generated}`,
  );
});

test("strips owned sections while retaining ordinary article text", () => {
  const existing = `Introduction.

== Generated ==
<!-- OFAW:topic-data:v2 -->
Generated body.

== Notes ==
User notes.
`;

  assert.equal(
    stripOwnedSections(existing),
    `Introduction.

== Notes ==
User notes.`,
  );
});

test("recognizes a page containing only owned sections", () => {
  assert.equal(stripOwnedSections(generated), "");
});
