#!/bin/sh
set -eu
case_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$case_dir/../../../.." && pwd)
mkdir -p "$case_dir/output"
cd "$repo_root"
if pnpm clocky --profile headless "$(cat "$case_dir/PROMPT.txt")" > "$case_dir/output/agent.log" 2>&1; then
  cat "$case_dir/output/agent.log"
else
  cat "$case_dir/output/agent.log"
  exit 1
fi
