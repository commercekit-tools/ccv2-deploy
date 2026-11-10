# Contributing

Use Node 24.21.0 and pnpm 12.6.0 (`corepack enable`). Install with `pnpm install --frozen-lockfile`. The package is private and must not be published to npm.

Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test`, `pnpm test:coverage`, `pnpm audit`, `pnpm bundle`, `pnpm bundle:check`, `pnpm scan:public`, and `pnpm quality`. Coverage gates require 95% statements, branches, lines, and functions. Commit reproducible dist and its license inventory.

Tests use synthetic fixtures and mocked native fetch. Never use customer credentials, real SAP subscriptions, captured production responses, or private source. Review all staged files and scan public content before each commit.

Update the notification contract explicitly with `pnpm contracts:notify:update <40-character-commit-SHA>`; normal builds and CI validate the committed schema offline. Review provenance and licensing changes.

PRs need tests, documentation, current bundle, and passing CI/CodeQL. The manual Sandbox workflow must not run until PR review, green CI, and owner approval. Release remains blocked by RELEASING.md.
