#!/usr/bin/env node

// Git merge driver for the files whose only fork change is the version field:
// `package.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json` and the
// generated iOS `Info.plist`.
//
// An upstream release rewrites exactly those lines, so every bump conflicts
// there. A conflict block is auto-resolved only when the two sides differ in
// nothing but version lines; the Custom value wins so the build keeps
// identifying itself as a Custom release. Anything else keeps its markers and
// stays a normal manual merge.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);

const versionLinePatterns = [
  /^\s*version\s*=\s*"[^"]+"\s*$/, // Cargo.toml, Cargo.lock
  /^\s*"version"\s*:\s*"[^"]+"\s*,?\s*$/, // package.json, tauri.conf.json
  /^\s*<string>\d+<\/string>\s*$/, // Info.plist CFBundleVersion
];

function isVersionLine(line) {
  return versionLinePatterns.some((pattern) => pattern.test(line));
}

function withoutVersionLines(lines) {
  return lines.filter((line) => !isVersionLine(line));
}

function sameLines(left, right) {
  return (
    left.length === right.length && left.every((line, index) => line === right[index])
  );
}

// Returns the resolved lines, or null when the block is more than a version bump.
function resolveBlock(oursLines, theirsLines) {
  const ourVersions = oursLines.filter(isVersionLine);
  const theirVersions = theirsLines.filter(isVersionLine);
  if (ourVersions.length === 0 || ourVersions.length !== theirVersions.length) {
    return null;
  }
  if (!sameLines(withoutVersionLines(oursLines), withoutVersionLines(theirsLines))) {
    return null;
  }

  let next = 0;
  return theirsLines.map((line) => (isVersionLine(line) ? ourVersions[next++] : line));
}

function resolveConflicts(merged) {
  const lines = merged.split("\n");
  const output = [];
  let index = 0;
  let resolved = 0;
  let unresolved = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("<<<<<<< ")) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const oursStart = index + 1;
    let separator = oursStart;
    while (separator < lines.length && !lines[separator].startsWith("=======")) {
      separator += 1;
    }
    let end = separator + 1;
    while (end < lines.length && !lines[end].startsWith(">>>>>>> ")) {
      end += 1;
    }
    if (separator >= lines.length || end >= lines.length) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const resolution = resolveBlock(
      lines.slice(oursStart, separator),
      lines.slice(separator + 1, end),
    );
    if (resolution) {
      output.push(...resolution);
      resolved += 1;
    } else {
      output.push(...lines.slice(index, end + 1));
      unresolved += 1;
    }
    index = end + 1;
  }

  return { text: output.join("\n"), resolved, unresolved };
}

function main() {
  if (!basePath || !oursPath || !theirsPath) {
    process.stderr.write("usage: git-merge-version.mjs <base> <ours> <theirs>\n");
    process.exit(2);
  }

  const result = spawnSync(
    "git",
    [
      "merge-file",
      "-p",
      "-L",
      "custom",
      "-L",
      "base",
      "-L",
      "upstream",
      oursPath,
      basePath,
      theirsPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error) {
    process.stderr.write(`version merge failed: ${result.error.message}\n`);
    process.exit(1);
  }

  const outcome = resolveConflicts(result.stdout);
  fs.writeFileSync(oursPath, outcome.text);

  const name = path.basename(oursPath);
  if (outcome.resolved > 0) {
    process.stderr.write(
      `${name}: kept the Custom version in ${outcome.resolved} version-only conflict(s). ` +
        "Run `pnpm merge:prepare` to re-stamp it on the upstream base.\n",
    );
  }
  if (outcome.unresolved > 0) {
    process.stderr.write(`${name}: ${outcome.unresolved} conflict(s) need a manual resolution.\n`);
    process.exit(1);
  }
}

export { isVersionLine, resolveBlock, resolveConflicts };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
