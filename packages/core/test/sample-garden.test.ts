import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { analyze } from "../src/analyze.js";
import { isFoldedModule } from "../src/narrative.js";
import {
  looksLikeAppOrEntry,
  looksLikeSharedOrUiKit,
} from "../src/structure.js";

const sample = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/sample-monorepo",
);

describe("sample-monorepo garden", () => {
  it("grows expected plants, cycles, and HTTP vines", async () => {
    const snap = await analyze({
      rootPath: sample,
      writeSnapshot: false,
      appendTimeline: false,
    });
    const labels = snap.plants.map((p) => p.label).sort();
    assert.ok(labels.some((l) => /web/i.test(l)), labels.join(","));
    assert.ok(labels.some((l) => /order/i.test(l)), labels.join(","));
    assert.ok(labels.some((l) => /payment/i.test(l)), labels.join(","));
    assert.ok(labels.some((l) => /domain/i.test(l)), labels.join(","));
    const wallet = snap.plants.filter((p) => /wallet|py/i.test(p.label));
    assert.equal(
      wallet.length,
      1,
      `small python package should stay one plant, got ${wallet.map((p) => p.label).join(", ")}`,
    );
    assert.equal(wallet[0]!.metrics.orphan, false);
    assert.equal(
      labels.filter((l) => /ledger|__init__/i.test(l)).length,
      0,
      `file-split debris: ${labels.join(", ")}`,
    );
    assert.equal(
      labels.filter((l) => /^src$/i.test(l)).length,
      0,
      `generic src labels: ${labels.join(", ")}`,
    );

    const cycleVines = snap.vines.filter((v) => v.kind === "cycle");
    assert.ok(cycleVines.length >= 2, "order ↔ payment cycle missing");

    const http = snap.vines.filter((v) => v.source === "http");
    const byId = new Map(snap.plants.map((p) => [p.id, p]));
    const httpPairs = http.map(
      (v) => `${byId.get(v.from)?.label}→${byId.get(v.to)?.label}`,
    );
    assert.ok(
      httpPairs.some((p) => /web/i.test(p) && /wallet|py/i.test(p)),
      `expected web→py_wallet HTTP vine, got ${httpPairs.join(", ") || "none"}`,
    );

    const web = snap.plants.find((p) => /web/i.test(p.label));
    assert.ok(web);
    assert.equal(web!.metrics.orphan, false);
    assert.ok(
      !snap.meta.notes?.some((n) => /下钻「py-wallet」/.test(n)),
      snap.meta.notes?.join(" | "),
    );
  });
});

describe("narrative fold ids", () => {
  it("recognizes cluster / rest modules as folded", () => {
    assert.equal(isFoldedModule({ id: "pkg/_cluster-0", folded: false }), true);
    assert.equal(isFoldedModule({ id: "pkg/_rest", label: "其余 · 4" }), true);
    assert.equal(isFoldedModule({ id: "order", label: "@sample/order" }), false);
  });
});

describe("orphan heuristics", () => {
  it("does not treat app / platform / viz kits as orphans", () => {
    assert.equal(
      looksLikeAppOrEntry({
        label: "aurora-experiment-platform",
        path: "apps/aurora-experiment-platform",
        fanOut: 0,
        fileCount: 20,
      }),
      true,
    );
    assert.equal(
      looksLikeSharedOrUiKit({
        label: "aurora-graph-viz",
        path: "packages/aurora-graph-viz",
      }),
      true,
    );
  });
});
