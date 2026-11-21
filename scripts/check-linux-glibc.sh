#!/usr/bin/env bash
# Fails if any Linux native module in the packaged app needs a newer glibc or
# libstdc++ than the floor we promise. node-pty has no Linux prebuild, so
# pty.node is compiled during the build and silently inherits the build
# machine's symbol versions; when ubuntu-latest moved to a glibc 2.42 image, the
# shipped app stopped loading on older distros with "Failed to load native
# module: pty.node". scripts/build-node-pty-linux.sh prevents that; this proves it.
#
# Usage: check-linux-glibc.sh [glibc-floor] [glibcxx-floor] [out-dir]
# Defaults match manylinux_2_28 / RHEL 8 / Debian 10: glibc 2.28, GLIBCXX 3.4.25.
set -euo pipefail

GLIBC_FLOOR="${1:-2.28}"
GLIBCXX_FLOOR="${2:-3.4.25}"
ROOT="${3:-out}"

mapfile -t MODULES < <(find "$ROOT" -path '*-linux-*' -path '*app.asar.unpacked*' -name '*.node' -type f)
if [ "${#MODULES[@]}" -eq 0 ]; then
  echo "::error::No Linux native modules found under $ROOT. Did packaging run?"
  exit 1
fi

# Highest version of symbol family $2 (GLIBC or GLIBCXX) that $1 requires.
highest() {
  objdump -T "$1" | grep -o "$2_[0-9][0-9.]*" | sed "s/^$2_//" | sort -uV | tail -1
}

# True if $1 > $2 as versions.
newer() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

FAILED=0
CHECKED=0
for f in "${MODULES[@]}"; do
  # Skip the other platforms' prebuilds that node-pty also ships (Mach-O, PE).
  file -b "$f" | grep -q '^ELF' || continue
  CHECKED=$((CHECKED + 1))
  GLIBC=$(highest "$f" GLIBC); GLIBC="${GLIBC:-0}"
  GLIBCXX=$(highest "$f" GLIBCXX); GLIBCXX="${GLIBCXX:-0}"
  if newer "$GLIBC" "$GLIBC_FLOOR"; then
    echo "::error file=$f::requires glibc $GLIBC, newer than the supported floor $GLIBC_FLOOR"
    objdump -T "$f" | grep "GLIBC_$GLIBC\b" || true
    FAILED=1
  fi
  if newer "$GLIBCXX" "$GLIBCXX_FLOOR"; then
    echo "::error file=$f::requires GLIBCXX $GLIBCXX, newer than the supported floor $GLIBCXX_FLOOR"
    objdump -T "$f" | grep "GLIBCXX_$GLIBCXX\b" || true
    FAILED=1
  fi
  echo "checked: $f (glibc $GLIBC, GLIBCXX $GLIBCXX)"
done

if [ "$CHECKED" -eq 0 ]; then
  echo "::error::No Linux ELF native modules found under $ROOT."
  exit 1
fi
exit "$FAILED"
