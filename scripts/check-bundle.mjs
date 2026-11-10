import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const target = await mkdtemp(join(tmpdir(), "ccv2-bundle-"));
try {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@vercel/ncc/dist/ncc/cli.js",
      "build",
      "src/main.ts",
      "--minify",
      "--license",
      "licenses.txt",
      "-o",
      target,
    ],
    { stdio: "inherit" },
  );
  assert.equal(result.status, 0);
  for (const entry of await readdir(target, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = relative(target, join(entry.parentPath, entry.name));
    assert.deepEqual(
      await readFile(join(target, file)),
      await readFile(join("dist", file)),
      `Stale dist/${file}`,
    );
  }
} finally {
  await rm(target, { recursive: true, force: true });
}
