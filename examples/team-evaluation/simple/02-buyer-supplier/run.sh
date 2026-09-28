#!/bin/sh
set -eu
case_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$case_dir/../../../.." && pwd)
mkdir -p "$case_dir/output"
cd "$repo_root"
pnpm run test:snapshot examples/simulation-company/tests/company.snapshot.ts -t 'sqlite simulation company runs model procurement with crash=undefined' > "$case_dir/output/vitest.log" 2>&1 || { cat "$case_dir/output/vitest.log"; exit 1; }
grep -Eq 'Tests[[:space:]]+1 passed' "$case_dir/output/vitest.log" || { cat "$case_dir/output/vitest.log"; exit 1; }
cat "$case_dir/output/vitest.log"
