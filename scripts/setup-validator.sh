#!/usr/bin/env bash
# Installs the official SMART Health Cards validator (smart-on-fhir/health-cards-dev-tools,
# formerly health-cards-validation-SDK). It is not on npm, so it is built from GitHub
# into tools/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=tools/health-cards-dev-tools
if [ ! -d "$DIR" ]; then
  mkdir -p tools
  git clone --depth 1 -b main https://github.com/smart-on-fhir/health-cards-dev-tools.git "$DIR"
fi
cd "$DIR"
npm install --no-audit --no-fund
