#!/bin/sh
set -eu

# Periodically sync the Plaude fork with upstream oh-my-pi.
#
# Intended Devix pod usage:
#   PLAUDE_REPO_DIR=/home/admin/workspace/plaude \
#   PLAUDE_FORK_URL=git@your-host:team/plaude.git \
#   PLAUDE_SYNC_INTERVAL_SECONDS=21600 \
#   sh scripts/plaude-sync-upstream.sh --loop
#
# The script never force-pushes. On conflicts or verification failures it leaves
# a receipt under $PLAUDE_RECEIPT_ROOT, outside the repo by default, and exits
# non-zero for --once, or sleeps until the next cycle for --loop.

MODE="${1:---once}"

REPO_DIR="${PLAUDE_REPO_DIR:-$PWD}"
FORK_URL="${PLAUDE_FORK_URL:-}"
UPSTREAM_URL="${PLAUDE_UPSTREAM_URL:-https://github.com/can1357/oh-my-pi.git}"
FORK_REMOTE="${PLAUDE_FORK_REMOTE:-origin}"
UPSTREAM_REMOTE="${PLAUDE_UPSTREAM_REMOTE:-upstream}"
BASE_BRANCH="${PLAUDE_BASE_BRANCH:-main}"
WORK_BRANCH="${PLAUDE_WORK_BRANCH:-auto/upstream-sync}"
INTERVAL_SECONDS="${PLAUDE_SYNC_INTERVAL_SECONDS:-21600}"
VERIFY_COMMAND="${PLAUDE_VERIFY_COMMAND:-bun check}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
RECEIPT_ROOT="${PLAUDE_RECEIPT_ROOT:-$STATE_HOME/plaude/upstream-sync}"
GIT_USER_NAME="${PLAUDE_GIT_USER_NAME:-}"
GIT_USER_EMAIL="${PLAUDE_GIT_USER_EMAIL:-}"
NOTIFY_COMMAND="${PLAUDE_NOTIFY_COMMAND:-}"

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "$1 is required" >&2
		exit 1
	fi
}

now_stamp() {
	date -u +"%Y%m%dT%H%M%SZ"
}

ensure_repo() {
	need_cmd git
	need_cmd bun
	mkdir -p "$(dirname "$REPO_DIR")"
	if [ -d "$REPO_DIR/.git" ]; then
		return
	fi
	if [ -z "$FORK_URL" ]; then
		echo "PLAUDE_FORK_URL is required when $REPO_DIR is not a git checkout" >&2
		exit 1
	fi
	git clone "$FORK_URL" "$REPO_DIR"
}

ensure_remote() {
	name="$1"
	url="$2"
	if git -C "$REPO_DIR" remote get-url "$name" >/dev/null 2>&1; then
		git -C "$REPO_DIR" remote set-url "$name" "$url"
	else
		git -C "$REPO_DIR" remote add "$name" "$url"
	fi
}

configure_git_identity() {
	if [ -n "$GIT_USER_NAME" ]; then
		git -C "$REPO_DIR" config user.name "$GIT_USER_NAME"
	fi
	if [ -n "$GIT_USER_EMAIL" ]; then
		git -C "$REPO_DIR" config user.email "$GIT_USER_EMAIL"
	fi
}

write_receipt() {
	status="$1"
	receipt_dir="$RECEIPT_ROOT/$(now_stamp)-$status"
	mkdir -p "$receipt_dir"
	git -C "$REPO_DIR" status --short >"$receipt_dir/git-status.txt" 2>&1 || true
	git -C "$REPO_DIR" log --oneline -5 >"$receipt_dir/git-log.txt" 2>&1 || true
	echo "$receipt_dir"
}

notify() {
	status="$1"
	message="$2"
	receipt_dir="${3:-}"
	if [ -z "$NOTIFY_COMMAND" ]; then
		return
	fi
	PLAUDE_NOTIFY_STATUS="$status" \
		PLAUDE_NOTIFY_MESSAGE="$message" \
		PLAUDE_NOTIFY_RECEIPT="$receipt_dir" \
		sh -c "$NOTIFY_COMMAND" || echo "Notification failed for $status" >&2
}

run_once() {
	ensure_repo
	configure_git_identity
	cd "$REPO_DIR"

	if [ -n "$(git status --porcelain)" ]; then
		receipt_dir="$(write_receipt dirty)"
		message="Worktree is dirty; receipt: $receipt_dir"
		notify dirty "$message" "$receipt_dir"
		echo "$message" >&2
		return 2
	fi

	if [ -n "$FORK_URL" ]; then
		ensure_remote "$FORK_REMOTE" "$FORK_URL"
	fi
	ensure_remote "$UPSTREAM_REMOTE" "$UPSTREAM_URL"

	git fetch --prune "$FORK_REMOTE"
	git fetch --prune "$UPSTREAM_REMOTE" "$BASE_BRANCH"
	upstream_sha="$(git rev-parse "$UPSTREAM_REMOTE/$BASE_BRANCH")"

	git checkout "$WORK_BRANCH" 2>/dev/null || git checkout -b "$WORK_BRANCH" "$FORK_REMOTE/$BASE_BRANCH"
	git merge --no-edit "$UPSTREAM_REMOTE/$BASE_BRANCH" || {
		git merge --abort >/dev/null 2>&1 || true
		receipt_dir="$(write_receipt conflict)"
		message="Upstream merge conflict for $upstream_sha; receipt: $receipt_dir"
		notify conflict "$message" "$receipt_dir"
		echo "$message" >&2
		return 3
	}

	if git diff --quiet "$FORK_REMOTE/$WORK_BRANCH"...HEAD 2>/dev/null; then
		echo "Already synced with upstream $upstream_sha"
		return 0
	fi

	bun install
	sh -c "$VERIFY_COMMAND" || {
		receipt_dir="$(write_receipt verify-failed)"
		message="Verification failed for upstream $upstream_sha; receipt: $receipt_dir"
		notify verify-failed "$message" "$receipt_dir"
		echo "$message" >&2
		return 4
	}

	if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
		git add -A
		git commit -m "chore: sync upstream $upstream_sha"
	fi

	git push "$FORK_REMOTE" "$WORK_BRANCH"
	receipt_dir="$(write_receipt ok)"
	message="Synced upstream $upstream_sha; receipt: $receipt_dir"
	notify ok "$message" "$receipt_dir"
	echo "$message"
}

case "$MODE" in
	--once)
		run_once
		;;
	--loop)
		while true; do
			run_once || true
			sleep "$INTERVAL_SECONDS"
		done
		;;
	*)
		echo "Usage: $0 [--once|--loop]" >&2
		exit 1
		;;
esac
