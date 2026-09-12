# Security policy

## Supported versions
The `main` branch and the latest tagged release receive security fixes.

## Reporting a vulnerability
Email the maintainers (see the repository owner's profile) with a description, reproduction steps and impact. Please do not open public issues for security reports. We aim to acknowledge within 3 business days and to publish a fix or mitigation within 30 days for high/critical issues.

## Design notes
- Secrets are read only from environment variables and never logged or sent to browsers.
- Admin routes require `ADMIN_TOKEN`; public APIs can require API keys and are rate limited.
- All inputs are validated against the OpenAPI schema; uploads are size- and type-limited.
- Dependencies are pinned; `bun audit` runs in CI; runtime dependencies are zero for Node products.
- ARAG `security.groups` filtering is a retrieval filter, not an authorisation boundary; do not present it as one.
