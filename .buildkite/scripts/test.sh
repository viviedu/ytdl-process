#!/bin/bash
set -euo pipefail

echo "--- :lint-roller: lint"
pnpm lint

echo "--- :jest: test"
pnpm jest

echo "--- :python: unittest"
uv run python -m unittest discover -s tests -p 'test_*.py' -v
