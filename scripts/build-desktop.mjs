import { chmod, cp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stage = join(root, ".fortis-desktop-stage");
const output = join(root, ".desktop-build");
const env = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", FORTIS_DESKTOP_BUILD: "true", FORTIS_RUNTIME_MODE: "demo" });

// Build a source-only copy so local .env files and the active development build never enter the installer.
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const path of ["src", "public", "package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"]) {
  await cp(join(root, path), join(stage, path), { recursive: true });
}
await symlink(join(root, "node_modules"), join(stage, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const build = spawnSync(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build"], { cwd: stage, env, stdio: "inherit" });
if (build.status !== 0) throw new Error("Desktop frontend build failed");

await mkdir(output, { recursive: true });
await rm(join(output, "server"), { recursive: true, force: true });
await cp(join(stage, ".next/standalone"), join(output, "server"), {
  recursive: true, dereference: true,
  filter: source => ![join(stage, ".next/standalone/node_modules"), join(stage, ".next/standalone/.fortis-desktop-stage/node_modules")].includes(source),
});
// Windows installers cannot preserve pnpm symlinks. Flatten only the traced runtime packages.
const tracedModules = join(stage, ".next/standalone/node_modules/.pnpm");
const versions = new Map();
async function copyPackages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(directory, entry.name);
    if (entry.name.startsWith("@")) { await copyPackages(source); continue; }
    const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (versions.has(pkg.name) && versions.get(pkg.name) !== pkg.version) throw new Error(`Cannot flatten multiple versions of ${pkg.name}`);
    versions.set(pkg.name, pkg.version);
    await cp(source, join(output, "server/node_modules", pkg.name), { recursive: true, dereference: true });
  }
}
for (const entry of await readdir(tracedModules)) {
  if (entry !== "node_modules") await copyPackages(join(tracedModules, entry, "node_modules"));
}
await rename(join(output, "server/.fortis-desktop-stage"), join(output, "server/app"));
await cp(join(stage, ".next/static"), join(output, "server/app/.next/static"), { recursive: true });
await cp(join(stage, "public"), join(output, "server/app/public"), { recursive: true });
await cp(join(root, "desktop/lifecycle.cjs"), join(output, "server/lifecycle.cjs"));

async function checkFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (/^\.env(?:\.|$)|\.(?:pem|key)$/i.test(entry.name)) throw new Error(`Private configuration in bundle: ${entry.name}`);
    if (entry.isDirectory()) await checkFiles(join(dir, entry.name));
  }
}
await checkFiles(join(output, "server"));

const nodeVersion = "22.23.4";
const isMac = process.argv.includes("--macos");
if (isMac) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This macOS build requires Apple Silicon");
  const archiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
  const archive = join(output, archiveName);
  let data;
  try { data = await readFile(archive); } catch { /* Download on the first build. */ }
  const hash = "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428";
  if (!data || createHash("sha256").update(data).digest("hex") !== hash) {
    const download = spawnSync("curl", ["--fail", "--location", "--retry", "3", "--max-time", "300", "--output", archive, `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`], { stdio: "inherit" });
    if (download.status !== 0) throw new Error("macOS Node download failed");
    data = await readFile(archive);
  }
  if (createHash("sha256").update(data).digest("hex") !== hash) throw new Error("macOS Node SHA-256 mismatch");
  const extract = spawnSync("tar", ["-xzf", archive, "-C", output, "--strip-components", "2", `node-v${nodeVersion}-darwin-arm64/bin/node`], { stdio: "inherit" });
  if (extract.status !== 0) throw new Error("macOS Node extraction failed");
  await rename(join(output, "node"), join(output, "node-macos"));
  await chmod(join(output, "node-macos"), 0o755);
} else {
  const nodeHash = "dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f";
  const exe = join(output, "node.exe");
  let binary;
  try { binary = await readFile(exe); } catch { /* Download on the first build. */ }
  if (!binary || createHash("sha256").update(binary).digest("hex") !== nodeHash) {
    const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/win-x64/node.exe`);
    if (!response.ok) throw new Error(`Node download: HTTP ${response.status}`);
    binary = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(binary).digest("hex") !== nodeHash) throw new Error("Node SHA-256 mismatch");
    await writeFile(exe, binary);
  }
}
const licensePath = join(output, "NODE-LICENSE.txt");
try { await readFile(licensePath); } catch {
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`);
  if (!license.ok) throw new Error("Node license download failed");
  await writeFile(licensePath, await license.text());
}
await cp(licensePath, join(output, "server/NODE-LICENSE.txt"));
console.log(`Desktop payload ready: ${output}`);
