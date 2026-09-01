#!/usr/bin/env bash
# Build the release archive that gets uploaded to Claude.
#
# The plugin root MUST be the archive root: .claude-plugin/plugin.json has to sit
# at the top level of the zip, with references/ and skills/ beside it. An archive
# with a wrapper directory fails to load.
#
# This is why GitHub's "Download ZIP" button is NOT usable for installing this
# plugin: it wraps everything in <repo>-<branch>/. Ship the artifact this script
# builds as a release asset instead.
#
#   ./scripts/package.sh            → dist/tg-planning-plugin-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

command -v zip >/dev/null || { echo "zip not found" >&2; exit 1; }

./scripts/verify-plugin.sh >/dev/null || {
  echo "verify-plugin.sh failed — not packaging. Run it to see why." >&2; exit 1; }

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | /usr/bin/head -1)
out="dist/tg-planning-plugin-${version}.zip"
mkdir -p dist
rm -f "$out"

find . -name '.DS_Store' -not -path './.git/*' -delete

# Everything the plugin needs, and nothing local or repo-only.
zip -qr "$out" . \
  -x '.git/*' '.git' \
  -x '.github/*' \
  -x '.claude/*' '.claude' \
  -x 'dist/*' 'dist' \
  -x '.gitignore' \
  -x '*.zip' \
  -x '.DS_Store' '*/.DS_Store' '__MACOSX/*'

# The archive is worthless if the manifest is not at the root — prove it is.
# Listing captured once: piping into `grep -q` under `pipefail` reports failure,
# because grep exits on the first match and unzip dies of SIGPIPE.
listing=$(unzip -l "$out")
reject() { echo "BUILD REJECTED: $1" >&2; rm -f "$out"; exit 1; }

printf '%s\n' "$listing" | grep -E ' \.claude-plugin/plugin\.json$' >/dev/null \
  || reject ".claude-plugin/plugin.json is not at the archive root."
printf '%s\n' "$listing" | grep -E ' [^ /]+/\.claude-plugin/plugin\.json$' >/dev/null \
  && reject "the archive has a wrapper directory — it will not load."
printf '%s\n' "$listing" | grep -E '__MACOSX|\.DS_Store' >/dev/null \
  && reject "macOS cruft in the archive."
for d in references skills; do
  printf '%s\n' "$listing" | grep -E " $d/" >/dev/null || reject "$d/ is missing."
done
n_skills=$(printf '%s\n' "$listing" | grep -cE ' skills/[^/]+/SKILL\.md$')
[ "$n_skills" -eq 5 ] || reject "expected 5 SKILL.md files at skills/*/, found $n_skills."

printf '\n\033[32mBuilt\033[0m %s  (%s)\n\n' "$out" "$(du -h "$out" | cut -f1)"
unzip -l "$out" | sed -n '4,$p' | grep -v '^ *0 ' | awk '{printf "  %8s  %s\n", $1, $4}'
printf '\nUpload this file to Claude. Do not use GitHub'"'"'s Download ZIP —\nit adds a wrapper directory and will not load.\n'
