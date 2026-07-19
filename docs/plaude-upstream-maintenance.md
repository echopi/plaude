# Plaude Upstream Maintenance Contract

This document records the reusable acceptance contract for syncing Plaude with
an exact oh-my-pi release. The executable source of truth is
`scripts/plaude-maintain.ts`; this document explains why each gate exists.

## Verification checklist

Run the maintainer CLI in its isolated worktree and keep the receipt directory
outside the repository.

1. Sync an exact stable tag from a clean repository.
2. Review the range from `baseSha` to `HEAD` before verification. Deletion of a
   protected fork surface fails closed; decide explicitly whether it is an
   intentional removal before changing the range.
3. Run frozen dependency installation, `bun check`, and native maintenance
   preparation.
4. Run `bun packages/coding-agent/src/cli.ts --version` as the minimum CLI
   startup smoke.
5. Run `packages/coding-agent/bench/transcript-compose.bench.ts`. Its ratio is
   diagnostic; the hard guard is p95 below 10 ms for the 5,000-block session.
6. Run the fixed fork regressions, including
   `packages/coding-agent/test/lite-cli-surface.test.ts`, and every test file
   changed by the release.
7. Review the final range and classify upstream content, fork fixes, and
   unrelated changes.
8. After explicit authorization, submit. Submission verifies that the remote
   branch resolves to the exact verified SHA before recording `submitted`.

Package-wide suites remain diagnostic rather than a hard submit gate: compare
pre-existing failures against the base before treating them as regressions.

## Claude/lite status-line contract

In lite rendering, the effective status-line preset is deliberately forced to
`lite` even when persisted `statusLine.preset` is `custom` or another preset.
`renderStyle=claude` controls the Claude presentation branch; it is not an
unverified runtime priority race. Changes to this contract must update the
settings schema, lite defaults, preset registration, settings consumers, and
behavioral tests together. The regression test must prove the rendered/effective
behavior, not grep source text.

The UI may still expose persisted status-line settings for compatibility. If a
setting is intentionally ignored by lite rendering, that mismatch must be
documented or hidden rather than silently interpreted as evidence that the
Claude style failed.

## Transcript compaction decision record

Commit `127cca511` is retained as an intentional replacement of local
scrollback compaction: version tracking keeps post-finalize mutations visible
without destructive replay. It must not be mechanically reverted merely because
an upstream sync shows the deletion of the old compaction code.

The existing transcript contract tests cover post-finalize version updates,
committed replay behavior, and width changes. The remaining acceptance risks are
long-session memory retention and compose performance; the benchmark is now a
verification gate for the latter and reports its size ratio for trend review.
Any future change to this decision must include new evidence for both risks and
must update this record with the commit or benchmark receipt.
