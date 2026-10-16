#!/bin/sh
set -eu
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=surfpool-darwin-arm64.tar.gz; checksum=fca0a1c75eca7cc848b8ff70f141c6fc6d39c11a781764d4840e001ea90172cc ;;
  Darwin-x86_64) asset=surfpool-darwin-x64.tar.gz; checksum=96cf61c8ac430f1dcd8eeff1fc74cf7a9d85752358d4316abf7636d8527fddcc ;;
  Linux-x86_64) asset=surfpool-linux-x64.tar.gz; checksum=64cff3fd6bb00bb0d5c7edef2915a491338d14eb19b7130abf9c81ee5357d165 ;;
  *) echo 'No pinned Surfpool binary for this platform' >&2; exit 1 ;;
esac
mkdir -p work/fork
archive="work/fork/$asset"
if [ ! -f "$archive" ]; then
  curl --fail --location --silent --show-error "https://github.com/solana-foundation/surfpool/releases/download/v1.6.1/$asset" -o "$archive"
fi
actual=$(openssl dgst -sha256 "$archive" | awk '{print $NF}')
if [ "$actual" != "$checksum" ]; then
  echo 'Pinned Surfpool archive checksum mismatch' >&2
  exit 1
fi
tar -xzf "$archive" -C work/fork
[ "$(work/fork/surfpool --version)" = 'surfpool 1.6.1' ]
