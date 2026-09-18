#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import {
  analyze,
  buildTimeline,
  compareRefs,
  formatDiffComment,
  summarizeDelta,
  FLORA_VERSION,
} from "@flora/core";
import { startStudioServer } from "./studio-server.js";

const program = new Command();

program
  .name("flora")
  .description("Codebase → living architecture garden")
  .version(FLORA_VERSION);

program
  .command("studio")
  .description("打开 Studio：选路径即可出树")
  .option("-p, --port <port>", "端口", "4173")
  .option("--no-open", "不自动打开浏览器")
  .action(async (opts: { port: string; open: boolean }) => {
    await startStudioServer({
      port: Number(opts.port) || 4173,
      openBrowser: opts.open,
    });
  });

program
  .command("analyze")
  .description("分析代码库并写出 .flora/snapshot.json")
  .argument("[path]", "项目根路径", ".")
  .option(
    "-g, --granularity <mode>",
    "auto | package | directory | file",
    "auto",
  )
  .option("--target <n>", "叙事目标株数（auto，默认 12）")
  .option("--rules <file>", "架构规则文件")
  .action(
    async (
      root: string,
      opts: { granularity: string; rules?: string; target?: string },
    ) => {
      const rootPath = path.resolve(root);
      const snapshot = await analyze({
        rootPath,
        granularity: opts.granularity as "auto" | "package" | "directory" | "file",
        rulesPath: opts.rules,
        targetPlants: opts.target ? Number(opts.target) : undefined,
      });
      console.log(`✓ ${snapshot.plants.length} plants, ${snapshot.vines.length} vines`);
      console.log(`  → ${path.join(rootPath, ".flora", "snapshot.json")}`);
      console.log(`  ${summarizeDelta(snapshot)}`);
      for (const n of snapshot.meta.notes ?? []) console.log(`  · ${n}`);
    },
  );

program
  .command("timeline")
  .description("根据 git 历史生成时间轴（用于延时回放）")
  .argument("[path]", "项目根路径", ".")
  .option("-d, --days <n>", "回溯天数", "30")
  .option("-f, --frames <n>", "帧数", "8")
  .option(
    "-g, --granularity <mode>",
    "auto | package | directory | file",
    "auto",
  )
  .option("--target <n>", "叙事目标株数")
  .option("--approx", "强制用活跃度近似（不 checkout 提交）")
  .action(
    async (
      root: string,
      opts: {
        days: string;
        frames: string;
        granularity: string;
        target?: string;
        approx?: boolean;
      },
    ) => {
      const rootPath = path.resolve(root);
      console.log("生成时间轴中…");
      const { timeline } = await buildTimeline({
        rootPath,
        days: Number(opts.days) || 30,
        frames: Number(opts.frames) || 8,
        granularity: opts.granularity as
          | "auto"
          | "package"
          | "directory"
          | "file",
        targetPlants: opts.target ? Number(opts.target) : undefined,
        mode: opts.approx ? "approx" : "auto",
      });
      console.log(
        `✓ ${timeline.frames.length} 帧 · ${timeline.range.from} → ${timeline.range.to}`,
      );
      console.log(`  → ${path.join(rootPath, ".flora", "timeline.json")}`);
    },
  );

program
  .command("compare")
  .description("PR 双花园：对比两个分支的最新 tip（非工作区脏改动）")
  .argument("[path]", "项目根路径", ".")
  .requiredOption("-b, --base <branch>", "基准分支（如 main）")
  .requiredOption("-H, --head <branch>", "对比分支（如 feature/x）")
  .option(
    "-g, --granularity <mode>",
    "auto | package | directory | file",
    "auto",
  )
  .option("--rules <file>", "架构规则文件")
  .option("--comment", "输出 Markdown 评论体")
  .action(
    async (
      root: string,
      opts: {
        base: string;
        head: string;
        granularity: string;
        rules?: string;
        comment?: boolean;
      },
    ) => {
      const rootPath = path.resolve(root);
      console.log(`对比分支 tip：${opts.base} → ${opts.head} …`);
      const diff = await compareRefs({
        rootPath,
        baseRef: opts.base,
        headRef: opts.head,
        granularity: opts.granularity as
          | "auto"
          | "package"
          | "directory"
          | "file",
        rulesPath: opts.rules,
      });
      console.log(`✓ ${diff.summary}`);
      for (const b of diff.bullets) console.log(`  · ${b}`);
      console.log(
        `  plants Δ: +${diff.addedIds.length} −${diff.removedIds.length}  worsened ${diff.worsenedIds.length}  improved ${diff.improvedIds.length}`,
      );
      if (opts.comment) {
        console.log("\n" + formatDiffComment(diff));
      }
    },
  );

program.parseAsync(process.argv);
