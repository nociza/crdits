import { lstat, mkdir, readlink, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "skills", "crdits");
const installRoot = process.env.CRDITS_SKILL_INSTALL_ROOT || os.homedir();
const args = new Set(process.argv.slice(2));
const targets = [];
if (args.has("--codex") || args.has("--all") || args.size === 0) targets.push(path.join(installRoot, ".codex", "skills", "crdits"));
if (args.has("--claude") || args.has("--all") || args.size === 0) targets.push(path.join(installRoot, ".claude", "skills", "crdits"));

for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const stat = await lstat(target);
    if (!stat.isSymbolicLink()) throw new Error(`${target} exists and is not a symlink; refusing to replace it`);
    const existing = path.resolve(path.dirname(target), await readlink(target));
    if (existing !== source) throw new Error(`${target} points somewhere else; refusing to replace it`);
    console.log(`already installed: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await symlink(source, target, "dir");
    console.log(`installed: ${target} -> ${source}`);
  }
}
