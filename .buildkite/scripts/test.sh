#!/bin/bash
set -euo pipefail

echo "--- :lint-roller: lint"
yarn lint

echo "--- :jest: test"
yarn lint
