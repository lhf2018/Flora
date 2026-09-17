import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FsEntry {
  name: string;
  path: string;
  type: "dir";
}

export async function listRoots(): Promise<FsEntry[]> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { $_.Name }",
        ],
        { windowsHide: true },
      );
      return stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((drive) => ({
          name: drive,
          path: drive.endsWith("\\") ? drive : `${drive}\\`,
          type: "dir" as const,
        }));
    } catch {
      return [{ name: "C:\\", path: "C:\\", type: "dir" }];
    }
  }

  const home = os.homedir();
  return [
    { name: "/", path: "/", type: "dir" },
    { name: "Home", path: home, type: "dir" },
  ];
}

export function listDirectories(dirPath: string): {
  path: string;
  parent: string | null;
  entries: FsEntry[];
} {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`不是有效目录: ${resolved}`);
  }

  const parentDir = path.dirname(resolved);
  const parent =
    parentDir !== resolved && parentDir.length > 0 ? parentDir : null;

  let names: string[] = [];
  try {
    names = fs.readdirSync(resolved);
  } catch (err) {
    throw new Error(
      `无法读取目录: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries: FsEntry[] = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    // skip noisy / inaccessible junk at browse time
    if (name === "node_modules" || name === ".git" || name === "$Recycle.Bin") {
      continue;
    }
    const full = path.join(resolved, name);
    try {
      if (fs.statSync(full).isDirectory()) {
        entries.push({ name, path: full, type: "dir" });
      }
    } catch {
      /* skip inaccessible */
    }
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return { path: resolved, parent, entries };
}

/** Native folder picker — best-effort; may fail in non-interactive hosts. */
export async function pickFolder(startPath?: string): Promise<string | null> {
  if (process.platform === "win32") {
    const initial = (startPath ?? process.cwd()).replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a project folder for Flora'
$dialog.SelectedPath = '${initial}'
$dialog.ShowNewFolderButton = $false
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.Opacity = 0
$form.ShowInTaskbar = $false
$form.FormBorderStyle = 'FixedToolWindow'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-2000, -2000)
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.Show()
$form.Activate()
$result = $dialog.ShowDialog($form)
$form.Close()
$form.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.Write($dialog.SelectedPath)
}
`;
    const tmp = path.join(os.tmpdir(), `flora-pick-${Date.now()}.ps1`);
    fs.writeFileSync(tmp, script, "utf8");
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", tmp],
        {
          windowsHide: false,
          timeout: 120_000,
        },
      );
      const selected = stdout.trim();
      return selected || null;
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Select a project folder for Flora")',
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Select a project folder for Flora",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
