import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /\/Users\/[a-z][^/\s]*\//i,
  /gh[pousr]_[a-zA-Z0-9]{30,}/,
  /github_pat_[a-zA-Z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /https:\/\/[^\s"']*\.sharepoint\.com\//,
];
for (const file of new Set(files)) {
  const body = readFileSync(file, "utf8");
  if (patterns.some((p) => p.test(body)))
    throw Error(`Public safety scan failed: ${file}`);
}
console.log(
  `Public scan passed (${new Set(files).size} files). Review is still required for unknown tenant identifiers.`,
);
