# AGENTS.md

## Git Workflow Default

- After completing requested edits, automatically run `git add` for only the files changed by the agent, then `git commit`, then `git push`.
- Do not stage or commit unrelated working tree changes.
- If the user explicitly says not to commit or not to push, follow the user request for that turn.
