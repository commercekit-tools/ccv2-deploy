# Security

Report vulnerabilities through this repository's GitHub private vulnerability reporting facility. Do not put credentials or customer responses into public issues.

Technical-user values and received tokens are masked immediately. Tokens live only in process memory; HTTPS is mandatory, redirects are blocked, and Management credentials are sent only to the validated configured API origin. Configure endpoints only from trusted workflow inputs. There is no telemetry or runtime shell execution.

Safe reads and token requests retry transient failures; unsafe mutations allow only one explicit 401 refresh retry. Ambiguous writes require operator inspection before retry. Local timeout and runner shutdown never cancel remotely. Traffic split accepts only bounded endpoint/service codes and integer percentages. Result/event models exclude raw API responses, history, credentials and infrastructure details. Provider error text is deliberately omitted because arbitrary problem details can contain unknown secrets.

Fixtures must be synthetic. Public scanning detects common credential formats and local paths; human review is required for unknown tenant identifiers. Never run real SAP credentials in automated tests.
