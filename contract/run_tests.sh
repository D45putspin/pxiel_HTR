#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

run_pytest() {
  if command -v pytest >/dev/null 2>&1; then
    PYTHONPATH="$ROOT_DIR" pytest contract/test_pixel_place.py
    return 0
  fi
  return 1
}

run_unittest() {
  PYTHONPATH="$ROOT_DIR" python3 -m unittest contract.test_pixel_place
}

echo "==> Running contract tests"
if ! run_pytest; then
  echo "pytest not available; falling back to python unittest"
  run_unittest
fi
