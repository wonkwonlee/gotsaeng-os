# Security

GotSaeng OS v0.10 is local-only. It reads Markdown files from a user-specified directory or the
current desktop Obsidian vault and writes generated context-pack files to a local output directory.

v0.10 does not include telemetry, hidden network calls, credential collection, API key handling,
cloud sync, remote execution, or LLM API calls.

See [`docs/security-audit.md`](./docs/security-audit.md) for the current local-only behavior audit,
repeatable scan commands, dependency-surface notes, and documentation claim boundaries.

Please report security issues privately through GitHub private vulnerability reporting on the public
repository. If private vulnerability reporting is not yet enabled, open a minimal non-sensitive issue
asking the maintainers to enable a private disclosure channel before sharing details.
