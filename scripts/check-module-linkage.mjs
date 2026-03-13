#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(FILE_DIR, "..");

const LINKAGE_SOURCES = [
  "src/dependency-links.mjs",
  "scripts/module-linkage.mjs",
];

const IMPORT_RE = /^\s*import\s+(?:[^"'`\n]+?\s+from\s+)?["']([^"']+)["'];?\s*$/gm;
const BANNED_SEGMENTS = [
  "/.claude/worktrees/",
];

function resolveImportTarget(baseDir, specifier) {
  const baseTarget = path.resolve(baseDir, specifier);
  const candidates = [
    baseTarget,
    `${baseTarget}.js`,
    `${baseTarget}.mjs`,
    `${baseTarget}.cjs`,
    path.join(baseTarget, "index.js"),
    path.join(baseTarget, "index.mjs"),
    path.join(baseTarget, "index.cjs"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) continue;
    return candidate;
  }
  return "";
}

function collectImports(relativeFilePath) {
  const absoluteFilePath = path.join(ROOT, relativeFilePath);
  const source = fs.readFileSync(absoluteFilePath, "utf8");
  const imports = [];
  let match = null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const specifier = String(match[1] || "").trim();
    if (!specifier) continue;
    imports.push({
      specifier,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return {
    relativeFilePath,
    absoluteFilePath,
    imports,
  };
}

function checkImportTarget({ relativeFilePath, absoluteFilePath }, item) {
  const issues = [];
  const normalizedSpecifier = item.specifier.replace(/\\/g, "/");
  const importerDir = path.dirname(absoluteFilePath);
  const resolved = resolveImportTarget(importerDir, item.specifier);
  const normalizedResolved = resolved.replace(/\\/g, "/");

  if (!item.specifier.startsWith(".")) {
    issues.push({
      type: "unsupported_specifier",
      message: "dependency-link maps must use only relative imports",
      file: relativeFilePath,
      line: item.line,
      specifier: item.specifier,
    });
    return issues;
  }

  for (const banned of BANNED_SEGMENTS) {
    if (normalizedSpecifier.includes(banned) || normalizedResolved.includes(banned)) {
      issues.push({
        type: "banned_path",
        message: `banned non-canonical import path segment detected: ${banned}`,
        file: relativeFilePath,
        line: item.line,
        specifier: item.specifier,
      });
      return issues;
    }
  }

  if (!resolved) {
    issues.push({
      type: "missing_target",
      message: "import target does not resolve to a file",
      file: relativeFilePath,
      line: item.line,
      specifier: item.specifier,
    });
    return issues;
  }

  const relativeResolved = path.relative(ROOT, resolved).replace(/\\/g, "/");
  if (relativeResolved.startsWith("..")) {
    issues.push({
      type: "outside_repo",
      message: "import target resolves outside repository root",
      file: relativeFilePath,
      line: item.line,
      specifier: item.specifier,
    });
  }
  return issues;
}

function run() {
  const allIssues = [];

  for (const relativeFilePath of LINKAGE_SOURCES) {
    const details = collectImports(relativeFilePath);
    const seen = new Set();
    for (const item of details.imports) {
      const dedupeKey = `${item.line}:${item.specifier}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const issues = checkImportTarget(details, item);
      allIssues.push(...issues);
    }
  }

  if (allIssues.length > 0) {
    process.stderr.write("[module-linkage] FAIL unresolved or non-canonical imports detected\n");
    for (const issue of allIssues) {
      process.stderr.write(
        ` - ${issue.file}:${issue.line} ${issue.message} (${issue.specifier})\n`
      );
    }
    process.exit(1);
  }

  process.stdout.write("[module-linkage] ok\n");
}

run();
