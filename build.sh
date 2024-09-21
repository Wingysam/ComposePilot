#!/usr/bin/env bash
set -eu

build() {
    arch=$1
    bun build src/index.ts --compile --minify --sourcemap --outfile "dist/composepilot-$arch" --target "$arch"
}

rm -rf dist
mkdir dist

build bun-linux-x64
build bun-linux-x64-baseline

build bun-linux-arm64

build bun-windows-x64
build bun-windows-x64-baseline

build bun-darwin-x64
build bun-darwin-x64-baseline

build bun-darwin-arm64

# Bun is meant to clean these up, but doesn't always:
# https://github.com/oven-sh/bun/issues/14020
# The issue appears to be specific to darwin arm64 builds.
rm -f ./.*.bun-build
