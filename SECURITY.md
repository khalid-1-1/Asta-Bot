# Security Policy

## Reporting a vulnerability

Please do not publish credentials, WhatsApp session files, encryption keys, or exploit details in a public issue.

Report security concerns privately to the repository owner/maintainer with enough information to reproduce the issue safely.

## Never commit

- `.env` files containing real credentials
- WhatsApp authentication/session files
- `enc` / `enc1` encryption keys
- Dashboard account data under `dashboard/data/`
- Runtime logs or backups

The repository `.gitignore` is configured to exclude these local/runtime artifacts.
