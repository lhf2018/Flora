import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyze } from "./analyze.js";
import type { AggregateGranularity, GardenSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

/** Analyze a git ref via temporary worktree (no lasting checkout).
 *  Branch / commit / HEAD → tip of that ref (committed tree).
 *  `.` / `WORKTREE` → dirty working tree. */
export async function analyzeAtRef(options: {
  rootPath: string;
  ref: string;
  granularity?: AggregateGranularity;
  rulesPath?: string;
  targetPlants?: number;
}): Promise<GardenSnapshot> {
  const rootPath = path.resolve(options.rootPath);
  const ref = options.ref.trim();

  if (ref === "." || ref === "WORKTREE") {
    return analyze({
      rootPath,
      granularity: options.granularity ?? "auto",
      rulesPath: options.rulesPath,
      targetPlants: options.targetPlants,
      writeSnapshot: false,
      appendTimeline: false,
    });
  }

  let resolved: string;
  try {
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
      targetPlants: options.targetPlants,
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
