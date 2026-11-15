// Stamp version.json with the current git commit before a manual deploy.
// Usage: node scripts/stamp-version.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

let sha = "";
let builtAt = "";
try {
  sha = git(["rev-parse", "HEAD"]);
  builtAt = git(["show", "-s", "--format=%cI", "HEAD"]);
} catch (error) {
  console.error("stamp-version: git metadata unavailable:", String(error.message).split("\n")[0]);
  process.exit(1);
}

const payload = { sha, builtAt, stampedBy: "scripts/stamp-version.mjs" };
writeFileSync(join(root, "version.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("version.json ->", sha.slice(0, 7), builtAt);
