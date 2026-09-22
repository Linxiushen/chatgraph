#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
plutil -lint ChatGraph.xcodeproj/project.pbxproj ChatGraph/Info.plist \
  ChatGraphShare/Info.plist Shared/AppGroups.entitlements Shared/PrivacyInfo.xcprivacy
swiftc -frontend -parse ChatGraph/ChatGraphApp.swift ChatGraph/WorkspaceModel.swift \
  Shared/PendingShare.swift Shared/WorkspaceConfiguration.swift ChatGraphShare/ShareViewController.swift
validation_dir="$(mktemp -d)"
trap 'rm -rf "$validation_dir"' EXIT
swiftc Shared/PendingShare.swift Shared/WorkspaceConfiguration.swift scripts/check-validation.swift -o "$validation_dir/check-validation"
"$validation_dir/check-validation"
swiftc Shared/WorkspaceConfiguration.swift scripts/normalize-workspace.swift -o "$validation_dir/normalize-workspace"
CHATGRAPH_DEFAULT_WORKSPACE_URL='https://EXAMPLE.com:443/' "$validation_dir/normalize-workspace" | diff - <(printf 'example.com\n')
CHATGRAPH_DEFAULT_WORKSPACE_URL='' "$validation_dir/normalize-workspace" | diff - <(printf '\n')
if CHATGRAPH_DEFAULT_WORKSPACE_URL='https://user:private@example.com' "$validation_dir/normalize-workspace" >"$validation_dir/rejected" 2>&1; then
  echo 'Invalid build workspace was accepted.' >&2; exit 1
fi
if /usr/bin/grep -q 'private' "$validation_dir/rejected"; then
  echo 'Build validator echoed credentials.' >&2; exit 1
fi
