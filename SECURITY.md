# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Braid, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@getbraid.dev**

Include the following in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix or mitigation**: depends on severity, but we aim for 30 days for critical issues

## Scope

The following are in scope:

- The Braid Electron application
- IPC communication between main and renderer processes
- Local data storage (sessions, settings, credentials)
- Integration with external tools (Claude CLI, GitHub CLI, git)

The following are out of scope:

- Vulnerabilities in upstream dependencies (report those to the respective projects)
- Issues requiring physical access to the machine
- Social engineering attacks

## Data Handling

Braid stores all data locally on your machine:

- **API keys**: stored in localStorage (renderer process)
- **Session history**: stored in `~/Braid/sessions/`
- **Settings**: stored in Electron's app data directory
- **No telemetry**: Braid does not send data to any external server

## Supported Versions

Only the latest release is supported with security updates.
