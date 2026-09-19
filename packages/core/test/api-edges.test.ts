import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  extractHttpClients,
  extractHttpRoutes,
  httpRoutesMatch,
  normalizeHttpPath,
} from "../src/api-edges.js";
import { analyze } from "../src/analyze.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "http-mixed",
);

describe("normalizeHttpPath", () => {
  it("strips origin, query, and params", () => {
    assert.equal(
      normalizeHttpPath("https://api.example.com/api/orders/42?x=1"),
      "/api/orders/{p}",
    );
    assert.equal(normalizeHttpPath("/api/orders/:id"), "/api/orders/{p}");
    assert.equal(normalizeHttpPath("`/api/orders/${id}`"), "/api/orders/{p}");
    assert.equal(normalizeHttpPath("/health"), null);
    assert.equal(normalizeHttpPath("/api"), null);
  });
});

describe("httpRoutesMatch", () => {
  it("matches prefix and trailing param", () => {
    assert.equal(httpRoutesMatch("/api/orders/{p}", "/api/orders"), true);
    assert.equal(httpRoutesMatch("/api/catalog", "/api/catalog/{p}"), true);
    assert.equal(httpRoutesMatch("/api/orders", "/api/wallet/charge"), false);
  });
});

describe("extractHttpClients / extractHttpRoutes", () => {
  it("reads fetch and axios clients", () => {
    const src = `
      fetch("/api/orders/" + id);
      fetch(\`/api/orders/\${id}\`);
      axios.get("/api/catalog");
    `;
    const clients = extractHttpClients(src);
    assert.ok(clients.includes("/api/orders/{p}"));
    assert.ok(clients.includes("/api/catalog"));
  });

  it("reads Spring controllers with class prefix", () => {
    const src = `
      @RestController
      @RequestMapping("/api/catalog")
      public class CatalogController {
        @GetMapping
        public String list() { return "[]"; }
        @GetMapping("/{id}")
        public String one() { return "{}"; }
      }
    `;
    const routes = extractHttpRoutes(src);
    assert.ok(routes.includes("/api/catalog"), routes.join(","));
    assert.ok(routes.includes("/api/catalog/{p}"), routes.join(","));
  });

  it("treats Feign mappings as clients, not servers", () => {
    const src = `
      @FeignClient(name = "order")
      public interface OrderClient {
        @GetMapping("/api/orders/{id}")
        Order get(@PathVariable String id);
      }
    `;
    assert.ok(extractHttpClients(src).includes("/api/orders/{p}"));
    assert.equal(extractHttpRoutes(src).length, 0);
  });

  it("reads FastAPI and Express routes", () => {
    assert.ok(
      extractHttpRoutes('@app.post("/api/wallet/charge")\ndef x():\n  pass').includes(
        "/api/wallet/charge",
      ),
    );
    assert.ok(
      extractHttpRoutes('app.get("/api/orders", () => [])').includes("/api/orders"),
    );
    assert.ok(
      extractHttpRoutes('r.GET("/api/orders", h)').includes("/api/orders"),
    );
  });
});

describe("cross-language HTTP vines (fixture)", () => {
  it("links web fetch to JS / Java / Python servers", async () => {
    const snap = await analyze({
      rootPath: fixture,
      granularity: "package",
      writeSnapshot: false,
      appendTimeline: false,
    });
    const http = snap.vines.filter((v) => v.source === "http");
    const labels = new Map(snap.plants.map((p) => [p.id, p.label]));
    const pairs = http.map((v) => `${labels.get(v.from)}→${labels.get(v.to)}`);
    assert.ok(
      pairs.some((p) => p.includes("web") && p.includes("order")),
      `missing web→order in ${pairs.join(", ")}`,
    );
    assert.ok(
      pairs.some((p) => p.includes("web") && p.includes("catalog")),
      `missing web→catalog (Java) in ${pairs.join(", ")}`,
    );
    assert.ok(
      pairs.some((p) => p.includes("web") && p.includes("wallet")),
      `missing web→wallet (Python) in ${pairs.join(", ")}`,
    );
    assert.ok(
      snap.meta.notes?.some((n) => n.includes("HTTP")),
      snap.meta.notes?.join(" | "),
    );
  });
});
