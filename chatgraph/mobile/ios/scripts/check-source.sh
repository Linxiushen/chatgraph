#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
plutil -lint ChatGraph.xcodeproj/project.pbxproj ChatGraph/Info.plist \
  ChatGraphShare/Info.plist Shared/AppGroups.entitlements Shared/PrivacyInfo.xcprivacy
swiftc -frontend -parse ChatGraph/ChatGraphApp.swift ChatGraph/WorkspaceModel.swift \
  Shared/PendingShare.swift ChatGraphShare/ShareViewController.swift
validation_dir="$(mktemp -d)"
trap 'rm -rf "$validation_dir"' EXIT
swiftc Shared/PendingShare.swift scripts/check-validation.swift -o "$validation_dir/check-validation"
"$validation_dir/check-validation"
