#!/bin/sh
# Am I Cooked installer for macOS and Linux.
#   curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh
# Options: --no-setup (or AMICOOKED_NO_SETUP=1) to skip `amicooked setup`;
#          AMICOOKED_VERSION=v0.1.0 to pin a release.
set -eu

REPO="udaysinghkanwar/amicooked"
INSTALL_DIR="${AMICOOKED_HOME:-$HOME/.amicooked}/bin"
RUN_SETUP=1
[ "${AMICOOKED_NO_SETUP:-}" = "1" ] && RUN_SETUP=0
for arg in "$@"; do
  [ "$arg" = "--no-setup" ] && RUN_SETUP=0
done

say() { printf '%s\n' "$*"; }
fail() { printf 'amicooked: %s\n' "$*" >&2; exit 1; }

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
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "download failed from $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "couldn't download checksums"

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "checksum mismatch; the download may be corrupted. Try again."

mkdir -p "$INSTALL_DIR"
mv "$tmp/$asset" "$INSTALL_DIR/amicooked"
chmod +x "$INSTALL_DIR/amicooked"
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
  # When piped from curl, stdin is the script; read answers from the terminal instead
  if [ -r /dev/tty ]; then
    "$INSTALL_DIR/amicooked" setup </dev/tty
  else
    "$INSTALL_DIR/amicooked" setup
  fi
else
  say "Next: run \"$INSTALL_DIR/amicooked\" setup"
fi
