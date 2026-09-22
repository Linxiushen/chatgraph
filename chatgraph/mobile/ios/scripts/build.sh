#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

default_workspace_arguments=()
if [[ "${CHATGRAPH_DEFAULT_WORKSPACE_URL+x}" == x ]]; then
  validation_dir="$(mktemp -d)"
  trap 'rm -rf "$validation_dir"' EXIT
  swiftc Shared/WorkspaceConfiguration.swift scripts/normalize-workspace.swift -o "$validation_dir/normalize-workspace"
  default_workspace_authority="$("$validation_dir/normalize-workspace")"
  default_workspace_arguments+=("CHATGRAPH_DEFAULT_WORKSPACE_AUTHORITY=$default_workspace_authority")
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "需要安装完整 Xcode，并运行 sudo xcode-select -s /Applications/Xcode.app/Contents/Developer。" >&2
  exit 1
fi

mode="${1:-unsigned}"
arguments=(-project ChatGraph.xcodeproj -scheme ChatGraph -configuration Release)
if [[ ${#default_workspace_arguments[@]} -gt 0 ]]; then arguments+=("${default_workspace_arguments[@]}"); fi
if [[ -n "${IOS_BUNDLE_ID:-}" ]]; then arguments+=("APP_BUNDLE_IDENTIFIER=$IOS_BUNDLE_ID"); fi
if [[ -n "${IOS_APP_GROUP_ID:-}" ]]; then arguments+=("APP_GROUP_IDENTIFIER=$IOS_APP_GROUP_ID"); fi
if [[ -n "${IOS_TEAM_ID:-}" ]]; then arguments+=("DEVELOPMENT_TEAM=$IOS_TEAM_ID"); fi

case "$mode" in
  unsigned)
    xcodebuild "${arguments[@]}" -sdk iphoneos -destination 'generic/platform=iOS' \
      -derivedDataPath build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
    mkdir -p build/unsigned/Payload
    ditto build/Build/Products/Release-iphoneos/ChatGraph.app build/unsigned/Payload/ChatGraph.app
    (cd build/unsigned && ditto -c -k --keepParent Payload ../ChatGraph-unsigned.ipa)
    echo "已生成 build/ChatGraph-unsigned.ipa。此文件未签名，不能直接安装到 iPhone。"
    ;;
  simulator)
    xcodebuild "${arguments[@]}" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath build-simulator CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
    echo "模拟器 App：build-simulator/Build/Products/Release-iphonesimulator/ChatGraph.app"
    ;;
  archive)
    xcodebuild "${arguments[@]}" -destination 'generic/platform=iOS' -archivePath build/ChatGraph.xcarchive \
      -allowProvisioningUpdates archive
    echo "已生成 build/ChatGraph.xcarchive；使用 Xcode Organizer 或本脚本 export 分发。"
    ;;
  export)
    if [[ ! -f ExportOptions.local.plist ]]; then
      echo "先复制 ExportOptions.template.plist 为 ExportOptions.local.plist，并填写你的 Apple Team ID。" >&2
      exit 1
    fi
    xcodebuild -exportArchive -archivePath build/ChatGraph.xcarchive \
      -exportPath build/export -exportOptionsPlist ExportOptions.local.plist -allowProvisioningUpdates
    ;;
  *) echo "用法：bash scripts/build.sh unsigned|simulator|archive|export" >&2; exit 2 ;;
esac
