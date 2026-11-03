import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const app = join(root, "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Fortis Demo.app");
const output = join(root, ".desktop-build", `Fortis-Demo-${version}-macOS-arm64.dmg`);
const stage = await mkdtemp(join(tmpdir(), "fortis-dmg-"));
try {
  const copy = spawnSync("ditto", [app, join(stage, "Fortis Demo.app")], { stdio: "inherit" });
  if (copy.status !== 0) throw new Error("Could not stage Mac application");
  await symlink("/Applications", join(stage, "Applications"));
  // ponytail: a plain disk image avoids Finder automation; add branding when notarized distribution is configured.
  const image = spawnSync("hdiutil", ["create", "-ov", "-volname", "Fortis Demo", "-srcfolder", stage, "-format", "UDZO", output], { stdio: "inherit" });
  if (image.status !== 0) throw new Error("Could not create Mac disk image");
  console.log(`Mac installer ready: ${output}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
