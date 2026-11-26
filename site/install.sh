#!/bin/sh
# Am I Cooked installer for macOS and Linux.
#   curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh
# Options: --no-setup (or AMICOOKED_NO_SETUP=1) to skip `amicooked setup`;
#          --school <id|url>, --clients <list>, --yes forwarded to setup.
#          AMICOOKED_CLIENTS selects apps for both installers.
#          AMICOOKED_VERSION=v0.1.0 to pin a release.
set -eu

REPO="udaysinghkanwar/amicooked"
INSTALL_DIR="${AMICOOKED_HOME:-$HOME/.amicooked}/bin"
RUN_SETUP=1
[ "${AMICOOKED_NO_SETUP:-}" = "1" ] && RUN_SETUP=0
# Remove only the installer flag; keep every setup argument as its own argument.
remaining=$#
while [ "$remaining" -gt 0 ]; do
  arg=$1
  shift
  remaining=$((remaining - 1))
  case "$arg" in
    --no-setup) RUN_SETUP=0 ;;
    *) set -- "$@" "$arg" ;;
  esac
done
if [ -n "${AMICOOKED_SCHOOL:-}" ]; then
  set -- --school "$AMICOOKED_SCHOOL" "$@"
fi
if [ -n "${AMICOOKED_CLIENTS:-}" ]; then
  set -- --clients "$AMICOOKED_CLIENTS" "$@"
fi

say() { printf '%s\n' "$*"; }
fail() { say "Am I Cooked: $*"; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this installer is for macOS and Linux. On Windows run: irm https://amicooked-mcp.vercel.app/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported CPU $(uname -m). If you have Node.js, run: npx -y amicooked@0 setup" ;;
esac
# Intel Macs running under Rosetta still report x86_64; Apple silicon gets the native build
if [ "$os" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
[ "$os-$arch" = linux-arm64 ] && fail "no Linux ARM build yet. If you have Node.js, run: npx -y amicooked@0 setup"

asset="amicooked-$os-$arch"
if [ -n "${AMICOOKED_DOWNLOAD_BASE:-}" ]; then
  base="$AMICOOKED_DOWNLOAD_BASE"
elif [ -n "${AMICOOKED_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/$AMICOOKED_VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading Am I Cooked ($os-$arch)..."
# A download that stalls (under 10 KB/s for 30 seconds) is dropped and retried, so a dead connection
# can't leave the installer waiting forever
fetch() { curl -fsSL --retry 3 --retry-delay 2 --speed-limit 10240 --speed-time 30 "$1" -o "$2"; }
fetch "$base/$asset" "$tmp/$asset" 2>"$tmp/download-error" ||
  fail "Could not download Am I Cooked from $base. $(tail -n 1 "$tmp/download-error") Check your connection to GitHub and rerun the installer."
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" 2>"$tmp/download-error" ||
  fail "Could not verify the download because SHA256SUMS could not be fetched. $(tail -n 1 "$tmp/download-error") Check your connection and rerun the installer."

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] ||
  fail "Checksum mismatch. The download was rejected. Rerun the installer to download a fresh copy."

if ! { mkdir -p "$INSTALL_DIR" && chmod +x "$tmp/$asset" && mv "$tmp/$asset" "$INSTALL_DIR/amicooked"; } 2>"$tmp/install-error"; then
  fail "Could not install to $INSTALL_DIR. $(tail -n 1 "$tmp/install-error") Check that the folder is writable and rerun the installer."
fi
say "Installed to $INSTALL_DIR/amicooked"

# Put it on PATH for future terminals
line="export PATH=\"$INSTALL_DIR:\$PATH\""
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      if [ -f "$rc" ] || [ "$rc" = "$HOME/.profile" ]; then
        grep -qs "$INSTALL_DIR" "$rc" || printf '\n# Am I Cooked\n%s\n' "$line" >>"$rc"
      fi
    done
    if [ -d "$HOME/.config/fish" ]; then
      mkdir -p "$HOME/.config/fish/conf.d"
      printf 'fish_add_path %s\n' "$INSTALL_DIR" >"$HOME/.config/fish/conf.d/amicooked.fish"
    fi
    ;;
esac

if [ "$RUN_SETUP" = 1 ]; then
  # When piped from curl, stdin is the script, so setup reads the keyboard through the terminal that
  # stdout or stderr is already attached to. Not /dev/tty: the binary cannot poll that on macOS and crashes.
  if [ -t 0 ]; then
    "$INSTALL_DIR/amicooked" setup "$@"
  elif [ -t 1 ]; then
    "$INSTALL_DIR/amicooked" setup "$@" <&1
  elif [ -t 2 ]; then
    "$INSTALL_DIR/amicooked" setup "$@" <&2
  elif [ "$#" -gt 0 ]; then
    # Agent-driven setup needs no terminal prompts when school and clients are supplied.
    "$INSTALL_DIR/amicooked" setup "$@"
  else
    say "Next: run \"$INSTALL_DIR/amicooked\" setup"
  fi
else
  say "Next: run \"$INSTALL_DIR/amicooked\" setup"
fi
