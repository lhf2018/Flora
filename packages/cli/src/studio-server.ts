import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, buildTimeline, compareRefs, formatDiffComment, listGitBranches, loadTimeline, loadTimelineFrame, summarizeDelta, DEFAULT_IGNORE } from "@flora/core";
import type { AggregateGranularity, GardenSnapshot, TimelineProgress } from "@flora/core";
import { listDirectories, listRoots, pickFolder } from "./pick-folder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StudioServerOptions {
  port?: number;
  openBrowser?: boolean;
}

interface AnalyzeBody {
  rootPath?: string;
  granularity?: AggregateGranularity;
  ignore?: string[];
  targetPlants?: number;
  focusPath?: string;
  /** when drilling, don't overwrite root snapshot / timeline */
  writeSnapshot?: boolean;
}

interface RecentEntry {
  path: string;
  projectId: string;
  at: string;
}

/** In-flight timeline build progress for Studio polling */
let timelineProgress: (TimelineProgress & { active: boolean }) | null = null;

function recentFile(): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || process.cwd(),
    ".flora",
    "recent.json",
  );
}

function loadRecent(): RecentEntry[] {
  try {
    return JSON.parse(fs.readFileSync(recentFile(), "utf8")) as RecentEntry[];
  } catch {
    return [];
  }
}

function saveRecent(entry: RecentEntry) {
  const list = loadRecent().filter((r) => r.path !== entry.path);
  list.unshift(entry);
  const file = recentFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list.slice(0, 12), null, 2), "utf8");
}

function resolveStudioStatic(): string | null {
  const candidates = [
    // monorepo: apps/studio/dist
    path.resolve(__dirname, "../../../apps/studio/dist"),
    path.resolve(__dirname, "../../../../apps/studio/dist"),
    // packaged
    path.resolve(__dirname, "../studio-dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return null;
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

export async function startStudioServer(opts: StudioServerOptions = {}) {
  const port = opts.port ?? 4173;
  const staticRoot = resolveStudioStatic();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/recent" && req.method === "GET") {
        sendJson(res, 200, { recent: loadRecent() });
        return;
      }

      if (url.pathname === "/api/fs/roots" && req.method === "GET") {
        const roots = await listRoots();
        sendJson(res, 200, { roots });
        return;
      }

      if (url.pathname === "/api/fs/list" && req.method === "GET") {
        const dir = url.searchParams.get("path");
        if (!dir) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }
        try {
          sendJson(res, 200, listDirectories(dir));
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (url.pathname === "/api/pick-folder" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          startPath?: string;
        };
        // Native dialog is best-effort; UI should prefer /api/fs/* browser.
        const selected = await pickFolder(body.startPath);
        sendJson(res, 200, {
          path: selected,
          hint: selected
            ? undefined
            : "原生对话框不可用或已取消，请用页面内浏览",
        });
        return;
      }

      if (url.pathname === "/api/analyze" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as AnalyzeBody;
        if (!body.rootPath) {
          sendJson(res, 400, { error: "rootPath is required" });
          return;
        }
        const rootPath = path.resolve(body.rootPath);
        if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
          sendJson(res, 400, { error: `路径不存在或不是目录: ${rootPath}` });
          return;
        }

        const snapshot = await analyze({
          rootPath,
          granularity: body.granularity ?? "auto",
          ignore: body.ignore?.length ? body.ignore : DEFAULT_IGNORE,
          targetPlants: body.targetPlants,
          focusPath: body.focusPath,
          writeSnapshot: body.focusPath
            ? false
            : body.writeSnapshot !== false,
          appendTimeline: !body.focusPath,
        });
        if (!body.focusPath) {
          saveRecent({
            path: rootPath,
            projectId: snapshot.meta.projectId,
            at: snapshot.meta.capturedAt,
          });
        }
        const timeline = body.focusPath ? null : loadTimeline(rootPath);
        sendJson(res, 200, {
          snapshot,
          summary: summarizeDelta(snapshot),
          timeline,
          drilled: Boolean(body.focusPath),
        });
        return;
      }

      if (url.pathname === "/api/timeline" && req.method === "GET") {
        const root = url.searchParams.get("rootPath");
        if (!root) {
          sendJson(res, 400, { error: "rootPath is required" });
          return;
        }
        const rootPath = path.resolve(root);
        const timeline = loadTimeline(rootPath);
        if (!timeline) {
          sendJson(res, 404, { error: "尚无时间轴，请先 analyze 或 build" });
          return;
        }
        const frames = timeline.frames.map((f) => ({
          ...f,
          snapshot: loadTimelineFrame(rootPath, f.snapshotRef),
        }));
        sendJson(res, 200, { timeline, frames });
        return;
      }

      if (url.pathname === "/api/timeline/progress" && req.method === "GET") {
        sendJson(res, 200, timelineProgress ?? { active: false, done: 0, total: 0, label: "", phase: "done" });
        return;
      }

      if (url.pathname === "/api/timeline/build" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          rootPath?: string;
          days?: number;
          frames?: number;
          granularity?: AggregateGranularity;
          targetPlants?: number;
          mode?: "auto" | "commits" | "approx";
          concurrency?: number;
        };
        if (!body.rootPath) {
          sendJson(res, 400, { error: "rootPath is required" });
          return;
        }
        const rootPath = path.resolve(body.rootPath);
        timelineProgress = {
          active: true,
          phase: "analyze",
          done: 0,
          total: body.frames ?? 8,
          label: "开始…",
        };
        try {
          const { timeline, snapshots } = await buildTimeline({
            rootPath,
            days: body.days ?? 30,
            frames: body.frames ?? 8,
            granularity: body.granularity ?? "auto",
            targetPlants: body.targetPlants,
            mode: body.mode ?? "auto",
            concurrency: body.concurrency ?? 2,
            onProgress: (p) => {
              timelineProgress = { ...p, active: p.phase !== "done" };
            },
          });
          const modeNote = snapshots
            .flatMap((s) => s.meta.notes ?? [])
            .find((n) => n.includes("时间轴模式") || n.includes("真实提交"));
          const cacheNote = snapshots
            .flatMap((s) => s.meta.notes ?? [])
            .find((n) => n.includes("缓存命中"));
          sendJson(res, 200, {
            timeline,
            frames: timeline.frames.map((f, i) => ({
              ...f,
              snapshot: snapshots[i] ?? loadTimelineFrame(rootPath, f.snapshotRef),
            })),
            summary: snapshots.length
              ? summarizeDelta(snapshots[snapshots.length - 1]!)
              : "",
            mode: modeNote?.includes("真实") ? "commits" : "approx",
            cacheNote: cacheNote ?? null,
          });
        } finally {
          if (timelineProgress) timelineProgress.active = false;
        }
        return;
      }

      if (url.pathname === "/api/branches" && req.method === "GET") {
        const root = url.searchParams.get("rootPath");
        if (!root) {
          sendJson(res, 400, { error: "rootPath is required" });
          return;
        }
        const rootPath = path.resolve(root);
        try {
          const data = await listGitBranches(rootPath);
          sendJson(res, 200, data);
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (url.pathname === "/api/compare" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          rootPath?: string;
          baseRef?: string;
          headRef?: string;
          granularity?: AggregateGranularity;
          rulesPath?: string;
          targetPlants?: number;
        };
        if (!body.rootPath || !body.baseRef || !body.headRef) {
          sendJson(res, 400, {
            error: "rootPath、baseRef、headRef（两个分支）均为必填",
          });
          return;
        }
        const rootPath = path.resolve(body.rootPath);
        if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
          sendJson(res, 400, { error: `路径不存在或不是目录: ${rootPath}` });
          return;
        }
        const diff = await compareRefs({
          rootPath,
          baseRef: body.baseRef,
          headRef: body.headRef,
          granularity: body.granularity ?? "auto",
          rulesPath: body.rulesPath,
          targetPlants: body.targetPlants,
        });
        sendJson(res, 200, {
          diff,
          comment: formatDiffComment(diff),
          summary: diff.summary,
        });
        return;
      }

      // static studio
      if (staticRoot) {
        let rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const file = path.join(staticRoot, rel);
        if (file.startsWith(staticRoot) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { "Content-Type": contentType(file) });
          fs.createReadStream(file).pipe(res);
          return;
        }
        // SPA fallback
        const index = path.join(staticRoot, "index.html");
        if (fs.existsSync(index)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(index).pipe(res);
          return;
        }
      }

      // Dev fallback page when studio isn't built yet
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(devFallbackHtml(port));
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const url = `http://127.0.0.1:${port}`;
  console.log(`Flora Studio → ${url}`);
  if (staticRoot) console.log(`Serving UI from ${staticRoot}`);
  else console.log("Studio UI not built; serving lightweight fallback. Run: pnpm --filter @flora/studio build");

  if (opts.openBrowser !== false) {
    try {
      const open = (await import("open")).default;
      await open(url);
    } catch {
      /* ignore */
    }
  }

  return server;
}

function devFallbackHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flora Studio</title>
  <style>
    :root {
      --ink: #2a2a28;
      --muted: #6e6a62;
      --ground: #e8e2d6;
      --leaf: #2f6b3a;
      --panel: rgba(250,248,242,.94);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 20% -10%, #f7f1e4, transparent),
        linear-gradient(180deg, #f2ede3, #c9c0ae);
      min-height: 100vh;
    }
    header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 24px; border-bottom: 1px solid rgba(42,42,40,.08);
    }
    header strong { font-size: 22px; letter-spacing: .04em; }
    .layout { display: grid; grid-template-columns: 320px 1fr; height: calc(100vh - 64px); }
    aside {
      padding: 20px; border-right: 1px solid rgba(42,42,40,.08);
      background: var(--panel); overflow: auto;
    }
    main { position: relative; }
    canvas { width: 100%; height: 100%; display: block; }
    label { display:block; font-size: 12px; color: var(--muted); margin: 12px 0 6px; }
    input, select, button, textarea {
      width: 100%; padding: 10px 12px; border-radius: 8px;
      border: 1px solid rgba(42,42,40,.15); font: inherit; background: #fff;
    }
    button {
      background: var(--leaf); color: #f7faf6; border: none; cursor: pointer;
      margin-top: 10px; font-weight: 600;
    }
    button.secondary { background: transparent; color: var(--ink); border: 1px solid rgba(42,42,40,.2); }
    .notes { font-size: 12px; color: var(--muted); white-space: pre-wrap; margin-top: 12px; }
    .recent button { background: #fff; color: var(--ink); border: 1px solid rgba(42,42,40,.12); text-align: left; font-weight: 400; }
    .browser { margin-top: 10px; border: 1px solid rgba(42,42,40,.12); border-radius: 10px; background:#fff; display:none; }
    .browser.open { display:block; }
    .browser-toolbar { display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid rgba(42,42,40,.08); }
    .browser-path { flex:1; font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .browser-list { max-height:200px; overflow:auto; padding:6px; }
    .browser-item { margin:0 0 4px; text-align:left; background:transparent; color:var(--ink); border:none; font-weight:400; }
    .browser-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px; border-top:1px solid rgba(42,42,40,.08); }
    .browser-actions button { margin-top:0; }
    button.ghost { width:auto; margin:0; padding:6px 10px; background:transparent; color:var(--ink); border:1px solid rgba(42,42,40,.15); }
    .drawer {
      position: absolute; right: 16px; top: 16px; width: 280px;
      background: var(--panel); border-radius: 12px; padding: 16px;
      box-shadow: 0 12px 40px rgba(40,30,20,.12); display: none;
    }
    .drawer.open { display: block; }
    .bar {
      position: absolute; left: 16px; right: 16px; bottom: 16px;
      background: var(--panel); border-radius: 999px; padding: 10px 18px;
      display: flex; gap: 12px; align-items: center; font-size: 13px;
    }
  </style>
</head>
<body>
  <header>
    <strong>Flora</strong>
    <span style="color:var(--muted);font-size:13px">选路径 → 出树 → 花园</span>
  </header>
  <div class="layout">
    <aside>
      <label>项目路径</label>
      <input id="path" placeholder="粘贴绝对路径，或点浏览" />
      <button class="secondary" id="browse">浏览文件夹…</button>
      <div class="browser" id="browser">
        <div class="browser-toolbar">
          <button type="button" class="ghost" id="browser-up">↑</button>
          <div class="browser-path" id="browser-path"></div>
        </div>
        <div class="browser-list" id="browser-list"></div>
        <div class="browser-actions">
          <button type="button" class="secondary" id="browser-cancel">取消</button>
          <button type="button" id="browser-choose">选择此文件夹</button>
        </div>
      </div>
      <label>一株代表什么</label>
      <select id="granularity">
        <option value="auto">自动（推荐）</option>
        <option value="package">按软件包</option>
        <option value="directory">按顶层文件夹</option>
        <option value="file">按源文件</option>
      </select>
      <button id="grow">开始生长</button>
      <div class="notes" id="notes"></div>
      <label>最近</label>
      <div class="recent" id="recent"></div>
    </aside>
    <main>
      <canvas id="garden"></canvas>
      <div class="drawer" id="drawer"></div>
      <div class="bar" id="bar">尚未构建 — 选择一个代码库路径</div>
    </main>
  </div>
  <script type="module">
    const API = '';
    const pathEl = document.getElementById('path');
    const notesEl = document.getElementById('notes');
    const barEl = document.getElementById('bar');
    const drawerEl = document.getElementById('drawer');
    const canvas = document.getElementById('garden');
    const ctx = canvas.getContext('2d');
    let snapshot = null;
    let selected = null;

    async function loadRecent() {
      const res = await fetch(API + '/api/recent');
      const data = await res.json();
      const box = document.getElementById('recent');
      box.innerHTML = '';
      for (const r of data.recent || []) {
        const b = document.createElement('button');
        b.textContent = r.path;
        b.onclick = () => { pathEl.value = r.path; grow(); };
        box.appendChild(b);
      }
    }

    let browserCurrent = '';
    let browserParent = null;

    document.getElementById('browse').onclick = () => openBrowser(pathEl.value.trim() || undefined);
    document.getElementById('browser-cancel').onclick = () => {
      document.getElementById('browser').classList.remove('open');
    };
    document.getElementById('browser-choose').onclick = () => {
      if (!browserCurrent) return;
      pathEl.value = browserCurrent;
      document.getElementById('browser').classList.remove('open');
      grow();
    };
    document.getElementById('browser-up').onclick = () => {
      if (browserParent) loadBrowser(browserParent);
      else loadRoots();
    };

    async function openBrowser(start) {
      document.getElementById('browser').classList.add('open');
      notesEl.textContent = '进入目录后点「选择此文件夹」';
      if (start) {
        try { await loadBrowser(start); return; } catch {}
      }
      await loadRoots();
    }
    async function loadRoots() {
      const data = await (await fetch(API + '/api/fs/roots')).json();
      browserCurrent = '';
      browserParent = null;
      document.getElementById('browser-path').textContent = '此电脑';
      renderEntries(data.roots || []);
    }
    async function loadBrowser(dir) {
      const res = await fetch(API + '/api/fs/list?path=' + encodeURIComponent(dir));
      const data = await res.json();
      if (!res.ok) { notesEl.textContent = data.error || '无法打开'; throw new Error(data.error); }
      browserCurrent = data.path;
      browserParent = data.parent;
      document.getElementById('browser-path').textContent = browserCurrent;
      renderEntries(data.entries || []);
    }
    function renderEntries(entries) {
      const list = document.getElementById('browser-list');
      list.innerHTML = '';
      if (!entries.length) {
        list.innerHTML = '<div style="padding:12px;color:#6e6a62;font-size:12px;text-align:center">（没有子文件夹）</div>';
        return;
      }
      for (const e of entries) {
        const b = document.createElement('button');
        b.className = 'browser-item';
        b.textContent = e.name;
        b.onclick = () => loadBrowser(e.path);
        list.appendChild(b);
      }
    }

    document.getElementById('grow').onclick = () => grow();

    async function grow() {
      const rootPath = pathEl.value.trim();
      if (!rootPath) { notesEl.textContent = '请先填写或选择路径'; return; }
      notesEl.textContent = '构建中…';
      barEl.textContent = '探测结构 → 解析依赖 → 布局…';
      const res = await fetch(API + '/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootPath,
          granularity: document.getElementById('granularity').value
        })
      });
      const data = await res.json();
      if (!res.ok) { notesEl.textContent = data.error || '失败'; return; }
      snapshot = data.snapshot;
      notesEl.textContent = (snapshot.meta.notes || []).map(n => '✓ ' + n).join('\\n');
      barEl.textContent = '今日花园 · ' + snapshot.meta.projectId + '  ·  ' + data.summary;
      selected = null;
      drawerEl.classList.remove('open');
      draw();
      loadRecent();
    }

    function resize() {
      const parent = canvas.parentElement;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = parent.clientWidth + 'px';
      canvas.style.height = parent.clientHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener('resize', () => { resize(); draw(); });
    resize();

    const COLORS = {
      healthy: '#2F6B3A', blooming: '#C45B7A', wilting: '#A67C52',
      dying: '#C8C8C8', entangled: '#5C4A3A',
      cycle: '#5B2C6F', vine: '#6B7F6E'
    };

    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const g = ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0, '#F2EDE3'); g.addColorStop(1, '#C9C0AE');
      ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
      if (!snapshot) return;
      const scale = Math.min(w/1000, h/700) * 0.92;
      const ox = (w - 1000*scale)/2, oy = (h - 700*scale)/2;
      ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
      for (const p of snapshot.pollutions || []) {
        const pos = snapshot.layout.positions[p.epicenter]; if (!pos) continue;
        const rg = ctx.createRadialGradient(pos.x,pos.y,8,pos.x,pos.y,p.radius);
        rg.addColorStop(0, 'rgba(58,42,42,0.35)'); rg.addColorStop(1, 'rgba(58,42,42,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(pos.x,pos.y,p.radius,0,Math.PI*2); ctx.fill();
      }
      for (const v of snapshot.vines || []) {
        const a = snapshot.layout.positions[v.from], b = snapshot.layout.positions[v.to];
        if (!a||!b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x,a.y);
        ctx.bezierCurveTo((a.x+b.x)/2, a.y-30, (a.x+b.x)/2, b.y+30, b.x,b.y);
        ctx.strokeStyle = v.kind === 'cycle' ? COLORS.cycle : COLORS.vine;
        ctx.lineWidth = 1 + v.strength * 3;
        ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
      }
      for (const p of snapshot.plants || []) {
        const pos = snapshot.layout.positions[p.id]; if (!pos) continue;
        ctx.fillStyle = COLORS[p.state] || COLORS.healthy;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 14, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#2a2a28'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.label.slice(0,18), pos.x, pos.y + 28);
      }
      ctx.restore();
      window.__floraView = { ox, oy, scale };
    }

    canvas.onclick = (e) => {
      if (!snapshot) return;
      const rect = canvas.getBoundingClientRect();
      const view = window.__floraView || { ox:0, oy:0, scale:1 };
      const x = (e.clientX - rect.left - view.ox) / view.scale;
      const y = (e.clientY - rect.top - view.oy) / view.scale;
      let best = null, bestD = 28;
      for (const p of snapshot.plants) {
        const pos = snapshot.layout.positions[p.id]; if (!pos) continue;
        const d = Math.hypot(pos.x-x, pos.y-y);
        if (d < bestD) { bestD = d; best = p; }
      }
      selected = best;
      if (!best) { drawerEl.classList.remove('open'); return; }
      const cov = Math.round(best.metrics.coverage * 100);
      const coup = Math.round(best.metrics.coupling * 100);
      drawerEl.classList.add('open');
      drawerEl.innerHTML = \`
        <div style="font-weight:700;margin-bottom:8px">\${best.label}</div>
        <div style="font-size:12px;color:#6e6a62;margin-bottom:8px">\${best.path || ''}</div>
        <div>状态 · \${best.state}</div>
        <div>覆盖率 · \${cov}%</div>
        <div>耦合度 · \${coup}%</div>
        <div>近期修改强度 · \${Math.round(best.metrics.churn*100)}%</div>
        <div style="margin-top:8px;font-size:12px">\${(best.violations||[]).map(v=>'• '+v.message).join('<br>') || '无违规'}</div>
      \`;
    };

    loadRecent();
  </script>
</body>
</html>`;
}
