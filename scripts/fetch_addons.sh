#!/usr/bin/env bash
# Fetch the lua-gdextension addon that powers PixelForge's Lua modding layer.
# Pinned to a known-good release. Safe to re-run (idempotent).
set -euo pipefail

VERSION="0.8.1"
URL="https://github.com/gilzoide/lua-gdextension/releases/download/${VERSION}/lua-gdextension.zip"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADDONS="${ROOT}/addons"
TARGET="${ADDONS}/lua-gdextension"

if [ -d "${TARGET}" ] && [ -n "$(ls -A "${TARGET}" 2>/dev/null || true)" ]; then
  echo "lua-gdextension already present at ${TARGET} — nothing to do."
  exit 0
fi

echo "Downloading lua-gdextension ${VERSION}..."
mkdir -p "${ADDONS}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

curl -fsSL "${URL}" -o "${TMP}/lua-gdextension.zip"

echo "Extracting to ${ADDONS}..."
# The zip already contains an addons/lua-gdextension/ prefix, so extract into ROOT.
unzip -oq "${TMP}/lua-gdextension.zip" -d "${TMP}/extracted"

# Copy the addon into place regardless of the zip's internal layout.
if [ -d "${TMP}/extracted/addons/lua-gdextension" ]; then
  cp -R "${TMP}/extracted/addons/lua-gdextension" "${ADDONS}/"
elif [ -d "${TMP}/extracted/lua-gdextension" ]; then
  cp -R "${TMP}/extracted/lua-gdextension" "${ADDONS}/"
else
  echo "Unexpected zip layout; contents:" >&2
  find "${TMP}/extracted" -maxdepth 2 >&2
  exit 1
fi

echo "Done. lua-gdextension installed at ${TARGET}"
