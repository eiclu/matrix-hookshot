#!/bin/sh
# Installs dependencies, using prebuilt matrix-sdk-crypto-nodejs libraries
# from vendor/matrix-sdk-crypto/<version>/ instead of downloading them from
# GitHub, for build hosts that cannot reach GitHub.
#
# Usage: scripts/preload-crypto-libs.sh <vendor dir> [pnpm install args...]
#
# Without preloaded libraries this is the same as `pnpm install`.
set -eu
VENDOR_DIR="$1"
shift

if ! ls "$VENDOR_DIR"/*/*.node >/dev/null 2>&1; then
  exec pnpm install "$@"
fi

# Install without lifecycle scripts, put the libraries in place, then run the
# lifecycle scripts. The download script skips libraries that already exist.
pnpm install --ignore-scripts "$@"
for pkg in node_modules/.pnpm/@matrix-org+matrix-sdk-crypto-nodejs@*/node_modules/@matrix-org/matrix-sdk-crypto-nodejs; do
  [ -d "$pkg" ] || continue
  version=$(node -p "require('./$pkg/package.json').version")
  for lib in "$VENDOR_DIR/$version"/*.node; do
    [ -f "$lib" ] || continue
    cp "$lib" "$pkg/"
    printf '%s' "$version" > "$pkg/$(basename "$lib").version"
    echo "Preloaded $(basename "$lib") for matrix-sdk-crypto-nodejs $version"
  done
done
pnpm rebuild
