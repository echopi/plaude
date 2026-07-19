---
name: plaude-maintainer
description: Maintain the Plaude fork against official oh-my-pi releases. Use when checking or subscribing to new oh-my-pi versions, syncing an exact upstream tag, resolving merge or verification failures, validating fork behavior, committing a sync, submitting it to the Plaude fork, or inspecting/cleaning an in-progress upstream maintenance worktree. Triggers include "oh-my-pi 更新", "同步上游版本", "订阅上游 release", "验证合并", "plaude maintain", and "upstream sync".
---

# Plaude Maintainer

Use `scripts/plaude-maintain.ts` for deterministic state changes. Keep conflict resolution, failure diagnosis, test selection review, and code fixes in the agent workflow.

## Safety contract

- Sync an exact stable tag, never a moving `main`, unless the user explicitly asks otherwise.
- Work only in the isolated worktree reported by the CLI.
- Never force-push. `submit` pushes only the exact verified SHA.
- Do not submit without explicit user authorization.
- Keep credentials, state, locks, worktrees, and receipts outside the repository under `~/.local/state/plaude-maintainer` by default.
- Do not invoke the legacy `scripts/plaude-sync-upstream.sh`; it polls a moving branch and does not share this tool's state or verification gates.
- Treat `conflict` and `verify-failed` as diagnosis inputs, not reasons to weaken or skip verification.
- Keep fork-only fixes separate from changes suitable for upstream PRs.

## Release workflow

1. Inspect current state and the latest stable release:

   ```bash
   bun scripts/plaude-maintain.ts status --json
   bun scripts/plaude-maintain.ts check-release --json
   ```

2. Summarize the release diff and anchor acceptance criteria before mutation.

3. Prepare an isolated exact-tag merge:

   ```bash
   bun scripts/plaude-maintain.ts sync vX.Y.Z --json
   ```

   The command fetches `origin/auto/upstream-sync`, fetches the exact upstream tag, and creates `maintain/vX.Y.Z` under the state directory.

4. If the merge conflicts, inspect the receipt and worktree reported by the CLI. Resolve only intent-preserving conflicts, stage the resolution, and commit it. Do not abort merely to hide a conflict.

5. Run verification:

   ```bash
   bun scripts/plaude-maintain.ts verify --json
   ```

   Verification always runs dependency lock validation, repository checks, Plaude fork regressions, and every test file changed by the release. Package-wide suites are diagnostic signals: run them when investigating risk, but compare pre-existing failures against the base instead of making an unhealthy baseline a hard submit gate.

6. On failure, read the full `commands.log` in the reported receipt. Establish one root-cause hypothesis. Use the repository `bugfix` workflow for a product regression, commit the minimal fix in the maintenance worktree, then rerun `verify`. Never manually edit state to mark a run green.

7. Review the final range from the recorded `baseSha` to `verifiedSha`. Classify every change as upstream merge content, in-scope fork fix, or unrelated.

8. After explicit push authorization, submit and clean up:

   ```bash
   bun scripts/plaude-maintain.ts submit --json
   bun scripts/plaude-maintain.ts cleanup --json
   ```

## Release subscription

Check once without changing state:

```bash
bun scripts/plaude-maintain.ts check-release --json
```

Record and notify a newly observed release:

```bash
bun scripts/plaude-maintain.ts watch --once --json
```

Install the personal macOS watcher only when explicitly requested:

```bash
bun scripts/plaude-maintain.ts watch --install --interval 1800 --json
```

The watcher only notifies and records `lastSeenTag`; it never syncs, edits, commits, or pushes automatically.

## Recovery

- `Active sync already exists`: resume the reported worktree; do not create another.
- `Repository is dirty`: preserve the user's changes and stop.
- `Unresolved merge conflicts`: resolve and commit before verification.
- `changed after verification`: rerun `verify`; never bypass the SHA gate.
- Network/auth failure: preserve state and receipts, diagnose direct/proxy/auth layers, then retry the failed command only.
- Cleanup is allowed only after successful submission so a failed or unsubmitted worktree remains inspectable.
- When a newer release supersedes an unsubmitted sync, abandon the clean active worktree explicitly before syncing the newer exact tag:

  ```bash
  bun scripts/plaude-maintain.ts abandon --json
  ```

  `abandon` records the tag and HEAD in a receipt, refuses dirty worktrees, and never applies to submitted syncs.
