import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
const ref = process.argv[2];
assert.match(
  ref ?? "",
  /^[a-f0-9]{40}$/,
  "Supply an explicit full notify commit SHA.",
);
const response = await fetch(
  `https://raw.githubusercontent.com/commercekit-tools/notify/${ref}/schema/notification-event-v1.schema.json`,
  { redirect: "error", signal: AbortSignal.timeout(30000) },
);
assert(response.ok, "Schema download failed.");
const content = await response.text();
assert(Buffer.byteLength(content) < 65536);
const schema = JSON.parse(content);
assert.equal(schema.properties.schemaVersion.const, 1);
const ajv = new Ajv2020({ strict: false });
formats(ajv);
ajv.compile(schema);
await writeFile("contracts/notification-event-v1.schema.json", content);
await writeFile(
  "contracts/notify-provenance.json",
  JSON.stringify(
    {
      repository: "commercekit-tools/notify",
      commit: ref,
      schemaVersion: 1,
      license: "MIT",
      sha256: createHash("sha256").update(content).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
