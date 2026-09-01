#!/usr/bin/env bash
# Pre-push verification for the TrueGradient planning plugin.
# Checks the things that break silently: version drift, oversized skill
# descriptions, dangling cross-references, and rules the skills must never
# contradict. Run from the repo root:  ./scripts/verify-plugin.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
sect() { printf '\n\033[1m%s\033[0m\n' "$1"; }

sect "Versioning"
pv=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -1)
rv=$(sed -n 's/^Version \(.*\)$/\1/p' README.md | head -1)
cv=$(sed -n 's/^## \([0-9][0-9.]*\).*/\1/p' CHANGELOG.md | head -1)
[ -n "$pv" ] && ok "plugin.json      $pv" || bad "plugin.json has no version"
[ "$rv" = "$pv" ] && ok "README.md        $rv" || bad "README says '$rv', plugin.json says '$pv'"
[ "$cv" = "$pv" ] && ok "CHANGELOG.md     $cv (newest entry)" \
                  || bad "newest CHANGELOG entry is '$cv', plugin.json says '$pv'"
if printf '%s' "$pv" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  ok "semver shape"
else
  bad "version '$pv' is not MAJOR.MINOR.PATCH"
fi

sect "Manifest"
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import json,sys; json.load(open(".claude-plugin/plugin.json"))' 2>/dev/null \
    && ok "plugin.json is valid JSON" || bad "plugin.json is not valid JSON"
  python3 -c 'import json,sys; json.load(open(".mcp.json"))' 2>/dev/null \
    && ok ".mcp.json is valid JSON" || bad ".mcp.json is not valid JSON"
fi

sect "Skill frontmatter"
for f in skills/*/SKILL.md; do
  name=$(sed -n 's/^name: *//p' "$f" | head -1)
  dir=$(basename "$(dirname "$f")")
  n=$(awk '/^description: /{print length($0)-13; exit}' "$f")
  [ "$name" = "$dir" ] && ok "$dir  name matches directory" \
                       || bad "$dir  frontmatter name is '$name'"
  if [ "${n:-0}" -le 1024 ] && [ "${n:-0}" -gt 0 ]; then
    ok "$dir  description $n chars (limit 1024)"
  else
    bad "$dir  description is $n chars — the plugin fails to load over 1024"
  fi
done

sect "Cross-references resolve"
missing=$(grep -rhno '\.\./\.\./references/[A-Za-z-]*\.md' --include='*.md' skills \
          | sed 's|.*\.\./\.\./|| ' | tr -d ' ' | sort -u \
          | while read -r r; do [ -f "$r" ] || echo "$r"; done)
[ -z "$missing" ] && ok "every ../../references/*.md target exists" \
                  || bad "dangling reference(s): $missing"

sect "Rules that must never be contradicted"
grep -rq 'min(100' references skills 2>/dev/null \
  && bad "a min(100, ...) accuracy cap is back — accuracy is (1 - WMAPE) x 100, uncapped" \
  || ok "no accuracy cap"
grep -rq 'floored at 0 when' references skills 2>/dev/null \
  && bad "accuracy is described as floored at 0 — it can be negative" \
  || ok "no accuracy floor"
for fn in wmape accuracy bias mape mae rmse sum_columns; do
  if grep -rq "\"function\": *\"$fn\"" references skills 2>/dev/null; then
    bad "an example sends the broken aggregation function '$fn'"
  fi
done
grep -rq '"function": *"sum"' references skills && ok "examples use sum aggregations"
grep -rq 'Mode B' skills 2>/dev/null \
  && bad "Mode B (cross-experiment comparison) is back — it is unsupported" \
  || ok "no cross-experiment comparison mode"

sect "Repo hygiene"
[ -f .gitignore ] && ok ".gitignore present" || bad ".gitignore missing"
[ -f LICENSE ]    && ok "LICENSE present"    || bad "LICENSE missing"
if [ -d .git ] && git ls-files --error-unmatch .claude/settings.local.json >/dev/null 2>&1; then
  bad ".claude/settings.local.json is tracked — it disables the MCP server for clones"
else
  ok ".claude/settings.local.json not tracked"
fi
find . -name '.DS_Store' -not -path './.git/*' | grep -q . \
  && bad ".DS_Store files present — remove before committing" \
  || ok "no .DS_Store files"

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32mAll checks passed.\033[0m  Plugin version %s is ready to push.\n' "$pv"
else
  printf '\033[31m%d check(s) failed.\033[0m\n' "$fail"
fi
exit "$fail"
