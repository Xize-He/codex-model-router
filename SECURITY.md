# Security

## Local data

Model Router can access a local Codex account, conversation history, workspace files, and configured MCP services. Local configuration, history, credentials, logs, and workspaces are excluded by `.gitignore` and must not be committed.

The optional MCP credential cache uses Windows DPAPI and can only be decrypted by the Windows user that created it. It still contains account-bound authentication material and must remain inside the ignored `data/` directory.

## Reporting a vulnerability

Please use GitHub's private security advisory feature for this repository. Do not include real tokens, private MCP endpoints, conversation content, or internal file paths in a public issue.

If a credential is accidentally committed or posted, revoke or rotate it immediately. Removing it from the latest commit is not sufficient because it may remain in Git history.
