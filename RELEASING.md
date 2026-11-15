# Release policy — UNRELEASED

## Consistent reporting dependency

Notification-contract **0.0.6** is published through the owner-authorized
[package-only run 43678067818](https://github.com/commercekit-tools/action-kit/actions/runs/43678067818).
This consumer pins the exact registry artifact and bundles it normally with
ccv2-client 0.0.3 unchanged. Candidate-only validation switches are retired.
Normal full quality and hosted checks must pass on the current PR head before
its authorized source merge. See [reporting evidence](docs/consistent-reporting.md).
All remaining Action-release, provider/live validation and owner gates below
remain separate. Package publication does not create an Action tag or release.

NO RELEASE UNTIL BUILD, DEPLOY AND NOTIFY ARE SANDBOX-VERIFIED TOGETHER.

No tags, moving v1, GitHub Release, npm publishing, or Marketplace publication until all gates pass:

1. ccv2-build implementation merged.
2. Build success/failure/timeout/rate-limit Sandbox scenarios pass.
3. ccv2-deploy implementation merged.
4. Deployment success/failure/timeout scenarios pass.
5. Green manual-decision scenario passes.
6. Green ACCEPT scenario passes.
7. PREPARE_CANARY scenario passes.
8. Canary traffic-split update passes.
9. Green REJECT scenario passes.
10. Cancellation scenario passes.
11. Deployment rate-limit scenario passes.
12. Create-deployment ambiguity verified.
13. Build output feeds deploy input.
14. Both producer NotificationEvent v1 outputs validate.
15. Notify consumes real build/deploy producer events.
16. Live Slack smoke passes.
17. Live Teams Workflow smoke passes.
18. Complete build → deploy → notify workflow passes.
19. Marketplace names validated.
20. Owner explicitly authorizes coordinated release.

Merging an implementation is not release authorization.

The current shared dependencies are exactly `@commercekit-tools/notification-contract@0.0.6` and `@commercekit-tools/ccv2-client@0.0.3`. These package versions being published does not release this Action. Any package upgrade requires complete deployment regression tests, all ten guarded Sandbox scenarios (including canary traffic split), and coordinated build → deploy → notify validation again. Rebuild and verify committed dist and license notices. Workflow consumers require no package configuration because dependencies are bundled. Maintainers/CI need GitHub Packages read access for installation.
