/** git workspace read-only helpers for Diff review */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, error: e.stderr || e.message };
  }
}

export async function gitStatus(cwd) {
  const st = await git(cwd, ["status", "--porcelain"]);
  if (!st.ok) return { ok: false, error: st.error, git: false };
  const files = st.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const x = line[0];
      const y = line[1];
      const path = line.slice(3).trim();
      let kind = "modified";
      if (x === "?" || y === "?") kind = "untracked";
      else if (x === "A" || y === "A") kind = "added";
      else if (x === "D" || y === "D") kind = "deleted";
      else if (x === "R" || y === "R") kind = "renamed";
      return { path, kind, x, y };
    });
  return { ok: true, git: true, files };
}

export async function gitDiff(cwd) {
  const st = await gitStatus(cwd);
  if (!st.ok) return st;
  const out = [];
  for (const f of st.files) {
    if (f.kind === "untracked") {
      const show = await git(cwd, ["diff", "--no-index", "--", "/dev/null", f.path]);
      // git diff --no-index exits 1 when different
      out.push({
        path: f.path,
        kind: f.kind,
        patch: show.stdout || `--- /dev/null\n+++ b/${f.path}\n(new file)`,
      });
      continue;
    }
    const d = await git(cwd, ["diff", "--", f.path]);
    out.push({ path: f.path, kind: f.kind, patch: d.stdout || "" });
    const ds = await git(cwd, ["diff", "--cached", "--", f.path]);
    if (ds.stdout) out[out.length - 1].patch += ds.stdout;
  }
  return { ok: true, git: true, files: out };
}
