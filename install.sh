#!/usr/bin/env bash
# Big Eyes installer for macOS.
#
#   Install the latest release:
#     curl -fsSL https://raw.githubusercontent.com/eranra/big-eyes/main/install.sh | bash
#
#   Build from this source folder and install (needs Node.js 20+):
#     ./install.sh --from-source
#
#   Install from a downloaded .dmg file:
#     ./install.sh --dmg ~/Downloads/Big-Eyes-0.1.0-arm64.dmg
#
#   Remove:
#     ./install.sh --uninstall        (keeps your settings)
#     ./install.sh --uninstall --purge (also removes settings)
set -euo pipefail

REPO="eranra/big-eyes"
APP_NAME="Big Eyes"
APP_DIR="/Applications/${APP_NAME}.app"
SETTINGS_DIR="${HOME}/Library/Application Support/${APP_NAME}"

say() { printf '\033[1;35m👀 %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer is for macOS. See the README for Windows and Linux."

mode="release"
purge=0
dmg=""
while [[ $# -gt 0 ]]; do
  arg="$1"
  shift
  case "$arg" in
    --from-source) mode="source" ;;
    --dmg) mode="dmg"; dmg="${1:-}"; shift || true ;;
    --uninstall) mode="uninstall" ;;
    --purge) purge=1 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done



quit_running_app() {
  if pgrep -f "${APP_DIR}/Contents/MacOS" >/dev/null 2>&1; then
    say "Closing the running Big Eyes…"
    osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
    sleep 1
    pkill -f "${APP_DIR}/Contents/MacOS" >/dev/null 2>&1 || true
  fi
}

install_app() {
  local source_app="$1"
  quit_running_app
  say "Installing to ${APP_DIR}"
  rm -rf "${APP_DIR}"
  ditto "${source_app}" "${APP_DIR}"
  # The app is ad-hoc signed, not notarized. Remove the "downloaded from the internet" mark,
  # so macOS opens it without a warning. This only affects this one app.
  xattr -dr com.apple.quarantine "${APP_DIR}" 2>/dev/null || true
  say "Starting Big Eyes. Look for the 👀 icon in the menu bar."
  open "${APP_DIR}"
  say "Done. The eyes appear after 30 seconds without keyboard or mouse use."
  say "The first time, macOS asks for camera access. Choose Allow."
}

install_from_dmg() {
  local file="$1"
  [[ -f "$file" ]] || fail "File not found: $file"
  tmp="$(mktemp -d)"
  trap 'hdiutil detach "$tmp/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  hdiutil attach "$file" -nobrowse -quiet -mountpoint "$tmp/mnt"
  install_app "$tmp/mnt/${APP_NAME}.app"
}

case "$mode" in
  dmg)
    install_from_dmg "$dmg"
    ;;

  uninstall)
    quit_running_app
    rm -rf "${APP_DIR}"
    if [[ $purge -eq 1 ]]; then rm -rf "${SETTINGS_DIR}"; fi
    say "Big Eyes removed.$([[ $purge -eq 1 ]] && echo ' Settings removed too.' || echo " Settings kept in ${SETTINGS_DIR}.")"
    ;;

  source)
    cd "$(dirname "$0")"
    command -v npm >/dev/null || fail "npm not found. Install Node.js 20 or newer from https://nodejs.org"
    say "Installing build tools (npm)…"
    npm install --no-audit --no-fund
    [[ -d node_modules/electron/dist ]] || node node_modules/electron/install.js
    npm run fetch-model
    say "Building the app…"
    npm run build
    arch="$(uname -m)"; [[ "$arch" == "x86_64" ]] && arch="x64"
    npx electron-builder --mac --dir "--${arch}" --publish never
    built="$(ls -d dist/mac*/"${APP_NAME}.app" | head -1)"
    [[ -d "$built" ]] || fail "Build failed: app not found in ./dist"
    install_app "$built"
    ;;

  release)
    arch="$(uname -m)"; [[ "$arch" == "x86_64" ]] && arch="x64"
    say "Finding the latest Big Eyes release…"
    api="https://api.github.com/repos/${REPO}/releases/latest"
    url="$(curl -fsSL "$api" | grep -o "\"browser_download_url\": *\"[^\"]*-${arch}\.dmg\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')" \
      || true
    [[ -n "${url:-}" ]] || fail "No macOS ${arch} download found at https://github.com/${REPO}/releases"
    download="$(mktemp -d)"
    say "Downloading ${url##*/}…"
    curl -fL --progress-bar -o "$download/BigEyes.dmg" "$url"
    install_from_dmg "$download/BigEyes.dmg"
    rm -rf "$download"
    ;;
esac
