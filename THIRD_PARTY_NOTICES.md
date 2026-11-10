# Third-party notices

This Action is MIT licensed. Authentication, transport, security and notification conventions were adapted from the public MIT-licensed CommerceKit CCv2 Build Action implementation. Copyright (c) 2026 CommerceKit. See LICENSE.

The exact NotificationEvent v1 schema and its MIT license are in contracts with commit and hash provenance. SAP documentation is production authority but its authored OpenAPI is not redistributed. Tests use hand-authored models and independently authored CommerceKit Sandbox compatibility evidence.

Runtime dependencies: @actions/core (MIT) supplies runner output/masking/summary APIs; Ajv and ajv-formats (MIT) validate the local NotificationEvent schema. Development tools provide TypeScript, linting, formatting, Vitest coverage, and ncc bundling. All direct dependencies are pinned. dist/licenses.txt contains the bundled dependency license inventory.
