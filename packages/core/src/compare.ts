import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyze } from "./analyze.js";
import type {
  AggregateGranularity,
  GardenSnapshot,
  Plant,
  PlantState,
  Vine,
} from "./types.js";
import { STATE_LABELS } from "./types.js";

const execFileAsync = promisify(execFile);

export interface PlantChange {
  id: string;
  label: string;
  kind: "added" | "removed" | "state" | "metrics";
  fromState?: PlantState;
  toState?: PlantState;
  detail: string;
}

export interface VineChange {
  id: string;
  from: string;
  to: string;
  kind: "added" | "removed" | "kind-changed";
  fromKind?: Vine["kind"];
  toKind?: Vine["kind"];
  detail: string;
}

export interface GardenDiff {
  baseRef: string;
  headRef: string;
  base: GardenSnapshot;
  head: GardenSnapshot;
  summary: string;
  bullets: string[];
  plantChanges: PlantChange[];
  vineChanges: VineChange[];
  /** plant ids that worsened (for highlight) */
  worsenedIds: string[];
  /** plant ids that improved */
  improvedIds: string[];
  /** plant ids new on head */
  addedIds: string[];
  /** plant ids gone on head */
  removedIds: string[];
}

const WORSE: PlantState[] = ["healthy", "blooming", "wilting", "entangled", "dying"];

function severity(state: PlantState): number {
  return WORSE.indexOf(state);
}

export function diffGardens(
  base: GardenSnapshot,
  head: GardenSnapshot,
  baseRef = "base",
  headRef = "head",
): GardenDiff {
  const basePlants = new Map(base.plants.map((p) => [p.id, p]));
  const headPlants = new Map(head.plants.map((p) => [p.id, p]));
  const baseVines = new Map(base.vines.map((v) => [vineKey(v), v]));
  const headVines = new Map(head.vines.map((v) => [vineKey(v), v]));

  const plantChanges: PlantChange[] = [];
  const worsenedIds: string[] = [];
  const improvedIds: string[] = [];
  const addedIds: string[] = [];
  const removedIds: string[] = [];

  for (const [id, hp] of headPlants) {
    const bp = basePlants.get(id);
    if (!bp) {
      addedIds.push(id);
      plantChanges.push({
        id,
        label: hp.label,
        kind: "added",
        toState: hp.state,
        detail: `新模块出现（${STATE_LABELS[hp.state]}）`,
      });
      continue;
    }
    if (bp.state !== hp.state) {
      plantChanges.push({
        id,
        label: hp.label,
        kind: "state",
        fromState: bp.state,
        toState: hp.state,
        detail: `${STATE_LABELS[bp.state]} → ${STATE_LABELS[hp.state]}`,
      });
      if (severity(hp.state) > severity(bp.state)) worsenedIds.push(id);
      else improvedIds.push(id);
    } else if (
      Math.abs(bp.metrics.coupling - hp.metrics.coupling) > 0.15 ||
      Math.abs(bp.metrics.health - hp.metrics.health) > 0.12
    ) {
      plantChanges.push({
        id,
        label: hp.label,
        kind: "metrics",
        fromState: bp.state,
        toState: hp.state,
        detail: `健康 ${Math.round(bp.metrics.health * 100)}% → ${Math.round(hp.metrics.health * 100)}%，耦合 ${Math.round(bp.metrics.coupling * 100)}% → ${Math.round(hp.metrics.coupling * 100)}%`,
      });
      if (hp.metrics.health < bp.metrics.health - 0.05) worsenedIds.push(id);
      else if (hp.metrics.health > bp.metrics.health + 0.05) improvedIds.push(id);
    }
  }

  for (const [id, bp] of basePlants) {
    if (!headPlants.has(id)) {
      removedIds.push(id);
      plantChanges.push({
        id,
        label: bp.label,
        kind: "removed",
        fromState: bp.state,
        detail: "模块消失",
      });
    }
  }

  const vineChanges: VineChange[] = [];
  for (const [key, hv] of headVines) {
    const bv = baseVines.get(key);
    if (!bv) {
      vineChanges.push({
        id: hv.id,
        from: hv.from,
        to: hv.to,
        kind: "added",
        toKind: hv.kind,
        detail:
          hv.kind === "cycle"
            ? "长出寄生藤（循环）"
            : hv.kind === "illegal"
              ? "长出违规藤"
              : "新增依赖",
      });
    } else if (bv.kind !== hv.kind) {
      vineChanges.push({
        id: hv.id,
        from: hv.from,
        to: hv.to,
        kind: "kind-changed",
        fromKind: bv.kind,
        toKind: hv.kind,
        detail: `藤蔓性质 ${bv.kind} → ${hv.kind}`,
      });
    }
  }
  for (const [key, bv] of baseVines) {
    if (!headVines.has(key)) {
      vineChanges.push({
        id: bv.id,
        from: bv.from,
        to: bv.to,
        kind: "removed",
        fromKind: bv.kind,
        detail: "依赖消失",
      });
    }
  }

  const bullets: string[] = [];
  for (const c of plantChanges.filter((x) => x.kind === "state").slice(0, 5)) {
    bullets.push(`${c.label}: ${c.detail}`);
  }
  for (const c of vineChanges.filter((x) => x.toKind === "cycle" || x.kind === "added").slice(0, 4)) {
    const from = headPlants.get(c.from)?.label ?? basePlants.get(c.from)?.label ?? c.from;
    const to = headPlants.get(c.to)?.label ?? basePlants.get(c.to)?.label ?? c.to;
    bullets.push(`${from} → ${to}: ${c.detail}`);
  }
  if (addedIds.length) bullets.push(`新增模块 ${addedIds.length} 个`);
  if (removedIds.length) bullets.push(`移除模块 ${removedIds.length} 个`);

  const wilted = plantChanges.filter(
    (c) => c.toState === "wilting" || c.toState === "dying" || c.toState === "entangled",
  );
  const summaryParts = [
    wilted.length ? `${wilted.length} 株变差` : "无明显枯萎",
    vineChanges.filter((v) => v.toKind === "cycle").length
      ? `新循环 ${vineChanges.filter((v) => v.toKind === "cycle").length}`
      : "无新循环",
    vineChanges.filter((v) => v.toKind === "illegal").length
      ? `新违规藤 ${vineChanges.filter((v) => v.toKind === "illegal").length}`
      : null,
    improvedIds.length ? `好转 ${improvedIds.length}` : null,
  ].filter(Boolean);

  return {
    baseRef,
    headRef,
    base,
    head,
    summary: summaryParts.join(" · "),
    bullets: bullets.slice(0, 8),
    plantChanges,
    vineChanges,
    worsenedIds,
    improvedIds,
    addedIds,
    removedIds,
  };
}

function vineKey(v: Vine): string {
  return `${v.from}→${v.to}`;
}

/** Analyze a git ref via temporary worktree (no lasting checkout).
 *  Branch / commit / HEAD → tip of that ref (committed tree).
 *  `.` / `WORKTREE` → dirty working tree. */
export async function analyzeAtRef(options: {
  rootPath: string;
  ref: string;
  granularity?: AggregateGranularity;
  rulesPath?: string;
}): Promise<GardenSnapshot> {
  const rootPath = path.resolve(options.rootPath);
  const ref = options.ref.trim();

  if (ref === "." || ref === "WORKTREE") {
    return analyze({
      rootPath,
      granularity: options.granularity ?? "auto",
      rulesPath: options.rulesPath,
      writeSnapshot: false,
      appendTimeline: false,
    });
  }

  let resolved: string;
  try {
    // Prefer commit tip of the branch/ref (not the working tree)
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", `${ref}^{commit}`],
      { cwd: rootPath },
    );
    resolved = stdout.trim();
  } catch {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", ref], {
        cwd: rootPath,
      });
      resolved = stdout.trim();
    } catch {
      throw new Error(`无法解析 git 分支/提交: ${ref}`);
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flora-wt-"));
  try {
    await execFileAsync(
      "git",
      ["worktree", "add", "--detach", tmp, resolved],
      { cwd: rootPath },
    );
    return await analyze({
      rootPath: tmp,
      granularity: options.granularity ?? "auto",
      rulesPath: options.rulesPath,
      writeSnapshot: false,
      appendTimeline: false,
    });
  } finally {
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", tmp], {
        cwd: rootPath,
      });
    } catch {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export interface GitBranchInfo {
  name: string;
  /** short sha of tip */
  tip: string;
  current: boolean;
  remote: boolean;
}

/** List local + remote branches with tip SHAs for PR compare dropdowns. */
export async function listGitBranches(rootPath: string): Promise<{
  branches: GitBranchInfo[];
  current: string | null;
  defaultBase: string | null;
  defaultHead: string | null;
}> {
  const root = path.resolve(rootPath);
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
    });
  } catch {
    throw new Error("不是 git 仓库，无法列出分支");
  }

  let current: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      { cwd: root },
    );
    current = stdout.trim() || null;
  } catch {
    current = null;
  }

  const { stdout } = await execFileAsync(
    "git",
    [
      "for-each-ref",
      "--format=%(refname:short)|%(objectname:short)|%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd: root },
  );

  const branches: GitBranchInfo[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, tip, headMark] = line.split("|");
    if (!name || !tip) continue;
    // skip remote HEAD pointer
    if (name.endsWith("/HEAD") || name === "origin/HEAD") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const remote = name.includes("/");
    branches.push({
      name,
      tip,
      current: headMark === "*" || name === current,
      remote,
    });
  }

  // locals first, then remotes; prefer main/master near top among locals
  branches.sort((a, b) => {
    if (a.remote !== b.remote) return a.remote ? 1 : -1;
    const score = (n: string) =>
      n === "main" || n === "master" ? 0 : n === current ? 1 : 2;
    const ds = score(a.name) - score(b.name);
    if (ds !== 0) return ds;
    return a.name.localeCompare(b.name);
  });

  const localNames = branches.filter((b) => !b.remote).map((b) => b.name);
  const allNames = branches.map((b) => b.name);
  const pick = (...cands: Array<string | null | undefined>) => {
    for (const c of cands) {
      if (c && allNames.includes(c)) return c;
    }
    return null;
  };

  const defaultBase =
    pick("main", "master", "develop", "origin/main", "origin/master") ??
    localNames.find((n) => n !== current) ??
    localNames[0] ??
    allNames[0] ??
    null;

  const defaultHead =
    pick(current) ??
    localNames.find((n) => n !== defaultBase) ??
    allNames.find((n) => n !== defaultBase) ??
    allNames[0] ??
    null;

  return { branches, current, defaultBase, defaultHead };
}

export async function compareRefs(options: {
  rootPath: string;
  baseRef: string;
  headRef?: string;
  granularity?: AggregateGranularity;
  rulesPath?: string;
}): Promise<GardenDiff> {
  const headRef = options.headRef ?? "HEAD";
  if (options.baseRef === headRef) {
    throw new Error("请选择两个不同的分支进行对比");
  }

  const [base, head] = await Promise.all([
    analyzeAtRef({
      rootPath: options.rootPath,
      ref: options.baseRef,
      granularity: options.granularity,
      rulesPath: options.rulesPath,
    }),
    analyzeAtRef({
      rootPath: options.rootPath,
      ref: headRef,
      granularity: options.granularity,
      rulesPath: options.rulesPath,
    }),
  ]);

  // Align layout: reuse head positions onto base where ids match for easier comparison
  for (const id of Object.keys(base.layout.positions)) {
    if (head.layout.positions[id]) {
      base.layout.positions[id] = { ...head.layout.positions[id]! };
    }
  }

  return diffGardens(base, head, options.baseRef, headRef);
}

/** Human one-liner for PR comments */
export function formatDiffComment(diff: GardenDiff): string {
  const lines = [
    `### Flora 花园对比 \`${diff.baseRef}\` → \`${diff.headRef}\``,
    "",
    diff.summary,
    "",
  ];
  if (diff.bullets.length) {
    for (const b of diff.bullets) lines.push(`- ${b}`);
  } else {
    lines.push("- 花园状态无明显恶化");
  }
  return lines.join("\n");
}

export function annotateSnapshotForDiff(
  snapshot: GardenSnapshot,
  diff: GardenDiff,
  side: "base" | "head",
): Set<string> {
  const ids = new Set<string>();
  for (const id of diff.worsenedIds) ids.add(id);
  for (const id of diff.addedIds) if (side === "head") ids.add(id);
  for (const id of diff.removedIds) if (side === "base") ids.add(id);
  for (const v of diff.vineChanges) {
    if (v.toKind === "cycle" || v.toKind === "illegal" || v.kind === "added") {
      ids.add(v.from);
      ids.add(v.to);
    }
  }
  void snapshot;
  return ids;
}
