# NotificationEvent contract

NotificationEvent v1 is provided by the exact published MIT-licensed package `@commercekit-tools/notification-contract@0.0.2`. Its public `schema` export is the contract authority used by the local compatibility check; its deployment factory validates every emitted event with the package's full validator. There is no duplicate schema or local Ajv compilation in this repository.

`pnpm contracts:check` verifies both installed shared package versions and manifest pins, the schemaVersion 1 export, all five deployment event outcomes, and removal of superseded schema/auth/transport files. It runs entirely offline. Action tests also validate every emitted event, including handled failures. Sandbox assertions use the same package validator.

Upgrade through an explicitly pinned published package version, never an implicit main fetch. Review the upstream contract and MIT license, run complete regression and guarded Sandbox verification, and rebuild dist. See [ownership and migration](../docs/shared-packages.md) and [contributing](../CONTRIBUTING.md).
