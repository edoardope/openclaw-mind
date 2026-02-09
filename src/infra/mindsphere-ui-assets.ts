import fs from "node:fs";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { resolveOpenClawPackageRoot, resolveOpenClawPackageRootSync } from "./openclaw-root.js";

const MINDSHPERE_UI_DIST_PATH_SEGMENTS = ["dist", "mindsphere-ui", "index.html"] as const;

export function resolveMindsphereUiDistIndexPathForRoot(root: string): string {
  return path.join(root, ...MINDSHPERE_UI_DIST_PATH_SEGMENTS);
}

export type MindsphereUiDistIndexHealth = {
  indexPath: string | null;
  exists: boolean;
};

export async function resolveMindsphereUiDistIndexHealth(
  opts: { root?: string; argv1?: string } = {},
): Promise<MindsphereUiDistIndexHealth> {
  const indexPath = opts.root
    ? resolveMindsphereUiDistIndexPathForRoot(opts.root)
    : await resolveMindsphereUiDistIndexPath(opts.argv1 ?? process.argv[1]);
  return { indexPath, exists: Boolean(indexPath && fs.existsSync(indexPath)) };
}

export async function resolveMindsphereUiDistIndexPath(
  argv1: string | undefined = process.argv[1],
): Promise<string | null> {
  if (!argv1) {
    return null;
  }
  const normalized = path.resolve(argv1);

  // Case 1: entrypoint is directly inside dist/ (e.g., dist/entry.js)
  const distDir = path.dirname(normalized);
  if (path.basename(distDir) === "dist") {
    return path.join(distDir, "mindsphere-ui", "index.html");
  }

  const packageRoot = await resolveOpenClawPackageRoot({ argv1: normalized });
  if (packageRoot) {
    return path.join(packageRoot, "dist", "mindsphere-ui", "index.html");
  }

  return null;
}

export function resolveMindsphereUiRootSync(argv1: string | undefined = process.argv[1]): string | null {
  if (!argv1) {
    return null;
  }
  const normalized = path.resolve(argv1);
  const packageRoot = resolveOpenClawPackageRootSync({ argv1: normalized });
  const candidates = new Set<string>();
  if (packageRoot) {
    candidates.add(path.join(packageRoot, "dist", "mindsphere-ui"));
  }
  candidates.add(path.join(process.cwd(), "dist", "mindsphere-ui"));

  for (const dir of candidates) {
    const indexPath = path.join(dir, "index.html");
    if (fs.existsSync(indexPath)) {
      return dir;
    }
  }
  return null;
}

export type EnsureMindsphereUiAssetsResult = {
  ok: boolean;
  built: boolean;
  message?: string;
};

function summarizeCommandOutput(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) {
    return undefined;
  }
  return last.length > 240 ? `${last.slice(0, 239)}…` : last;
}

export async function ensureMindsphereUiAssetsBuilt(
  runtime: RuntimeEnv = defaultRuntime,
  opts?: { timeoutMs?: number },
): Promise<EnsureMindsphereUiAssetsResult> {
  const health = await resolveMindsphereUiDistIndexHealth({ argv1: process.argv[1] });
  if (health.exists) {
    return { ok: true, built: false };
  }

  const packageRoot = await resolveOpenClawPackageRoot({ argv1: process.argv[1] });
  if (!packageRoot) {
    return {
      ok: false,
      built: false,
      message: "Missing MindSphere UI assets (dist/mindsphere-ui). Build them with `pnpm ui:mindsphere:build`.",
    };
  }

  const indexPath = resolveMindsphereUiDistIndexPathForRoot(packageRoot);
  if (fs.existsSync(indexPath)) {
    return { ok: true, built: false };
  }

  const script = path.join(packageRoot, "scripts", "mindsphere-ui.js");
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      built: false,
      message: `MindSphere UI assets missing but ${script} is unavailable.`,
    };
  }

  runtime.log("MindSphere UI assets missing; building (ui:mindsphere:build, auto-installs deps)…");
  const build = await runCommandWithTimeout([process.execPath, script, "build"], {
    cwd: packageRoot,
    timeoutMs: opts?.timeoutMs ?? 10 * 60_000,
  });

  if (build.code !== 0) {
    return {
      ok: false,
      built: false,
      message:
        build.stderr || build.stdout
          ? summarizeCommandOutput(`${build.stderr ?? ""}\n${build.stdout ?? ""}`)
          : "MindSphere UI build failed.",
    };
  }

  return { ok: true, built: true };
}
