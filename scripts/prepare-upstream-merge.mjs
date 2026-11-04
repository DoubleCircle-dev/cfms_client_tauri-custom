#!/usr/bin/env node

// Finishes an upstream merge: `.gitattributes` merge drivers already resolved
// the version-only conflicts, but they keep the previous Custom version, and the
// generated Fluent artifacts still describe the pre-merge icon set.
//
// Run after `git merge <upstream>` and after every remaining conflict is
// resolved, then commit:
//
//   pnpm merge:prepare                 # upstream ref defaults to MERGE_HEAD
//   pnpm merge:prepare --upstream v0.58.0
//
// Exit code 1 means the tree still needs a human (unmerged paths or a failing
// post-condition).

import fs from "node:fs";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options }).trim();
}

function tryGit(args) {
  try {
    return git(args, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const upstreamFlagIndex = args.indexOf("--upstream");
const upstreamRef =
  upstreamFlagIndex >= 0 ? args[upstreamFlagIndex + 1] : tryGit(["rev-parse", "MERGE_HEAD"]);

const unmerged = git(["diff", "--name-only", "--diff-filter=U"]);
if (unmerged) {
  fail(`Resolve these conflicts first:\n${unmerged.split("\n").map((path) => `  ${path}`).join("\n")}`);
}

if (!upstreamRef) {
  fail(
    "No upstream ref found. Pass one explicitly, e.g. `pnpm merge:prepare --upstream v0.58.0`.",
  );
}

function upstreamVersion(ref) {
  const manifest = tryGit(["show", `${ref}:src-tauri/tauri.conf.json`]);
  if (!manifest) fail(`Cannot read src-tauri/tauri.conf.json from ${ref}.`);
  return JSON.parse(manifest).version;
}

const base = upstreamVersion(upstreamRef);
process.stdout.write(`Upstream ${upstreamRef} is ${base}.\n`);

process.stdout.write("Regenerating Fluent artifacts...\n");
if (run(process.execPath, ["scripts/generate-fluent-theme.mjs"]) !== 0) fail("Fluent theme generation failed.");
if (run(process.execPath, ["scripts/generate-fluent-icons.mjs"]) !== 0) fail("Fluent icon generation failed.");

process.stdout.write(`Re-stamping the Custom version on ${base}...\n`);
const versionStatus = run(process.execPath, [
  "scripts/client-version.mjs",
  "custom",
  base,
  "--skip-changelog",
]);
if (versionStatus !== 0) fail("Version re-stamp failed.");

const current = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version;

const changed = git(["diff", "--name-only", upstreamRef, "--", "."]).split("\n").filter(Boolean);
const upstreamFiles = new Set(
  git(["ls-tree", "-r", "--name-only", upstreamRef]).split("\n").filter(Boolean),
);
const shared = changed.filter((path) => upstreamFiles.has(path));

process.stdout.write(
  `\nMerged at ${current}. ${shared.length} upstream file(s) still carry a fork change:\n`,
);
process.stdout.write(shared.map((path) => `  ${path}\n`).join(""));
process.stdout.write(
  "Each entry should be a deliberate fork feature or one of the injection seams in src/lib/injection/README.md.\n" +
    "Next: review, run `pnpm check` and `cargo check`, then commit the merge.\n",
);
