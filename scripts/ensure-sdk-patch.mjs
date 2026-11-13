/**
 * Makes sure @nearai/inference-sdk carries the clock-tolerance patch before a build.
 *
 * The patch (patches/@nearai__inference-sdk@0.3.0.patch) is normally applied by pnpm. On
 * 2026-11-13 the Vercel builds shipped the SDK without it: the install restored node_modules from
 * the build cache and the bundle still had the unpatched check, so any visitor whose clock was a
 * second behind NVIDIA's got "NVIDIA JWT verification failed: not_yet_valid" and could not chat.
 *
 * The build log of 2026-11-13 22:19 UTC then showed the patch present in node_modules while the
 * bundle was still unpatched: the bundler's persistent cache keys a package by its version, the
 * version did not change, so it kept serving the module it had compiled before the patch.
 *
 * So this script trusts neither the installer nor the cache. It reads the files the bundler will
 * read, applies the same two edits if they are missing, and fails the build if it cannot. It then
 * compares a hash of those files with a stamp kept inside the bundler cache; if the stamp is
 * missing or different, the cache was built from other SDK code and is dropped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOLERANCE_SECONDS = 120;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.SDK_DIST ?? join(root, "node_modules", "@nearai", "inference-sdk", "dist");
const files = ["index.js", "node.js"];

const edits = [
  {
    name: "jwtVerify clockTolerance",
    done: /issuer: NVIDIA_ISSUER,\s*requiredClaims: \["exp", "nbf", "iat"\],[^}]*clockTolerance: 120/,
    find: /(issuer: NVIDIA_ISSUER,\s*requiredClaims: \["exp", "nbf", "iat"\])(\s*\})/,
    replace: `$1,\n        // Yield AI patch: a fresh token fails nbf when the user's clock is slightly behind NVIDIA's.\n        clockTolerance: ${TOLERANCE_SECONDS}$2`,
  },
  {
    name: "iat check",
    done: /claims\.iat > Date\.now\(\) \/ 1e3 \+ 120\)/,
    find: /claims\.iat > Date\.now\(\) \/ 1e3\)/,
    replace: `claims.iat > Date.now() / 1e3 + ${TOLERANCE_SECONDS})`,
  },
];

let changed = false;
const hash = createHash("sha256");
for (const file of files) {
  const path = join(dist, file);
  if (!existsSync(path)) {
    console.error(`ensure-sdk-patch: ${path} not found. Run pnpm install first.`);
    process.exit(1);
  }
  let source = readFileSync(path, "utf8");
  let fileChanged = false;
  for (const edit of edits) {
    if (edit.done.test(source)) continue;
    const matches = source.match(new RegExp(edit.find.source, "g")) ?? [];
    if (matches.length !== 1) {
      console.error(
        `ensure-sdk-patch: cannot apply "${edit.name}" to ${file} (${matches.length} matches). ` +
          "The SDK changed; review patches/ before shipping."
      );
      process.exit(1);
    }
    source = source.replace(edit.find, edit.replace);
    fileChanged = true;
  }
  if (fileChanged) {
    // Write beside and rename, so a hard link into the package store is replaced, not edited.
    const temp = `${path}.patched`;
    writeFileSync(temp, source);
    renameSync(temp, path);
    changed = true;
    console.log(`ensure-sdk-patch: patched ${file} (the installer had not).`);
  }
  hash.update(source);
}
console.log(changed ? "ensure-sdk-patch: SDK patched by this script." : "ensure-sdk-patch: SDK clock-tolerance patch is in place.");

const cacheDir = join(root, ".next", "cache");
const stampPath = join(cacheDir, "sdk-patch.stamp");
const stamp = hash.digest("hex");
const previous = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : null;
if (previous !== stamp) {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
    console.log("ensure-sdk-patch: dropped .next/cache (it was built from other SDK code or has no stamp).");
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(stampPath, stamp + "
");
} else {
  console.log("ensure-sdk-patch: bundler cache matches this SDK code.");
}
