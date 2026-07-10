#!/usr/bin/env bash
set -euo pipefail

# infra/scripts/henosis-gate delegates to this recipe so the live gate and
# deploy render use the same ref resolution, toolchain, install, and build.
# A config-pinned ref passed as $1 is the intended future bot-track knob.

readonly REQUIRED_NODE_VERSION="22.23.1"
readonly REQUIRED_PNPM_VERSION="11.3.0"
readonly DEFAULT_REF="origin/main"
readonly DEFAULT_REMOTE="https://github.com/henosis-playground/platform.git"

ref="${1:-$DEFAULT_REF}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
default_checkout="$(CDPATH= cd -- "$script_dir/.." && pwd)"
checkout="${HENOSIS_PLATFORM_CHECKOUT:-$default_checkout}"
remote="${HENOSIS_PLATFORM_REMOTE:-$DEFAULT_REMOTE}"
cache_root="${HENOSIS_RUNNER_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/henosis-runner}"

case "$cache_root" in
  "" | "/")
    echo "Refusing unsafe Henosis runner cache directory: $cache_root" >&2
    exit 1
    ;;
esac

actual_node="$(node --version 2>/dev/null || true)"
if [ "$actual_node" != "v$REQUIRED_NODE_VERSION" ]; then
  echo "Henosis runner requires Node v$REQUIRED_NODE_VERSION; found ${actual_node:-missing}" >&2
  exit 1
fi

actual_pnpm="$(corepack "pnpm@$REQUIRED_PNPM_VERSION" --version 2>/dev/null || true)"
if [ "$actual_pnpm" != "$REQUIRED_PNPM_VERSION" ]; then
  echo "Henosis runner requires pnpm $REQUIRED_PNPM_VERSION; found ${actual_pnpm:-missing}" >&2
  exit 1
fi

mkdir -p "$cache_root"
exec 9>"$cache_root/prepare.lock"
flock 9

clone_staging=""
build_staging=""
cleanup() {
  if [ -n "$clone_staging" ]; then
    rm -rf -- "$clone_staging"
  fi
  if [ -n "$build_staging" ]; then
    rm -rf -- "$build_staging"
  fi
}
trap cleanup EXIT

if [ ! -d "$checkout/.git" ]; then
  if [ -e "$checkout" ] && [ -n "$(ls -A "$checkout" 2>/dev/null)" ]; then
    echo "Henosis platform checkout exists but is not a Git repository: $checkout" >&2
    exit 1
  fi
  mkdir -p "$(dirname -- "$checkout")"
  clone_staging="$checkout.clone-$$"
  rm -rf -- "$clone_staging"
  git clone --quiet --no-checkout "$remote" "$clone_staging"
  mv -- "$clone_staging" "$checkout"
  clone_staging=""
fi

git -C "$checkout" fetch --quiet --prune origin
sha="$(git -C "$checkout" rev-parse --verify "$ref^{commit}")"
cache_dir="$cache_root/$sha"
entrypoint="$cache_dir/henosis-runner"

read_marker() {
  if [ -f "$1/RUNNER_MARKER" ]; then
    tr -d '\r\n' < "$1/RUNNER_MARKER"
  else
    printf '%s' "unmarked"
  fi
}

if [ -x "$entrypoint" ] &&
  [ "$(cat "$cache_dir/.henosis-platform-sha" 2>/dev/null || true)" = "$sha" ]; then
  marker="$(read_marker "$cache_dir")"
  printf 'Henosis runner prepare: platform_sha=%s ref=%s cache=hit marker=%s\n' "$sha" "$ref" "$marker" >&2
  printf '%s\n' "$entrypoint"
  exit 0
fi

if [ -e "$cache_dir" ]; then
  rm -rf -- "$cache_dir"
fi
build_staging="$cache_root/.build-$sha-$$"
mkdir -p "$build_staging"
git -C "$checkout" archive "$sha" | tar -x -C "$build_staging"
printf '%s\n' "$sha" > "$build_staging/.henosis-platform-sha"

(
  cd "$build_staging"
  corepack "pnpm@$REQUIRED_PNPM_VERSION" install --frozen-lockfile
  corepack "pnpm@$REQUIRED_PNPM_VERSION" -r build
) >&2

cat > "$build_staging/henosis-runner" <<'EOF'
#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PATH="$root/.henosis-bin:$PATH"
export PATH
if [ "$#" -eq 0 ]; then
  echo "Usage: henosis-runner <gate|render> [args...]" >&2
  exit 2
fi
command="$1"
shift
case "$command" in
  gate) exec node "$root/packages/renderer/dist/gate.js" "$@" ;;
  render) exec node "$root/packages/renderer/dist/render.js" "$@" ;;
  *) echo "Unknown Henosis runner command: $command" >&2; exit 2 ;;
esac
EOF
mkdir -p "$build_staging/.henosis-bin"
cat > "$build_staging/.henosis-bin/pnpm" <<EOF
#!/bin/sh
exec corepack "pnpm@$REQUIRED_PNPM_VERSION" "\$@"
EOF
chmod +x "$build_staging/henosis-runner"
chmod +x "$build_staging/.henosis-bin/pnpm"

mv -- "$build_staging" "$cache_dir"
build_staging=""
marker="$(read_marker "$cache_dir")"
printf 'Henosis runner prepare: platform_sha=%s ref=%s cache=miss marker=%s\n' "$sha" "$ref" "$marker" >&2
printf '%s\n' "$entrypoint"
