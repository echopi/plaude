#!/bin/sh
set -eu

# Source installer for Plaude. It keeps a persistent checkout and installs a
# `plaude` wrapper without replacing any existing `omp` command.
#
# Environment:
#   PLAUDE_REPO       git URL to clone/pull
#   PLAUDE_REF        branch/tag/commit to checkout, default: main
#   PLAUDE_HOME       persistent install root, default: ~/.plaude
#   PLAUDE_BIN_DIR    command install dir, default: ~/.local/bin

REPO_URL="${PLAUDE_REPO:-}"
REF="${PLAUDE_REF:-main}"
HOME_DIR="${PLAUDE_HOME:-$HOME/.plaude}"
BIN_DIR="${PLAUDE_BIN_DIR:-$HOME/.local/bin}"
REPO_DIR="$HOME_DIR/repo"
CMD_NAME="plaude"

if [ -z "$REPO_URL" ]; then
	echo "PLAUDE_REPO is required, for example:"
	echo "  PLAUDE_REPO=git@your-host:team/plaude.git sh scripts/install-plaude.sh"
	exit 1
fi

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "$1 is required" >&2
		exit 1
	fi
}

need_cmd git
need_cmd bun

mkdir -p "$HOME_DIR" "$BIN_DIR"

if [ -d "$REPO_DIR/.git" ]; then
	echo "Updating $REPO_DIR"
	git -C "$REPO_DIR" fetch --prune origin
else
	echo "Cloning $REPO_URL -> $REPO_DIR"
	git clone "$REPO_URL" "$REPO_DIR"
fi

git -C "$REPO_DIR" checkout "$REF"
git -C "$REPO_DIR" pull --ff-only origin "$REF" 2>/dev/null || true

echo "Installing dependencies"
(cd "$REPO_DIR" && bun install)

echo "Building native package"
(cd "$REPO_DIR" && bun run build:native)

WRAPPER="$BIN_DIR/$CMD_NAME"
cat >"$WRAPPER" <<EOF
#!/bin/sh
export PLAUDE_STATUSLINE_STYLE="\${PLAUDE_STATUSLINE_STYLE:-claude}"
export PI_CODEX_WEBSOCKET="\${PI_CODEX_WEBSOCKET:-0}"
if [ -z "\${PI_PROXY:-}" ]; then
	PI_PROXY="\${HTTPS_PROXY:-\${HTTP_PROXY:-}}"
fi
if [ -z "\${PI_PROXY:-}" ] && command -v scutil >/dev/null 2>&1; then
	PI_PROXY="\$(scutil --proxy | awk '
		\$1 == "HTTPSEnable" && \$3 == "1" { enabled = 1 }
		\$1 == "HTTPSProxy" { host = \$3 }
		\$1 == "HTTPSPort" { port = \$3 }
		END { if (enabled && host && port) printf "http://%s:%s", host, port }
	')"
fi
if [ -z "\${PI_PROXY:-}" ] && command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 7897 >/dev/null 2>&1; then
	PI_PROXY="http://127.0.0.1:7897"
fi
export PI_PROXY
exec bun --cwd "$REPO_DIR/packages/coding-agent" src/cli.ts "\$@"
EOF
chmod +x "$WRAPPER"

echo "Installed $CMD_NAME -> $WRAPPER"
case ":$PATH:" in
	*":$BIN_DIR:"*) echo "Run '$CMD_NAME' to get started." ;;
	*) echo "Add $BIN_DIR to PATH, then run '$CMD_NAME'." ;;
esac
