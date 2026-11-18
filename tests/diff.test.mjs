import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { baseReader, caseDiff, diffChanges } from "../lib/diff.mjs";

const git = (cwd, ...args) => childProcess.execFileSync("git", [
  "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false",
  "-c", "core.autocrlf=false", ...args,
], { cwd, encoding: "utf8" }).trim();

test("git diff keeps renames, deletions and both names of a rename", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gel-diff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "old name.txt"), "original content\n");
  writeFileSync(join(root, "deleted.txt"), "will be deleted\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  git(root, "mv", "old name.txt", "new name.txt");
  git(root, "rm", "deleted.txt");
  git(root, "commit", "-qm", "rename and delete");

  assert.equal(diffChanges(root, null), null);
  assert.equal(diffChanges(root, "0000000"), null);
  assert.deepEqual(diffChanges(root, base), [
    { status: "D", file: "deleted.txt" },
    { status: "R", from: "old name.txt", file: "new name.txt" },
  ]);
  assert.equal(baseReader(root, "missing-base"), null);
  const readBase = baseReader(root, base);
  assert.equal(readBase("old name.txt"), "original content\n");
  assert.equal(readBase("deleted.txt"), "will be deleted\n");
  assert.equal(readBase("new name.txt"), null);
});

test("git diff maps copy, type-change and unmerged status records", (t) => {
  // The committed diff requests rename detection only. Supply Git's record
  // format directly for statuses it need not emit for the repository above.
  t.mock.method(childProcess, "execFileSync", () => [
    "C100", "source.txt", "copy.txt", "T", "changed-type.txt", "U", "unmerged.txt", "",
  ].join("\0"));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  assert.deepEqual(diffChanges(".", "base"), [
    { status: "A", from: "source.txt", file: "copy.txt" },
    { status: "M", file: "changed-type.txt" },
    { status: "M", file: "unmerged.txt" },
  ]);
});

test("case diff compares string and array bodies as text", () => {
  const files = { added: "new", modified: "changed", unchanged: "same text" };
  assert.deepEqual(caseDiff(undefined, files), { changes: null, readBase: null });
  const { changes, readBase } = caseDiff({
    deleted: "old", modified: "original", unchanged: ["same ", "text"],
  }, files);
  assert.deepEqual(changes, [
    { status: "A", file: "added" },
    { status: "D", file: "deleted" },
    { status: "M", file: "modified" },
  ]);
  assert.equal(readBase("unchanged"), "same text");
  assert.equal(readBase("added"), null);
});
