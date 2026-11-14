# Third-party notices

This Action is MIT licensed. Deployment conventions were adapted from the public MIT-licensed CommerceKit CCv2 Build Action implementation. Copyright (c) 2026 CommerceKit. See LICENSE.

Runtime dependencies are pinned exactly:

- `@actions/core@3.0.1` (MIT): runner outputs, masking and summary APIs.
- `@commercekit-tools/ccv2-client@0.0.3` (MIT): framework-independent technical-user authentication and CCv2 transport.
- `@commercekit-tools/notification-contract@0.0.3` (MIT): NotificationEvent v1 schema, types, factories, validation, context/link safety and sanitization. Ajv and ajv-formats are transitive package dependencies; there is no separate schema copy or direct Ajv dependency here.

Published packages include their licenses. `dist/licenses.txt` contains the bundled dependency license inventory. Development tools provide TypeScript, linting, formatting, Vitest coverage and ncc bundling. SAP documentation is production authority but its authored OpenAPI is not redistributed. Tests use hand-authored models and independently authored CommerceKit Sandbox compatibility evidence.
