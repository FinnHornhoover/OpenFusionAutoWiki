import assert from "node:assert/strict";
import test from "node:test";

import { buildWikiMaps, buildWorldMapFromAreas } from "./maps.js";

test("area maps use an image layer, uploaded icons, crop centre, and routes", () => {
  const maps = buildWikiMaps("areas", {
    id: "test-area",
    name: "Test Area",
    x: 100000,
    y: 200000,
    width: 51200,
    height: 51200,
    npcs: [
      {
        x: 110000,
        y: 210000,
        name: "Test NPC",
        mapIcon: "/minimap/mapicons/location_npc.png",
      },
    ],
    transportation: [
      {
        name: "Test route",
        routePoints: [
          { x: 100000, y: 200000 },
          { x: 120000, y: 220000 },
        ],
      },
    ],
  });
  assert.equal(maps.length, 1);
  assert.match(maps[0].wikitext, /image layers=File:OFAW-minimap-all\.png/);
  assert.match(
    maps[0].wikitext,
    /File:OFAW-minimap-mapicons-location_npc\.png/,
  );
  assert.match(maps[0].wikitext, /\|centre=/);
  assert.match(maps[0].wikitext, /\|lines=/);
  assert.deepEqual(maps[0].media.sort(), [
    "/minimap/all.png",
    "/minimap/mapicons/location_npc.png",
  ]);
});

test("world maps expose build-aware area links", () => {
  const map = buildWorldMapFromAreas(
    [
      {
        id: "test-area",
        name: "Test Area",
        x: 100000,
        y: 200000,
        width: 51200,
        height: 51200,
      },
    ],
    () => "Test Area#tabber-tab-Retrobution",
  );
  assert.ok(map);
  assert.match(
    map.wikitext,
    /\[\[Test Area#tabber-tab-Retrobution\|View article\]\]/,
  );
});
