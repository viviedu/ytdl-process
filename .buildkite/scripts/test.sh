#!/bin/bash
set -euo pipefail

echo "--- :lint-roller: lint"
pnpm lint

echo "--- :jest: test"
pnpm jest
