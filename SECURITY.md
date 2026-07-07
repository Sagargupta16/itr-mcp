# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Sagargupta16/itr-mcp/security/advisories/new). Do not open a public issue for security problems.

Relevant surface: itr-mcp decrypts and parses sensitive tax documents locally (AIS JSON, 26AS text). In scope: anything that could leak document contents or passwords (into error messages, logs, or tool text output beyond the documented masking), crypto misuse in the AIS decryption path, and path traversal via tool `path` parameters.

## What itr-mcp never does

No network transports, no telemetry, no credential storage. If you find code violating this, report it as a vulnerability.
