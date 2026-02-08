import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { formatCliCommand } from "../cli/command-format.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath } from "../utils.js";
import { detectBinary, resolveNodeManagerOptions } from "./onboard-helpers.js";

function summarizeInstallFailure(message: string): string | undefined {
  const cleaned = message.replace(/^Install failed(?:\s*\([^)]*\))?\s*:?\s*/i, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const maxLen = 140;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function formatSkillHint(skill: {
  description?: string;
  install: Array<{ label: string }>;
}): string {
  const desc = skill.description?.trim();
  const installLabel = skill.install[0]?.label?.trim();
  const combined = desc && installLabel ? `${desc} — ${installLabel}` : desc || installLabel;
  if (!combined) {
    return "install";
  }
  const maxLen = 90;
  return combined.length > maxLen ? `${combined.slice(0, maxLen - 1)}…` : combined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFirstClientSecretJson(dirPath: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const match = entries
      .filter((ent) => ent.isFile())
      .map((ent) => ent.name)
      .find((name) => /^client_secret.*\.json$/i.test(name));
    return match ? path.join(dirPath, match) : null;
  } catch {
    return null;
  }
}

async function maybeSetupGogGoogleSuite(
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<void> {
  // This is an optional convenience step in onboarding.
  // It configures gogcli OAuth for: Gmail, Drive, Calendar, Tasks.

  const gogExeCandidates = [
    // Bundled in OpenClaw state dir (Windows default from our deployment)
    resolveUserPath("~/.openclaw/tools/gogcli/gog.exe"),
    // If user installed globally
    "gog",
  ];

  let gogExe: string | null = null;
  for (const cand of gogExeCandidates) {
    if (cand === "gog") {
      if (await detectBinary("gog")) {
        gogExe = "gog";
        break;
      }
      continue;
    }
    if (await fileExists(cand)) {
      gogExe = cand;
      break;
    }
  }

  if (!gogExe) {
    return;
  }

  const wants = await prompter.confirm({
    message: "Set up Google (Drive/Gmail/Calendar/Tasks) via gogcli now?",
    initialValue: false,
  });
  if (!wants) {
    return;
  }

  const defaultSecretDirCandidates = [
    resolveUserPath("~/OneDrive/Desktop/gogauth"),
    resolveUserPath("~/Desktop/gogauth"),
  ];
  let defaultSecretPath: string | null = null;
  for (const dir of defaultSecretDirCandidates) {
    defaultSecretPath = await findFirstClientSecretJson(dir);
    if (defaultSecretPath) {
      break;
    }
  }

  const secretPathRaw = String(
    await prompter.text({
      message: "Path to Google OAuth client_secret*.json (Desktop app)",
      placeholder: defaultSecretPath ?? "C:/path/to/client_secret_....json",
      validate: (value) => {
        const v = String(value ?? "").trim();
        return v ? undefined : "Required";
      },
    }),
  ).trim();

  const secretPath = resolveUserPath(secretPathRaw);

  const email = String(
    await prompter.text({
      message: "Google account email to authorize",
      placeholder: "you@gmail.com",
      validate: (value) => {
        const v = String(value ?? "").trim();
        return v && v.includes("@") ? undefined : "Enter a valid email";
      },
    }),
  ).trim();

  const services = "gmail,drive,calendar,tasks";

  await prompter.note(
    [
      "This will open a browser window for OAuth consent.",
      "Services:",
      `- ${services}`,
    ].join("\n"),
    "gogcli OAuth",
  );

  const spinCreds = prompter.progress("Storing OAuth client credentials (gog auth credentials)…");
  const credsResult = await runCommandWithTimeout({
    argv: [gogExe, "auth", "credentials", secretPath],
    cwd: undefined,
    env: undefined,
    timeoutSeconds: 60,
  });
  if (!credsResult.ok) {
    spinCreds.stop("Failed to store OAuth client credentials.");
    runtime.log(credsResult.message ?? "gog auth credentials failed");
    if (credsResult.stderr) {
      runtime.log(credsResult.stderr.trim());
    }
    return;
  }
  spinCreds.stop("OAuth client credentials stored.");

  const spinAdd = prompter.progress("Authorizing account (gog auth add)…");
  const addResult = await runCommandWithTimeout({
    argv: [gogExe, "auth", "add", email, "--services", services],
    cwd: undefined,
    env: undefined,
    timeoutSeconds: 300,
  });
  if (!addResult.ok) {
    spinAdd.stop("Account authorization failed.");
    runtime.log(addResult.message ?? "gog auth add failed");
    if (addResult.stderr) {
      runtime.log(addResult.stderr.trim());
    }
    return;
  }
  spinAdd.stop("Account authorized.");
}

function upsertSkillEntry(
  cfg: OpenClawConfig,
  skillKey: string,
  patch: { apiKey?: string },
): OpenClawConfig {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

export async function setupSkills(
  cfg: OpenClawConfig,
  workspaceDir: string,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  const eligible = report.skills.filter((s) => s.eligible);
  const missing = report.skills.filter((s) => !s.eligible && !s.disabled && !s.blockedByAllowlist);
  const blocked = report.skills.filter((s) => s.blockedByAllowlist);

  const needsBrewPrompt =
    process.platform !== "win32" &&
    report.skills.some((skill) => skill.install.some((option) => option.kind === "brew")) &&
    !(await detectBinary("brew"));

  await prompter.note(
    [
      `Eligible: ${eligible.length}`,
      `Missing requirements: ${missing.length}`,
      `Blocked by allowlist: ${blocked.length}`,
    ].join("\n"),
    "Skills status",
  );

  const shouldConfigure = await prompter.confirm({
    message: "Configure skills now? (recommended)",
    initialValue: true,
  });
  if (!shouldConfigure) {
    return cfg;
  }

  if (needsBrewPrompt) {
    await prompter.note(
      [
        "Many skill dependencies are shipped via Homebrew.",
        "Without brew, you'll need to build from source or download releases manually.",
      ].join("\n"),
      "Homebrew recommended",
    );
    const showBrewInstall = await prompter.confirm({
      message: "Show Homebrew install command?",
      initialValue: true,
    });
    if (showBrewInstall) {
      await prompter.note(
        [
          "Run:",
          '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        ].join("\n"),
        "Homebrew install",
      );
    }
  }

  const nodeManager = (await prompter.select({
    message: "Preferred node manager for skill installs",
    options: resolveNodeManagerOptions(),
  })) as "npm" | "pnpm" | "bun";

  let next: OpenClawConfig = {
    ...cfg,
    skills: {
      ...cfg.skills,
      install: {
        ...cfg.skills?.install,
        nodeManager,
      },
    },
  };

  const installable = missing.filter(
    (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
  );
  if (installable.length > 0) {
    const toInstall = await prompter.multiselect({
      message: "Install missing skill dependencies",
      options: [
        {
          value: "__skip__",
          label: "Skip for now",
          hint: "Continue without installing dependencies",
        },
        ...installable.map((skill) => ({
          value: skill.name,
          label: `${skill.emoji ?? "🧩"} ${skill.name}`,
          hint: formatSkillHint(skill),
        })),
      ],
    });

    const selected = toInstall.filter((name) => name !== "__skip__");
    for (const name of selected) {
      const target = installable.find((s) => s.name === name);
      if (!target || target.install.length === 0) {
        continue;
      }
      const installId = target.install[0]?.id;
      if (!installId) {
        continue;
      }
      const spin = prompter.progress(`Installing ${name}…`);
      const result = await installSkill({
        workspaceDir,
        skillName: target.name,
        installId,
        config: next,
      });
      const warnings = result.warnings ?? [];
      if (result.ok) {
        spin.stop(warnings.length > 0 ? `Installed ${name} (with warnings)` : `Installed ${name}`);
        for (const warning of warnings) {
          runtime.log(warning);
        }
        continue;
      }
      const code = result.code == null ? "" : ` (exit ${result.code})`;
      const detail = summarizeInstallFailure(result.message);
      spin.stop(`Install failed: ${name}${code}${detail ? ` — ${detail}` : ""}`);
      for (const warning of warnings) {
        runtime.log(warning);
      }
      if (result.stderr) {
        runtime.log(result.stderr.trim());
      } else if (result.stdout) {
        runtime.log(result.stdout.trim());
      }
      runtime.log(
        `Tip: run \`${formatCliCommand("openclaw doctor")}\` to review skills + requirements.`,
      );
      runtime.log("Docs: https://docs.openclaw.ai/skills");
    }
  }

  for (const skill of missing) {
    if (!skill.primaryEnv || skill.missing.env.length === 0) {
      continue;
    }
    const wantsKey = await prompter.confirm({
      message: `Set ${skill.primaryEnv} for ${skill.name}?`,
      initialValue: false,
    });
    if (!wantsKey) {
      continue;
    }
    const apiKey = String(
      await prompter.text({
        message: `Enter ${skill.primaryEnv}`,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      }),
    );
    next = upsertSkillEntry(next, skill.skillKey, { apiKey: apiKey.trim() });
  }

  // Optional: Google suite auth via gogcli.
  await maybeSetupGogGoogleSuite(runtime, prompter);

  return next;
}
