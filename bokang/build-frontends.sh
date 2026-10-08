#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_API_BASE_URL="" VITE_API_BASE_PATH="/api"
export VITE_ADMIN_BASE_URL="" VITE_ADMIN_BASE_PATH="/god-mode"
export VITE_SPACE_BASE_URL="" VITE_SPACE_BASE_PATH="/spaces"
export VITE_LIVE_BASE_URL="" VITE_LIVE_BASE_PATH="/live"
export VITE_WEB_BASE_URL="" VITE_WEB_BASE_PATH=""
export VITE_WEBSITE_URL="" VITE_SUPPORT_EMAIL=""
for package in constants utils ui editor; do
 (cd "packages/$package" && ./node_modules/.bin/tsdown) > "/tmp/bokang-$package-release-build.log" 2>&1
done
pids=()
for app in web admin space; do
 (cd "apps/$app" && ./node_modules/.bin/react-router build) > "/tmp/bokang-$app-release-build.log" 2>&1 &
 pids+=("$!")
done
failed=0
for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
exit "$failed"
