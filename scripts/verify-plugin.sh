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
mv=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' .claude-plugin/marketplace.json | head -1)
[ -n "$pv" ] && ok "plugin.json      $pv" || bad "plugin.json has no version"
[ "$rv" = "$pv" ] && ok "README.md        $rv" || bad "README says '$rv', plugin.json says '$pv'"
[ "$cv" = "$pv" ] && ok "CHANGELOG.md     $cv (newest entry)" \
                  || bad "newest CHANGELOG entry is '$cv', plugin.json says '$pv'"
# The marketplace entry pins the version users receive: if it lags plugin.json,
# the directory keeps serving the old plugin however often the repo is updated.
[ "$mv" = "$pv" ] && ok "marketplace.json $mv (entry pin)" \
                  || bad "marketplace.json pins '$mv', plugin.json says '$pv'"
# The admin upload step names an archive by hand. It has been wrong on both the
# name and the version before, sending admins looking for a file that never existed.
grep -q "tg-claude-connector-plugin-${pv}\.zip" README.md \
  && ok "README names the archive package.sh actually builds" \
  || bad "README does not name tg-claude-connector-plugin-${pv}.zip — the upload step points at a file that is not built"
if printf '%s' "$pv" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  ok "semver shape"
else
  bad "version '$pv' is not MAJOR.MINOR.PATCH"
fi

sect "Manifest"
if command -v python3 >/dev/null 2>&1; then
  for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json .mcp.json; do
    python3 -c "import json,sys; json.load(open('$j'))" 2>/dev/null \
      && ok "$j is valid JSON" || bad "$j is not valid JSON"
  done

  # The directory listing renders the marketplace entry, Claude Code renders
  # plugin.json. If they disagree, users read one thing and install another.
  drift=$(python3 - <<'PY'
import json
p = json.load(open(".claude-plugin/plugin.json"))
m = json.load(open(".claude-plugin/marketplace.json"))
entry = next((e for e in m["plugins"] if e.get("name") == p.get("name")), None)
if entry is None:
    print("no marketplace entry named '%s'" % p.get("name"))
else:
    for k in ("displayName", "description", "license", "homepage",
              "repository", "author", "keywords"):
        if p.get(k) != entry.get(k):
            print("%s differs between plugin.json and the marketplace entry" % k)
PY
)
  [ -z "$drift" ] && ok "plugin.json and marketplace entry agree" \
                  || bad "$drift"
fi

# Catches the things the CLI knows about and this script does not — bad
# component paths, unrecognised keys, malformed agent frontmatter.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate . >/dev/null 2>&1 \
    && ok "claude plugin validate" || bad "claude plugin validate failed — run it to see why"
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
missing=$(grep -rhno '\.\./\.\./workbook/[A-Za-z_-]*\.[a-z]*' --include='*.md' skills \
          | sed 's|.*\.\./\.\./|| ' | tr -d ' ' | sort -u \
          | while read -r r; do [ -f "$r" ] || echo "$r"; done)
[ -z "$missing" ] && ok "every ../../workbook/* target exists" \
                  || bad "dangling workbook reference(s): $missing"

sect "Workbook"
# Every skill can answer as a multi-tab workbook, and says so where routing
# reads it. The builder is shared, so one broken edit breaks all five skills.
for f in skills/*/SKILL.md; do
  dir=$(basename "$(dirname "$f")")
  sed -n 's/^description: //p' "$f" | grep -q 'multi-tab workbook (Read Me, Summary, detail and exception tabs) whose tabs are chosen from the question' \
    && ok "$dir  description offers the workbook" \
    || bad "$dir  description no longer says it builds the multi-tab workbook"
  grep -q '^## Excel workbook output' "$f" \
    || bad "$dir  has no \"Excel workbook output\" section to follow"
done
if command -v python3 >/dev/null 2>&1; then
  python3 -m py_compile workbook/build_workbook.py 2>/dev/null \
    && ok "workbook/build_workbook.py compiles" || bad "workbook/build_workbook.py does not compile"
  find workbook -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
  # The spec's own example must build: it is what Claude copies from.
  if python3 -c 'import openpyxl' 2>/dev/null; then
    tmp=$(mktemp -d)
    awk '/^```json$/{f=1;next} /^```$/{if(f){exit}} f' workbook/WORKBOOK-SPEC.md > "$tmp/spec.json"
    python3 workbook/build_workbook.py "$tmp/spec.json" "$tmp/out.xlsx" >/dev/null 2>"$tmp/err" \
      && ok "WORKBOOK-SPEC.md example builds" \
      || bad "WORKBOOK-SPEC.md example fails to build: $(head -1 "$tmp/err")"
    rm -rf "$tmp"
  else
    printf '  skip  openpyxl not installed — the spec example was not built\n'
  fi
fi

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
[ -f .claude-plugin/marketplace.json ] && ok "marketplace.json present" \
                                       || bad "marketplace.json missing — nothing to list"
# A directory listing is a public invitation to install. A proprietary notice
# that grants no rights at all contradicts it, and reviewers do read this file.
grep -q 'licence to download, install and use' LICENSE \
  && ok "LICENSE grants installation" \
  || bad "LICENSE no longer grants installation — it cannot be listed publicly"
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
