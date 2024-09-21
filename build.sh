#!/usr/bin/env bash
set -eu

build() {
    arch=$1
    bun build src/index.ts --compile --minify --sourcemap --outfile "dist/$arch" --target "$arch"
}

build bun-linux-x64
build bun-linux-x64-baseline

build bun-linux-arm64

build bun-windows-x64
build bun-windows-x64-baseline

build bun-darwin-x64
build bun-darwin-x64-baseline

build bun-darwin-arm64
