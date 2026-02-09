import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { DEFAULT_CONTEXT_FILENAME } from "./workspace.js";

export function workingContextSnippet(ctxPath: string) {
  const trimmed = ctxPath.trim();
  if (!trimmed) {
    return "";
  }
  return [
    "## Working Context",
    `User-selected working context path: ${trimmed}`,
    "Prefer operating within this context unless the user asks otherwise.",
    "This does NOT replace the agent workspace; it is an additional hint.",
    "",
  ].join("\n");
}

function parseContextFirstLine(raw: string): string | null {
  const cleaned = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--"));
  const first = cleaned[0] ?? "";
  return first.trim() ? first.trim() : null;
}

export async function readWorkingContextPath(workspaceDir: string): Promise<string | null> {
  const filePath = path.join(workspaceDir, DEFAULT_CONTEXT_FILENAME);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseContextFirstLine(raw);
  } catch {
    return null;
  }
}

export function readWorkingContextPathSync(workspaceDir: string): string | null {
  const filePath = path.join(workspaceDir, DEFAULT_CONTEXT_FILENAME);
  try {
    const raw = fsSync.readFileSync(filePath, "utf-8");
    return parseContextFirstLine(raw);
  } catch {
    return null;
  }
}

export async function buildWorkingContextPrompt(workspaceDir: string): Promise<string> {
  const ctx = await readWorkingContextPath(workspaceDir);
  return ctx ? workingContextSnippet(ctx) : "";
}

export function buildWorkingContextPromptSync(workspaceDir: string): string {
  const ctx = readWorkingContextPathSync(workspaceDir);
  return ctx ? workingContextSnippet(ctx) : "";
}
