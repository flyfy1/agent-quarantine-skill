---
name: agent-quarantine-preinstall
description: Gate installation or updates of third-party Codex and Claude Code Skills through the Agent Quarantine REST API. Use before installing, copying, enabling, or updating any Skill from a public GitHub repository; continue only when the API returns decision=allow and installAllowed=true.
---

# Agent Quarantine Pre-install Gate

Run the deterministic API client before installing or updating a third-party Skill.

## Required configuration

Require both environment variables:

- `AGENT_QUARANTINE_API_URL`: Agent Quarantine origin, without the API path.
- `AGENT_QUARANTINE_API_KEY`: Personal API key beginning with `aq_`.

Set `AGENT_QUARANTINE_CLIENT` to `codex` or `claude-code`. When available, set
`AGENT_QUARANTINE_SESSION_ID` to the current session identifier.

Never print, persist, or pass the API key as a command-line argument.

## Gate workflow

1. Accept only a public `https://github.com/<owner>/<repo>` URL or a Skill directory URL under it.
2. Resolve this Skill's directory from the location of this `SKILL.md`.
3. Run:

   ```bash
   node <this-skill-directory>/scripts/check-skill.mjs <github-url> [skill-path]
   ```

   Omit `skill-path` when the GitHub URL already contains `/tree/<ref>/<path>`.
4. Read the JSON summary and the process exit code.
5. Continue with the user's requested installation only when the exit code is `0`,
   `decision` is `allow`, and `installAllowed` is `true`.
6. For every other result, do not install or enable the target Skill. Report the
   decision, reason, check ID, scan run ID, and risk score when present.

The client sends only the public GitHub source, optional Skill path, client name,
and optional session ID to `POST /api/v1/skill-checks`. It does not upload local
files or repository contents.

## Fail closed

- Exit `0`: API explicitly allowed installation.
- Exit `3`: API returned `review` or `block`; installation is denied.
- Exit `2`: configuration, network, authentication, quota, server, or response
  validation failure; installation is denied.

Do not bypass the gate, weaken the request, switch to MCP, or treat an unavailable
API as approval. Ask the user to resolve the API/account issue before retrying.
