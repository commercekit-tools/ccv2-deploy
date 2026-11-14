# Contributing

Use Node 24.21.0 and pnpm 12.6.0 (`corepack enable`). Install with `pnpm install --frozen-lockfile`. The package is private and must not be published to npm.

Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test`, `pnpm test:coverage`, `pnpm audit`, `pnpm bundle`, `pnpm bundle:check`, `pnpm scan:public`, and `pnpm quality`. Coverage gates require 95% statements, branches, lines, and functions. Commit reproducible dist and its license inventory.

Tests use synthetic fixtures and mocked native fetch. Never use customer credentials, real SAP subscriptions, captured production responses, or private source. Review all staged files and scan public content before each commit.

Shared packages are pinned exactly to `@commercekit-tools/notification-contract@0.0.3` and `@commercekit-tools/ccv2-client@0.0.3`. The repository `.npmrc` selects GitHub Packages for this scope. Configure your personal read credential in your user-level `.npmrc`; never put a token in the repository. Use `npm config get userconfig` to check which configuration your shell selects if an IDE overrides it. Do not print authentication settings in diagnostics.

Repository Actions need read access to both packages. CI uses `contents: read`, `packages: read`, setup-node registry configuration, and `NODE_AUTH_TOKEN` from `secrets.GITHUB_TOKEN` for install steps only. The repository must be granted access in each package's Actions access settings. A successful local install does not prove that the repository token has access.

`pnpm contracts:check` checks exact package versions, the public schema export, and deployment event compatibility offline. There is no vendored schema or schema-download command. Upgrade published packages with explicit exact versions, review their public API and licenses, run the complete deployment regression and guarded Sandbox scenarios, and rebuild/commit `dist`. Do not substitute workspace links or local Action Kit sources. Framework-independent transport belongs in the shared client; deployment orchestration remains here.

PRs need tests, documentation, current bundle, and passing CI/CodeQL. The manual Sandbox workflow must not run until PR review, green CI, and owner approval. Release remains blocked by RELEASING.md.
