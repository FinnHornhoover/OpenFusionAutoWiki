import assert from "node:assert/strict";
import test from "node:test";

import { orderBuilds, selectAvailableBuild, tabAnchor } from "./routing.js";
import type { BuildEntry } from "./types.js";

const build = (
  slug: string,
  date: string,
  fixed = slug.endsWith("-fixed"),
): BuildEntry => ({ slug, displayName: slug, date, fixed });

test("orders preferred builds before dated fallback builds", () => {
  const ordered = orderBuilds([
    build("beta-20110101", "2011-01-01", false),
    build("beta-20110101-fixed", "2011-01-01", true),
    build("beta-20100104-fixed", "2010-01-04", true),
    build("retrobution", "", false),
    build("beta-20111013-fixed", "2011-10-13", true),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.slug),
    [
      "retrobution",
      "beta-20111013-fixed",
      "beta-20100104-fixed",
      "beta-20110101-fixed",
      "beta-20110101",
    ],
  );
});

test("keeps the requested build or selects the first available fallback", () => {
  const ordered = orderBuilds([
    build("retrobution", "", false),
    build("beta-20111013-fixed", "2011-10-13", true),
    build("beta-20100104-fixed", "2010-01-04", true),
  ]);
  const available = new Set(["beta-20111013-fixed", "beta-20100104-fixed"]);
  assert.equal(
    selectAvailableBuild(ordered, available, "beta-20100104-fixed")?.slug,
    "beta-20100104-fixed",
  );
  assert.equal(
    selectAvailableBuild(ordered, available, "retrobution")?.slug,
    "beta-20111013-fixed",
  );
});

test("matches TabberNeue tab panel anchors", () => {
  assert.equal(
    tabAnchor({ displayName: "Academy -- beta-20111013-fixed" }),
    "tabber-tab-Academy_--_beta-20111013-fixed",
  );
});
