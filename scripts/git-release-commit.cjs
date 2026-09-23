/**
 * Commits the release source and pushes it before GitHub release assets upload.
 *
 * Runs after the Android and Windows builds succeed, and before publish:release.
 * The release tag is created from the remote branch tip, so this commit has to
 * be on GitHub first. Installers and keystores stay out of git.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function git(args) {
  return spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

function fail(result, what) {
  const detail = (result.stderr || result.stdout || "").trim();
  console.error(`✗ git ${what} failed${detail ? `: ${detail}` : ""}`);
  process.exit(result.status == null ? 1 : result.status);
}

function readVersion() {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const match = env.match(/^VITE_APP_VERSION="([^"]+)"/m);
    if (match) return match[1];
  } catch { /* fall through */ }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.version || "1.0.0";
}

const status = git(["status", "--porcelain"]);
if (status.status !== 0) fail(status, "status");

if (!status.stdout.trim()) {
  console.log("\n✓ Nothing new to commit before the release upload\n");
  process.exit(0);
}

const added = git(["add", "-A"]);
if (added.status !== 0) fail(added, "add");

// Secrets and signing keys are never part of the release commit.
git(["reset", "HEAD", "--", ".env.local"]);
git(["reset", "HEAD", "--", "*.jks", "*.jks.bak", "*.keystore"]);

const staged = git(["diff", "--cached", "--name-only"]);
if (staged.status !== 0) fail(staged, "diff");
if (!staged.stdout.trim()) {
  console.log("\n✓ Nothing safe to commit before the release upload\n");
  process.exit(0);
}

const version = readVersion();
const message = `Release v${version}`;
console.log(`\n📝 Committing ${message}\n`);
const committed = git(["commit", "-m", message]);
if (committed.status !== 0) fail(committed, "commit");
process.stdout.write(committed.stdout || "");
process.stderr.write(committed.stderr || "");

const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branchResult.status !== 0) fail(branchResult, "rev-parse");
const branch = branchResult.stdout.trim();

console.log(`\n↑ Pushing ${branch} so the release tag can point at this commit\n`);
const pushed = git(["push", "origin", branch]);
if (pushed.status !== 0) fail(pushed, "push");
process.stdout.write(pushed.stdout || "");
process.stderr.write(pushed.stderr || "");
console.log("");
