#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"
./gradlew :app:assembleDebug
PACKAGE_DIR="$PROJECT_DIR/app/build/distribution"
mkdir -p "$PACKAGE_DIR"
cp app/build/outputs/apk/debug/app-debug.apk "$PACKAGE_DIR/ChatGraph-android-0.4.1-beta.1-debug.apk"
cp README.md "$PACKAGE_DIR/README.md"
cd "$PACKAGE_DIR"
zip -9 ChatGraph-android-0.4.1-beta.1.zip ChatGraph-android-0.4.1-beta.1-debug.apk README.md
