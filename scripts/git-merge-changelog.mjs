#!/usr/bin/env node

// Git merge driver for `src/lib/changelog/CHANGELOG.md`.
//
// Both upstream and this fork prepend release sections at the same place, so a
// plain merge always conflicts. Every section is self-contained and separated by
// `---`, so keeping both sides is correct; the only detail is the order. The
// changelog is newest first, and upstream's release is always newer than the
// last Custom one, so upstream's block has to be emitted before ours.
// `git merge-file --union` writes the current side first, which is why the
// upstream blob is passed as "current" and ours as "other".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);

function main() {
  if (!basePath || !oursPath || !theirsPath) {
    process.stderr.write("usage: git-merge-changelog.mjs <base> <ours> <theirs>\n");
    process.exit(2);
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfms-changelog-merge-"));
  const scratch = path.join(scratchDir, "merged.md");

  try {
    fs.copyFileSync(theirsPath, scratch);
    const result = spawnSync(
      "git",
      [
        "merge-file",
        "--union",
        "-L",
        "upstream",
        "-L",
        "base",
        "-L",
        "custom",
        scratch,
        basePath,
        oursPath,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.stderr.write(`changelog merge failed: ${result.stderr ?? result.status}\n`);
      process.exit(1);
    }
    fs.copyFileSync(scratch, oursPath);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
