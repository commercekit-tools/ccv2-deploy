import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
const schema = JSON.parse(
  readFileSync("contracts/notification-event-v1.schema.json", "utf8"),
);
const pin = JSON.parse(
  readFileSync("contracts/notify-provenance.json", "utf8"),
);
assert.equal(schema.properties.schemaVersion.const, 1);
assert.match(pin.commit, /^[a-f0-9]{40}$/);
assert.equal(
  createHash("sha256")
    .update(readFileSync("contracts/notification-event-v1.schema.json"))
    .digest("hex"),
  pin.sha256,
);
const ajv = new Ajv2020({ strict: false });
formats(ajv);
ajv.compile(schema);
console.log("Pinned NotificationEvent v1 schema validated offline.");
