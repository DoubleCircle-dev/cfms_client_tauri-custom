#!/usr/bin/env node

// Declares the merge drivers named in `.gitattributes`.
//
// `.gitattributes` can only reference a driver by name; the command behind it
// has to live in `.git/config`, which is not shared through the repository. The
// `prepare` script runs this on every `pnpm install`, so a fresh clone gets the
// same merge behaviour without manual setup.

import process from "node:process";
import { execFileSync } from "node:child_process";

const drivers = {
  // Version fields are the only thing this fork changes in the manifests, and
  // every upstream bump rewrites exactly those lines. The driver keeps the
  // Custom value for conflicts that are nothing but a version line and leaves
  // every other conflict to a human.
  "custom-version": "node scripts/git-merge-version.mjs %O %A %B",
  "custom-changelog": "node scripts/git-merge-changelog.mjs %O %A %B",
};

function currentDriver(name) {
  try {
    return execFileSync("git", ["config", "--get", `merge.${name}.driver`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function inGitRepository() {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

const check = process.argv.includes("--check");

if (!inGitRepository()) {
  process.stdout.write("Skipping merge driver setup: not a Git working tree.\n");
  process.exit(0);
}

let changed = 0;

for (const [name, command] of Object.entries(drivers)) {
  if (currentDriver(name) === command) {
    continue;
  }
  changed += 1;
  if (check) {
    process.stderr.write(`merge.${name}.driver is not configured for this clone.\n`);
    continue;
  }
  execFileSync("git", ["config", `merge.${name}.driver`, command], { stdio: "inherit" });
}

if (check) {
  if (changed > 0) {
    process.stderr.write("Run: pnpm setup:git\n");
    process.exit(1);
  }
  process.stdout.write("Git merge drivers are configured.\n");
  process.exit(0);
}

process.stdout.write(
  changed === 0
    ? "Git merge drivers already configured.\n"
    : `Configured ${changed} Git merge driver(s).\n`,
);
