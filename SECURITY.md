# Security

Report vulnerabilities through this repository's GitHub private vulnerability reporting facility. Do not put credentials or customer responses into public issues.

Technical-user values and received tokens are masked immediately. Tokens live only in process memory; HTTPS is mandatory, redirects are blocked, and Management credentials are sent only to the validated configured API origin. Configure endpoints only from trusted workflow inputs. There is no telemetry or runtime shell execution.

Safe reads and token requests retry transient failures; unsafe mutations allow only one explicit 401 refresh retry. Ambiguous writes require operator inspection before retry. Local timeout and runner shutdown never cancel remotely. Traffic split accepts only bounded endpoint/service codes and integer percentages. Result/event models exclude raw API responses, history, credentials and infrastructure details. Provider error text is deliberately omitted because arbitrary problem details can contain unknown secrets.

Fixtures must be synthetic. Public scanning detects common credential formats and local paths; human review is required for unknown tenant identifiers. Never run real SAP credentials in automated tests.

Authentication and transport use exactly `@commercekit-tools/ccv2-client@0.0.2`; event creation, validation, context/link checks, and sanitization use exactly `@commercekit-tools/notification-contract@0.0.2`. Deploy registers runtime secrets with the runner and applies its conservative output disclosure policy on top of shared sanitization. Even sanitized provider problem title/detail fields are not published. Only the four technical-user credentials enter the token manager; lifecycle inputs are never registered as credentials.

Packages are bundled into the committed Action, with no runtime registry access. Package installation credentials are maintainer/CI concerns and never enter the bundle. CI grants package read permission only. Package upgrades require full deployment regression and Sandbox verification; the Action remains unreleased until coordinated release gates pass.
