import type { GardenSnapshot, GardenTimeline, Plant } from "@flora/core";
import { GardenRenderer } from "@flora/render";
import "./styles.css";

interface AnalyzeResponse {
  snapshot: GardenSnapshot;
  summary: string;
  timeline?: GardenTimeline | null;
  error?: string;
}

interface GardenDiffPayload {
  baseRef: string;
  headRef: string;
  base: GardenSnapshot;
  head: GardenSnapshot;
  summary: string;
  bullets: string[];
  plantChanges: Array<{
    id: string;
    label: string;
    kind: string;
    detail: string;
    fromState?: string;
    toState?: string;
  }>;
  vineChanges: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    detail: string;
    toKind?: string;
  }>;
  worsenedIds: string[];
  improvedIds: string[];
  addedIds: string[];
  removedIds: string[];
}

interface TimelineFramePayload {
  date: string;
  snapshotRef: string;
  delta?: {
    wilted: string[];
    recovered: string[];
    bloomed: string[];
    newPollution: string[];
    newCycles: string[];
  };
  snapshot?: GardenSnapshot | null;
}

const STATE_ZH: Record<string, string> = {
  healthy: "健康",
  blooming: "开花",
  wilting: "枯萎",
  dying: "濒死",
  entangled: "根系缠绕",
};

const SPECIES_ZH: Record<string, string> = {
  pine: "松树 · TypeScript",
  oak: "橡树 · JavaScript",
  willow: "柳树 · Python",
  bamboo: "竹林 · Go",
  fir: "冷杉 · Rust",
  maple: "枫树 · JVM/C#",
  blossom: "花丛 · 前端/UI",
  fern: "蕨类 · 文档",
  cactus: "仙人掌 · 脚本/配置",
  shrub: "灌木 · 混合",
};

function speciesLabel(plant: Plant): string {
  return SPECIES_ZH[plant.species] ?? plant.species ?? "灌木";
}

function langMix(plant: Plant): string {
  const langs = plant.languages ?? {};
  const entries = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "无源码统计";
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return entries
    .slice(0, 4)
    .map(([k, n]) => `${k} ${Math.round((n / total) * 100)}%`)
    .join(" · ");
}

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">Flora</div>
      <div class="tagline">选一个路径，种下一座架构花园</div>
    </header>
    <div class="body">
      <aside class="sidebar">
        <label class="field" for="path">项目路径</label>
        <input id="path" placeholder="粘贴绝对路径，或点浏览" />
        <button class="secondary" id="browse" type="button">浏览文件夹…</button>
        <div class="browser" id="browser" hidden>
          <div class="browser-toolbar">
            <button type="button" class="ghost" id="browser-up" title="上级">↑</button>
            <div class="browser-path" id="browser-path"></div>
          </div>
          <div class="browser-list" id="browser-list"></div>
          <div class="browser-actions">
            <button type="button" class="secondary" id="browser-cancel">取消</button>
            <button type="button" id="browser-choose">选择此文件夹</button>
          </div>
        </div>

        <label class="field" for="granularity">聚合粒度</label>
        <select id="granularity">
          <option value="auto">自动</option>
          <option value="package">package / workspace</option>
          <option value="directory">一级目录</option>
          <option value="file">文件（采样）</option>
        </select>

        <button id="grow" type="button">开始生长</button>

        <div class="compare-box">
          <div class="compare-title">PR 双花园</div>
          <p class="compare-hint">对比两个分支各自最新 tip（已提交树）</p>
          <label class="field" for="base-branch">Base 分支</label>
          <select id="base-branch" disabled>
            <option value="">先选择项目路径…</option>
          </select>
          <label class="field" for="head-branch">Head 分支</label>
          <select id="head-branch" disabled>
            <option value="">先选择项目路径…</option>
          </select>
          <button class="secondary" id="compare" type="button">对比双花园</button>
          <button class="ghost" id="refresh-branches" type="button">刷新分支</button>
          <button class="ghost" id="exit-compare" type="button" hidden>退出对比</button>
        </div>

        <div class="notes" id="notes"></div>

        <div id="report" class="report" hidden></div>

        <label class="field" id="plant-list-label" hidden>模块列表</label>
        <div class="plant-list" id="plant-list"></div>

        <label class="field">最近项目</label>
        <div class="recent" id="recent"></div>
      </aside>
      <main class="stage">
        <div class="stage-main">
          <div class="stage-canvas" id="stage-single">
            <canvas id="garden"></canvas>
            <div class="empty-hint" id="empty">
              <div>
                <strong>还没有花园</strong>
                选择代码库根目录后开始构建
              </div>
            </div>
            <aside class="drawer" id="drawer"></aside>
          </div>
          <div class="stage-compare" id="stage-compare" hidden>
            <div class="compare-pane">
              <canvas id="garden-base"></canvas>
            </div>
            <div class="compare-pane">
              <canvas id="garden-head"></canvas>
            </div>
            <aside class="drawer" id="drawer-compare"></aside>
          </div>
        </div>
        <div class="timeline-bar" id="timeline-bar" hidden>
          <button type="button" class="ghost" id="timeline-build" title="从 git 生成历史">生成回放</button>
          <button type="button" class="ghost" id="timeline-prev">◀</button>
          <input type="range" id="timeline-range" min="0" max="0" value="0" />
          <button type="button" class="ghost" id="timeline-next">▶</button>
          <button type="button" class="ghost" id="timeline-play">回放</button>
          <span class="timeline-date" id="timeline-date">—</span>
        </div>
        <div class="statusbar" id="bar">等待路径…</div>
      </main>
    </div>
  </div>
`;

const pathEl = document.querySelector<HTMLInputElement>("#path")!;
const notesEl = document.querySelector<HTMLDivElement>("#notes")!;
const barEl = document.querySelector<HTMLDivElement>("#bar")!;
const drawerEl = document.querySelector<HTMLElement>("#drawer")!;
const drawerCompareEl = document.querySelector<HTMLElement>("#drawer-compare")!;
const emptyEl = document.querySelector<HTMLDivElement>("#empty")!;
const reportEl = document.querySelector<HTMLDivElement>("#report")!;
const plantListEl = document.querySelector<HTMLDivElement>("#plant-list")!;
const plantListLabel = document.querySelector<HTMLElement>("#plant-list-label")!;
const canvas = document.querySelector<HTMLCanvasElement>("#garden")!;
const canvasBase = document.querySelector<HTMLCanvasElement>("#garden-base")!;
const canvasHead = document.querySelector<HTMLCanvasElement>("#garden-head")!;
const stageSingle = document.querySelector<HTMLElement>("#stage-single")!;
const stageCompare = document.querySelector<HTMLElement>("#stage-compare")!;
const granularityEl = document.querySelector<HTMLSelectElement>("#granularity")!;
const baseBranchEl = document.querySelector<HTMLSelectElement>("#base-branch")!;
const headBranchEl = document.querySelector<HTMLSelectElement>("#head-branch")!;
const exitCompareBtn = document.querySelector<HTMLButtonElement>("#exit-compare")!;
const timelineBar = document.querySelector<HTMLElement>("#timeline-bar")!;
const timelineRange = document.querySelector<HTMLInputElement>("#timeline-range")!;
const timelineDate = document.querySelector<HTMLSpanElement>("#timeline-date")!;
const timelinePlayBtn = document.querySelector<HTMLButtonElement>("#timeline-play")!;

let renderer: GardenRenderer | null = null;
let rendererBase: GardenRenderer | null = null;
let rendererHead: GardenRenderer | null = null;
let snapshot: GardenSnapshot | null = null;
let compareMode = false;
let timelineFrames: TimelineFramePayload[] = [];
let timelineIndex = 0;
let playing = false;
let playTimer: number | null = null;
let currentRoot = "";

function activeDrawer(): HTMLElement {
  return compareMode ? drawerCompareEl : drawerEl;
}

async function loadRecent() {
  const res = await fetch("/api/recent");
  const data = (await res.json()) as {
    recent: Array<{ path: string; projectId: string }>;
  };
  const box = document.querySelector("#recent")!;
  box.innerHTML = "";
  for (const r of data.recent ?? []) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r.path;
    b.title = r.projectId;
    b.addEventListener("click", () => {
      pathEl.value = r.path;
      void loadBranches(r.path, false);
      void grow();
    });
    box.appendChild(b);
  }
}

document.querySelector("#browse")!.addEventListener("click", () => {
  void openBrowser(pathEl.value.trim() || undefined);
});

document.querySelector("#browser-cancel")!.addEventListener("click", () => {
  closeBrowser();
});

document.querySelector("#browser-choose")!.addEventListener("click", async () => {
  if (!browserCurrent) return;
  pathEl.value = browserCurrent;
  closeBrowser();
  await loadBranches(browserCurrent, false);
  await grow();
});

document.querySelector("#browser-up")!.addEventListener("click", () => {
  if (browserParent) void loadBrowser(browserParent);
  else void loadRoots();
});

let browserCurrent = "";
let browserParent: string | null = null;

function closeBrowser() {
  document.querySelector<HTMLElement>("#browser")!.hidden = true;
}

async function openBrowser(start?: string) {
  const panel = document.querySelector<HTMLElement>("#browser")!;
  panel.hidden = false;
  notesEl.textContent = "在列表中进入目录，然后点「选择此文件夹」";
  if (start) {
    try {
      await loadBrowser(start);
      return;
    } catch {
      /* fall through to roots */
    }
  }
  await loadRoots();
}

async function loadRoots() {
  const res = await fetch("/api/fs/roots");
  const data = (await res.json()) as {
    roots: Array<{ name: string; path: string }>;
  };
  browserCurrent = "";
  browserParent = null;
  document.querySelector("#browser-path")!.textContent = "此电脑";
  renderBrowserEntries(
    data.roots.map((r) => ({ name: r.name, path: r.path })),
  );
}

async function loadBrowser(dir: string) {
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dir)}`);
  const data = (await res.json()) as {
    path?: string;
    parent?: string | null;
    entries?: Array<{ name: string; path: string }>;
    error?: string;
  };
  if (!res.ok) {
    notesEl.textContent = data.error || "无法打开该目录";
    throw new Error(data.error || "list failed");
  }
  browserCurrent = data.path!;
  browserParent = data.parent ?? null;
  document.querySelector("#browser-path")!.textContent = browserCurrent;
  renderBrowserEntries(data.entries ?? []);
}

function renderBrowserEntries(entries: Array<{ name: string; path: string }>) {
  const list = document.querySelector("#browser-list")!;
  list.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "browser-empty";
    empty.textContent = "（没有子文件夹）";
    list.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "browser-item";
    row.innerHTML = `<span class="folder-icon"></span><span>${escapeHtml(entry.name)}</span>`;
    row.addEventListener("click", () => void loadBrowser(entry.path));
    list.appendChild(row);
  }
}

document.querySelector("#grow")!.addEventListener("click", () => void grow());

pathEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void grow();
});

function meter(label: string, value: number, kind: "ok" | "warn" | "bad" = "ok") {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="meter"><span>${label}</span><div class="track"><div class="fill ${kind === "ok" ? "" : kind}" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
}

function depList(title: string, items: Plant["dependsOn"]) {
  if (!items.length) {
    return `<div class="dep-block"><div class="dep-title">${title}</div><div class="dep-empty">无</div></div>`;
  }
  return `<div class="dep-block"><div class="dep-title">${title}</div>${items
    .map((d) => {
      const cls = d.kind === "cycle" ? "dep cycle" : "dep";
      return `<button type="button" class="${cls}" data-id="${escapeHtml(d.id)}">
        <span>${escapeHtml(d.label)}</span>
        <span class="w">×${d.weight}</span>
      </button>`;
    })
    .join("")}</div>`;
}

function showPlant(plant: Plant | null, sourceSnapshot?: GardenSnapshot | null) {
  const snap = sourceSnapshot ?? snapshot;
  const drawer = activeDrawer();
  if (!plant || !snap) {
    drawer.classList.remove("open");
    renderer?.setSelected(null);
    rendererBase?.setSelected(null);
    rendererHead?.setSelected(null);
    highlightPlantList(null);
    return;
  }
  if (compareMode) {
    rendererBase?.setSelected(plant.id);
    rendererHead?.setSelected(plant.id);
  } else {
    renderer?.setSelected(plant.id);
  }
  highlightPlantList(plant.id);

  const covKind = !plant.metrics.coverageKnown
    ? "ok"
    : plant.metrics.coverage < 0.4
      ? "bad"
      : plant.metrics.coverage < 0.6
        ? "warn"
        : "ok";
  const coupKind = plant.metrics.coupling > 0.7 ? "bad" : "ok";
  const healthKind =
    plant.metrics.health < 0.4 ? "bad" : plant.metrics.health < 0.65 ? "warn" : "ok";

  drawer.classList.add("open");
  drawer.innerHTML = `
    <button type="button" class="drawer-close" id="drawer-close">关闭</button>
    <h3>${escapeHtml(plant.label)}</h3>
    <div class="path">${escapeHtml(plant.path ?? "")}</div>
    <div class="state-pill state-${plant.state}">${STATE_ZH[plant.state] ?? plant.state}${
      plant.layer ? ` · ${plant.layer}` : ""
    }</div>
    <div class="species-line">${escapeHtml(speciesLabel(plant))} · ${escapeHtml(langMix(plant))}</div>

    ${meter("健康度", plant.metrics.health, healthKind)}
    ${meter(
      plant.metrics.coverageKnown ? "覆盖率" : "覆盖率(未知)",
      plant.metrics.coverageKnown ? plant.metrics.coverage : 0,
      covKind,
    )}
    ${meter("耦合度", plant.metrics.coupling, coupKind)}
    ${meter("近期活跃", plant.metrics.churn)}

    <div class="stat-grid">
      <div><b>${plant.metrics.fileCount}</b><span>文件</span></div>
      <div><b>${plant.metrics.loc}</b><span>行数</span></div>
      <div><b>${plant.metrics.fanIn}</b><span>被依赖</span></div>
      <div><b>${plant.metrics.fanOut}</b><span>依赖出</span></div>
    </div>

    <div class="violations">${
      plant.violations.length
        ? plant.violations
            .map((v) => `<div class="v-${v.severity}">• ${escapeHtml(v.message)}</div>`)
            .join("")
        : '<div class="v-ok">无架构违规</div>'
    }</div>

    ${depList("依赖 →", plant.dependsOn)}
    ${depList("← 被依赖", plant.dependedBy)}
  `;

  drawer.querySelector("#drawer-close")?.addEventListener("click", () => {
    showPlant(null);
  });

  drawer.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const next = snap.plants.find((p) => p.id === id) ?? null;
      showPlant(next, snap);
    });
  });
}

function highlightPlantList(id: string | null) {
  plantListEl.querySelectorAll(".plant-row").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-id") === id);
  });
}

function renderReport(s: GardenSnapshot) {
  const r = s.report;
  reportEl.hidden = false;
  plantListLabel.hidden = false;

  const sc = r.stateCounts;
  reportEl.innerHTML = `
    <div class="report-title">分析摘要</div>
    <div class="report-kpis">
      <div><b>${r.plantCount}</b>模块</div>
      <div><b>${r.vineCount}</b>依赖</div>
      <div><b>${Math.round(r.avgHealth * 100)}%</b>健康</div>
      <div><b>${r.cycleCount}</b>循环</div>
    </div>
    <div class="report-states">
      <span>健康 ${sc.healthy}</span>
      <span>开花 ${sc.blooming}</span>
      <span>枯萎 ${sc.wilting}</span>
      <span>濒死 ${sc.dying}</span>
      <span>缠绕 ${sc.entangled}</span>
    </div>
    <div class="report-meta">${r.totalFiles} 文件 · ~${r.totalLoc} 行</div>
    ${
      r.cycles.length
        ? `<div class="report-section"><div class="report-h">循环依赖</div>${r.cycles
            .map(
              (c) =>
                `<div class="cycle-line">${escapeHtml(c.labels.join(" ↔ "))}</div>`,
            )
            .join("")}</div>`
        : ""
    }
    ${
      r.hotspots.length
        ? `<div class="report-section"><div class="report-h">问题热点</div>${r.hotspots
            .map(
              (h) =>
                `<button type="button" class="hotspot" data-id="${escapeHtml(h.id)}">
                  <strong>${escapeHtml(h.label)}</strong>
                  <span>${escapeHtml(h.reason)}</span>
                </button>`,
            )
            .join("")}</div>`
        : '<div class="report-section"><div class="report-h">问题热点</div><div class="dep-empty">暂无明显问题</div></div>'
    }
    <div class="report-section"><div class="report-h">耦合 Top</div>${r.topCoupled
      .map(
        (t) =>
          `<button type="button" class="hotspot" data-id="${escapeHtml(t.id)}">
            <strong>${escapeHtml(t.label)}</strong>
            <span>${Math.round(t.coupling * 100)}%</span>
          </button>`,
      )
      .join("")}</div>
  `;

  reportEl.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const plant = s.plants.find((p) => p.id === btn.dataset.id) ?? null;
      showPlant(plant, s);
    });
  });

  const sorted = [...s.plants].sort((a, b) => a.metrics.health - b.metrics.health);
  plantListEl.innerHTML = sorted
    .map(
      (p) => `
      <button type="button" class="plant-row state-${p.state}" data-id="${escapeHtml(p.id)}">
        <span class="dot"></span>
        <span class="name">${escapeHtml(p.label)}</span>
        <span class="score">${Math.round(p.metrics.health * 100)}</span>
      </button>`,
    )
    .join("");

  plantListEl.querySelectorAll<HTMLButtonElement>(".plant-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const plant = s.plants.find((p) => p.id === btn.dataset.id) ?? null;
      showPlant(plant, s);
    });
  });
}

function renderDiffReport(diff: GardenDiffPayload) {
  reportEl.hidden = false;
  plantListLabel.hidden = false;
  reportEl.innerHTML = `
    <div class="report-title">PR 花园对比</div>
    <div class="report-meta">${escapeHtml(diff.baseRef)} → ${escapeHtml(diff.headRef)}</div>
    <div class="diff-summary">${escapeHtml(diff.summary)}</div>
    <div class="report-kpis">
      <div><b>${diff.worsenedIds.length}</b>变差</div>
      <div><b>${diff.improvedIds.length}</b>好转</div>
      <div><b>${diff.addedIds.length}</b>新增</div>
      <div><b>${diff.removedIds.length}</b>移除</div>
    </div>
    ${
      diff.bullets.length
        ? `<div class="report-section"><div class="report-h">要点</div>${diff.bullets
            .map((b) => `<div class="diff-bullet">${escapeHtml(b)}</div>`)
            .join("")}</div>`
        : ""
    }
    <div class="report-section"><div class="report-h">模块变化</div>${
      diff.plantChanges.length
        ? diff.plantChanges
            .slice(0, 16)
            .map(
              (c) =>
                `<button type="button" class="hotspot" data-id="${escapeHtml(c.id)}">
                  <strong>${escapeHtml(c.label)}</strong>
                  <span>${escapeHtml(c.detail)}</span>
                </button>`,
            )
            .join("")
        : '<div class="dep-empty">无模块变化</div>'
    }</div>
  `;

  reportEl.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const onHead = diff.head.plants.some((p) => p.id === id);
      const plant =
        diff.head.plants.find((p) => p.id === id) ??
        diff.base.plants.find((p) => p.id === id) ??
        null;
      showPlant(plant, onHead ? diff.head : diff.base);
    });
  });

  const focusIds = new Set([
    ...diff.worsenedIds,
    ...diff.addedIds,
    ...diff.removedIds,
    ...diff.improvedIds,
  ]);
  const rows = [
    ...diff.head.plants.filter((p) => focusIds.has(p.id)),
    ...diff.base.plants.filter(
      (p) => diff.removedIds.includes(p.id) && !diff.head.plants.some((h) => h.id === p.id),
    ),
  ];
  plantListEl.innerHTML = rows
    .map((p) => {
      let tag = "";
      if (diff.worsenedIds.includes(p.id)) tag = "↓";
      else if (diff.improvedIds.includes(p.id)) tag = "↑";
      else if (diff.addedIds.includes(p.id)) tag = "+";
      else if (diff.removedIds.includes(p.id)) tag = "−";
      return `<button type="button" class="plant-row state-${p.state}" data-id="${escapeHtml(p.id)}">
        <span class="dot"></span>
        <span class="name">${escapeHtml(p.label)}</span>
        <span class="score">${tag}</span>
      </button>`;
    })
    .join("");

  plantListEl.querySelectorAll<HTMLButtonElement>(".plant-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const onHead = diff.head.plants.some((p) => p.id === id);
      const plant =
        diff.head.plants.find((p) => p.id === id) ??
        diff.base.plants.find((p) => p.id === id) ??
        null;
      showPlant(plant, onHead ? diff.head : diff.base);
    });
  });
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badgeMap(diff: GardenDiffPayload): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of diff.worsenedIds) map[id] = "变差";
  for (const id of diff.improvedIds) map[id] = "好转";
  for (const id of diff.addedIds) map[id] = "新增";
  for (const id of diff.removedIds) map[id] = "移除";
  return map;
}

function enterCompareMode(diff: GardenDiffPayload) {
  compareMode = true;
  snapshot = diff.head;
  stageSingle.hidden = true;
  stageCompare.hidden = false;
  exitCompareBtn.hidden = false;
  timelineBar.hidden = true;
  emptyEl.style.display = "none";

  const badges = badgeMap(diff);
  const baseHighlights = [
    ...diff.worsenedIds,
    ...diff.removedIds,
    ...diff.vineChanges.flatMap((v) =>
      v.toKind === "cycle" || v.kind === "added" ? [v.from, v.to] : [],
    ),
  ];
  const headHighlights = [
    ...diff.worsenedIds,
    ...diff.addedIds,
    ...diff.improvedIds,
    ...diff.vineChanges.flatMap((v) =>
      v.toKind === "cycle" || v.kind === "added" ? [v.from, v.to] : [],
    ),
  ];

  const onSelect = (plant: Plant | null) => {
    if (!plant) {
      showPlant(null);
      return;
    }
    const onHead = diff.head.plants.some((p) => p.id === plant.id);
    showPlant(plant, onHead ? diff.head : diff.base);
  };

  if (!rendererBase) {
    rendererBase = new GardenRenderer({
      canvas: canvasBase,
      snapshot: diff.base,
      onSelect,
      highlightIds: baseHighlights,
      badges,
      title: `Base · ${diff.baseRef}`,
    });
  } else {
    rendererBase.setSnapshot(diff.base);
    rendererBase.setHighlights(baseHighlights);
    rendererBase.setBadges(badges);
    rendererBase.setTitle(`Base · ${diff.baseRef}`);
    rendererBase.resize();
  }

  if (!rendererHead) {
    rendererHead = new GardenRenderer({
      canvas: canvasHead,
      snapshot: diff.head,
      onSelect,
      highlightIds: headHighlights,
      badges,
      title: `Head · ${diff.headRef}`,
    });
  } else {
    rendererHead.setSnapshot(diff.head);
    rendererHead.setHighlights(headHighlights);
    rendererHead.setBadges(badges);
    rendererHead.setTitle(`Head · ${diff.headRef}`);
    rendererHead.resize();
  }

  window.addEventListener("resize", resizeCompare);
  resizeCompare();
  renderDiffReport(diff);
  showPlant(null);
  barEl.innerHTML = `<span>双花园 · <strong>${escapeHtml(diff.baseRef)}</strong> → <strong>${escapeHtml(
    diff.headRef,
  )}</strong></span><em>${escapeHtml(diff.summary)}</em>`;
}

function resizeCompare() {
  rendererBase?.resize();
  rendererHead?.resize();
}

function exitCompareMode() {
  compareMode = false;
  stageCompare.hidden = true;
  stageSingle.hidden = false;
  exitCompareBtn.hidden = true;
  drawerCompareEl.classList.remove("open");
  if (snapshot) {
    renderReport(snapshot);
    if (renderer) {
      renderer.setSnapshot(snapshot);
      renderer.setHighlights(null);
      renderer.setBadges(null);
      renderer.setTitle(null);
      renderer.resize();
    }
    timelineBar.hidden = timelineFrames.length < 2;
  }
}

document.querySelector("#compare")!.addEventListener("click", () => void runCompare());
document.querySelector("#refresh-branches")!.addEventListener("click", () => {
  void loadBranches(pathEl.value.trim() || currentRoot);
});
exitCompareBtn.addEventListener("click", () => {
  exitCompareMode();
  if (snapshot) {
    barEl.innerHTML = `<span>今日花园 · <strong>${escapeHtml(
      snapshot.meta.projectId,
    )}</strong></span><em>已退出对比</em>`;
  }
});

interface BranchListResponse {
  branches?: Array<{
    name: string;
    tip: string;
    current: boolean;
    remote: boolean;
  }>;
  current?: string | null;
  defaultBase?: string | null;
  defaultHead?: string | null;
  error?: string;
}

function fillBranchSelect(
  el: HTMLSelectElement,
  branches: NonNullable<BranchListResponse["branches"]>,
  selected: string | null,
) {
  el.innerHTML = "";
  if (!branches.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（无分支）";
    el.appendChild(opt);
    el.disabled = true;
    return;
  }
  el.disabled = false;
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = b.name;
    const mark = b.current ? " ●" : "";
    const remote = b.remote ? " (remote)" : "";
    opt.textContent = `${b.name}${mark}${remote} · ${b.tip}`;
    el.appendChild(opt);
  }
  if (selected && branches.some((b) => b.name === selected)) {
    el.value = selected;
  }
}

async function loadBranches(rootPath: string, preferKeep = true) {
  if (!rootPath) {
    baseBranchEl.innerHTML = '<option value="">先选择项目路径…</option>';
    headBranchEl.innerHTML = '<option value="">先选择项目路径…</option>';
    baseBranchEl.disabled = true;
    headBranchEl.disabled = true;
    return;
  }
  const prevBase = preferKeep ? baseBranchEl.value : "";
  const prevHead = preferKeep ? headBranchEl.value : "";
  baseBranchEl.disabled = true;
  headBranchEl.disabled = true;
  try {
    const res = await fetch(
      `/api/branches?rootPath=${encodeURIComponent(rootPath)}`,
    );
    const data = (await res.json()) as BranchListResponse;
    if (!res.ok) {
      baseBranchEl.innerHTML = `<option value="">${escapeHtml(data.error || "无法读取分支")}</option>`;
      headBranchEl.innerHTML = `<option value="">${escapeHtml(data.error || "无法读取分支")}</option>`;
      return;
    }
    const branches = data.branches ?? [];
    const baseSel =
      (prevBase && branches.some((b) => b.name === prevBase) && prevBase) ||
      data.defaultBase ||
      null;
    const headSel =
      (prevHead && branches.some((b) => b.name === prevHead) && prevHead) ||
      data.defaultHead ||
      null;
    fillBranchSelect(baseBranchEl, branches, baseSel);
    fillBranchSelect(headBranchEl, branches, headSel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    baseBranchEl.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
    headBranchEl.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
  }
}

async function runCompare() {
  const rootPath = pathEl.value.trim() || currentRoot;
  if (!rootPath) {
    notesEl.textContent = "请先填写项目路径";
    return;
  }
  const baseRef = baseBranchEl.value.trim();
  const headRef = headBranchEl.value.trim();
  if (!baseRef || !headRef) {
    notesEl.textContent = "请从下拉框选择 Base / Head 分支";
    void loadBranches(rootPath);
    return;
  }
  if (baseRef === headRef) {
    notesEl.textContent = "请选择两个不同的分支";
    return;
  }
  currentRoot = rootPath;
  notesEl.textContent = `对比分支 tip：${baseRef} → ${headRef}（临时 worktree）…`;
  barEl.textContent = `分析 ${baseRef} → ${headRef}…`;
  stopPlayback();
  try {
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath,
        baseRef,
        headRef,
        granularity: granularityEl.value,
      }),
    });
    const data = (await res.json()) as {
      diff?: GardenDiffPayload;
      summary?: string;
      error?: string;
    };
    if (!res.ok || !data.diff) {
      notesEl.textContent = data.error || "对比失败";
      return;
    }
    notesEl.textContent = [
      `✓ 分支 tip 对比 ${baseRef} → ${headRef}`,
      `✓ ${data.diff.summary}`,
      ...data.diff.bullets.slice(0, 5).map((b) => `· ${b}`),
    ].join("\n");
    enterCompareMode(data.diff);
  } catch (err) {
    notesEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function stopPlayback() {
  playing = false;
  timelinePlayBtn.textContent = "回放";
  if (playTimer != null) {
    window.clearInterval(playTimer);
    playTimer = null;
  }
}

function showFrame(index: number) {
  if (!timelineFrames.length || compareMode) return;
  timelineIndex = Math.max(0, Math.min(timelineFrames.length - 1, index));
  timelineRange.value = String(timelineIndex);
  const frame = timelineFrames[timelineIndex]!;
  timelineDate.textContent = frame.date;
  const snap = frame.snapshot;
  if (!snap) return;
  snapshot = snap;
  if (!renderer) {
    renderer = new GardenRenderer({
      canvas,
      snapshot: snap,
      onSelect: showPlant,
    });
    window.addEventListener("resize", () => renderer?.resize());
  } else {
    renderer.setSnapshot(snap);
    renderer.resize();
  }
  showPlant(null);
  emptyEl.style.display = "none";
  const delta = frame.delta;
  if (delta) {
    const bits = [
      delta.bloomed.length ? `开花 ${delta.bloomed.length}` : "",
      delta.wilted.length ? `枯萎 ${delta.wilted.length}` : "",
      delta.newPollution.length ? `新污染 ${delta.newPollution.length}` : "",
      delta.newCycles.length ? `新循环 ${delta.newCycles.length}` : "",
    ].filter(Boolean);
    barEl.innerHTML = `<span>${escapeHtml(frame.date)}</span><em>${
      bits.length ? escapeHtml(bits.join(" · ")) : "状态稳定"
    }</em>`;
  }
}

function setupTimeline(frames: TimelineFramePayload[]) {
  timelineFrames = frames.filter((f) => f.snapshot);
  timelineBar.hidden = compareMode || timelineFrames.length < 2;
  if (timelineFrames.length < 2) return;
  timelineRange.min = "0";
  timelineRange.max = String(timelineFrames.length - 1);
  timelineIndex = timelineFrames.length - 1;
  showFrame(timelineIndex);
}

timelineRange.addEventListener("input", () => {
  stopPlayback();
  showFrame(Number(timelineRange.value));
});

document.querySelector("#timeline-prev")!.addEventListener("click", () => {
  stopPlayback();
  showFrame(timelineIndex - 1);
});

document.querySelector("#timeline-next")!.addEventListener("click", () => {
  stopPlayback();
  showFrame(timelineIndex + 1);
});

timelinePlayBtn.addEventListener("click", () => {
  if (!timelineFrames.length) return;
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  timelinePlayBtn.textContent = "暂停";
  if (timelineIndex >= timelineFrames.length - 1) showFrame(0);
  playTimer = window.setInterval(() => {
    if (timelineIndex >= timelineFrames.length - 1) {
      stopPlayback();
      return;
    }
    showFrame(timelineIndex + 1);
  }, 850);
});

document.querySelector("#timeline-build")!.addEventListener("click", async () => {
  if (!currentRoot) {
    notesEl.textContent = "请先选择并生长一个项目";
    return;
  }
  notesEl.textContent = "正在从 git 生成时间轴（可能需要一些时间）…";
  stopPlayback();
  try {
    const res = await fetch("/api/timeline/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: currentRoot,
        days: 30,
        frames: 12,
        granularity: granularityEl.value,
      }),
    });
    const data = (await res.json()) as {
      frames?: TimelineFramePayload[];
      error?: string;
    };
    if (!res.ok) {
      notesEl.textContent = data.error || "生成失败";
      return;
    }
    setupTimeline(data.frames ?? []);
    notesEl.textContent = `✓ 时间轴 ${timelineFrames.length} 帧已就绪，点「回放」观看演化`;
  } catch (err) {
    notesEl.textContent = err instanceof Error ? err.message : String(err);
  }
});

async function grow() {
  const rootPath = pathEl.value.trim();
  if (!rootPath) {
    notesEl.textContent = "请先填写或选择路径";
    return;
  }
  currentRoot = rootPath;
  if (compareMode) exitCompareMode();
  notesEl.textContent = "构建中…";
  barEl.textContent = "探测结构 → 解析依赖 → 规则 → 布局…";
  stopPlayback();
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath,
        granularity: granularityEl.value,
      }),
    });
    const data = (await res.json()) as AnalyzeResponse;
    if (!res.ok) {
      notesEl.textContent = data.error || "分析失败";
      return;
    }
    snapshot = data.snapshot;
    emptyEl.style.display = "none";
    notesEl.textContent = (snapshot.meta.notes ?? [])
      .map((n) => `✓ ${n}`)
      .join("\n");
    barEl.innerHTML = `<span>今日花园 · <strong>${escapeHtml(
      snapshot.meta.projectId,
    )}</strong></span><em>${escapeHtml(data.summary)}</em>`;

    renderReport(snapshot);

    if (!renderer) {
      renderer = new GardenRenderer({
        canvas,
        snapshot,
        onSelect: showPlant,
      });
      window.addEventListener("resize", () => renderer?.resize());
    } else {
      renderer.setSnapshot(snapshot);
      renderer.setHighlights(null);
      renderer.setBadges(null);
      renderer.resize();
    }
    showPlant(null);
    await loadRecent();
    await loadBranches(rootPath, false);

    try {
      const tr = await fetch(
        `/api/timeline?rootPath=${encodeURIComponent(rootPath)}`,
      );
      if (tr.ok) {
        const td = (await tr.json()) as { frames: TimelineFramePayload[] };
        setupTimeline(td.frames ?? []);
      } else {
        timelineBar.hidden = false;
        timelineFrames = [
          {
            date: snapshot.meta.capturedAt.slice(0, 10),
            snapshotRef: ".flora/snapshot.json",
            snapshot,
          },
        ];
        timelineRange.min = "0";
        timelineRange.max = "0";
        timelineDate.textContent = timelineFrames[0]!.date;
      }
    } catch {
      timelineBar.hidden = false;
    }
  } catch (err) {
    notesEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

void loadRecent();
