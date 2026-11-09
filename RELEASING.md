# Release policy — UNRELEASED

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
