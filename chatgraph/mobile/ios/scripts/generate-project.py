#!/usr/bin/env python3
"""Deterministic Xcode project generation using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import plistlib
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
objects = {}

def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def add(object_name, isa, **values):
    key = identifier(object_name)
    objects[key] = dict(isa=isa, **values)
    return key

def plist(path, value):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(plistlib.dumps(value, sort_keys=False))

common_info = {
    "CFBundleDisplayName": "ChatGraph", "CFBundleExecutable": "$(EXECUTABLE_NAME)",
    "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)", "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": "$(PRODUCT_NAME)", "CFBundleShortVersionString": "$(MARKETING_VERSION)",
    "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)", "ChatGraphAppGroup": "$(APP_GROUP_IDENTIFIER)",
}
plist("ChatGraph/Info.plist", {
    **common_info, "CFBundlePackageType": "APPL", "LSRequiresIPhoneOS": True,
    "ChatGraphDefaultWorkspaceURL": "https://$(CHATGRAPH_DEFAULT_WORKSPACE_AUTHORITY)",
    "UILaunchScreen": {},
    "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
    "UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
    "LSSupportsOpeningDocumentsInPlace": True,
    "CFBundleDocumentTypes": [{"CFBundleTypeName": "Conversation", "CFBundleTypeRole": "Viewer", "LSHandlerRank": "Alternate", "LSItemContentTypes": ["public.plain-text", "public.json", "net.daringfireball.markdown"]}],
    "UTImportedTypeDeclarations": [{"UTTypeIdentifier": "net.daringfireball.markdown", "UTTypeDescription": "Markdown", "UTTypeConformsTo": ["public.plain-text"], "UTTypeTagSpecification": {"public.filename-extension": ["md", "markdown"], "public.mime-type": "text/markdown"}}],
})
plist("ChatGraphShare/Info.plist", {
    **common_info, "CFBundlePackageType": "XPC!",
    "NSExtension": {
        "NSExtensionPointIdentifier": "com.apple.share-services",
        "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).ShareViewController",
        "NSExtensionAttributes": {"NSExtensionActivationRule": {
            "NSExtensionActivationSupportsText": True,
            "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
            "NSExtensionActivationSupportsFileWithMaxCount": 1,
        }},
    },
})
plist("Shared/AppGroups.entitlements", {"com.apple.security.application-groups": ["$(APP_GROUP_IDENTIFIER)"]})
plist("Shared/PrivacyInfo.xcprivacy", {
    "NSPrivacyTracking": False, "NSPrivacyTrackingDomains": [], "NSPrivacyCollectedDataTypes": [],
    "NSPrivacyAccessedAPITypes": [{"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]}],
})
plist("ExportOptions.template.plist", {"method": "app-store-connect", "signingStyle": "automatic", "teamID": "REPLACE_WITH_TEAM_ID", "uploadSymbols": True})

app_sources = ["ChatGraph/ChatGraphApp.swift", "ChatGraph/WorkspaceModel.swift", "Shared/PendingShare.swift", "Shared/WorkspaceConfiguration.swift"]
extension_sources = ["ChatGraphShare/ShareViewController.swift", "Shared/PendingShare.swift"]
paths = list(dict.fromkeys(app_sources + extension_sources + ["ChatGraph/Assets.xcassets", "Shared/PrivacyInfo.xcprivacy", "ChatGraph/Info.plist", "ChatGraphShare/Info.plist", "Shared/AppGroups.entitlements", "Configuration.xcconfig"]))
file_refs = {}
for path in paths:
    extension = Path(path).suffix
    file_type = {".swift": "sourcecode.swift", ".xcassets": "folder.assetcatalog", ".xcprivacy": "text.xml", ".plist": "text.plist.xml", ".entitlements": "text.plist.entitlements", ".xcconfig": "text.xcconfig"}[extension]
    file_refs[path] = add("file:" + path, "PBXFileReference", lastKnownFileType=file_type, path=path, sourceTree="<group>")
app_product = add("product:app", "PBXFileReference", explicitFileType="wrapper.application", includeInIndex="0", path="ChatGraph.app", sourceTree="BUILT_PRODUCTS_DIR")
ext_product = add("product:extension", "PBXFileReference", explicitFileType="wrapper.app-extension", includeInIndex="0", path="ChatGraphShare.appex", sourceTree="BUILT_PRODUCTS_DIR")
product_group = add("products", "PBXGroup", children=[app_product, ext_product], name="Products", sourceTree="<group>")
main_group = add("main", "PBXGroup", children=list(file_refs.values()) + [product_group], sourceTree="<group>")

def phase(name, isa, files):
    return add(name, isa, buildActionMask="2147483647", files=files, runOnlyForDeploymentPostprocessing="0")

def build_files(target, paths):
    return [add("build:" + target + ":" + path, "PBXBuildFile", fileRef=file_refs[path]) for path in paths]

app_phases = [phase("app:sources", "PBXSourcesBuildPhase", build_files("app", app_sources)), phase("app:frameworks", "PBXFrameworksBuildPhase", []), phase("app:resources", "PBXResourcesBuildPhase", build_files("app", ["ChatGraph/Assets.xcassets", "Shared/PrivacyInfo.xcprivacy"]))]
ext_phases = [phase("ext:sources", "PBXSourcesBuildPhase", build_files("ext", extension_sources)), phase("ext:frameworks", "PBXFrameworksBuildPhase", []), phase("ext:resources", "PBXResourcesBuildPhase", build_files("ext", ["Shared/PrivacyInfo.xcprivacy"]))]
embedded = add("embed:extension", "PBXBuildFile", fileRef=ext_product, settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
app_phases.append(add("embed:phase", "PBXCopyFilesBuildPhase", buildActionMask="2147483647", dstPath="", dstSubfolderSpec="13", files=[embedded], name="Embed App Extensions", runOnlyForDeploymentPostprocessing="0"))

def configurations(name, settings):
    entries = []
    for configuration in ("Debug", "Release"):
        adjusted = dict(settings)
        adjusted.update({"SWIFT_OPTIMIZATION_LEVEL": "-Onone" if configuration == "Debug" else "-O", "DEBUG_INFORMATION_FORMAT": "dwarf" if configuration == "Debug" else "dwarf-with-dsym"})
        if configuration == "Debug": adjusted["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG $(inherited)"
        entries.append(add(name + ":" + configuration, "XCBuildConfiguration", baseConfigurationReference=file_refs["Configuration.xcconfig"], buildSettings=adjusted, name=configuration))
    return add(name + ":configurations", "XCConfigurationList", buildConfigurations=entries, defaultConfigurationIsVisible="0", defaultConfigurationName="Release")

common_settings = {"CLANG_ENABLE_MODULES": "YES", "CODE_SIGN_ENTITLEMENTS": "Shared/AppGroups.entitlements", "GENERATE_INFOPLIST_FILE": "NO", "PRODUCT_NAME": "$(TARGET_NAME)", "SDKROOT": "iphoneos", "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator", "SUPPORTS_MACCATALYST": "NO", "SWIFT_EMIT_LOC_STRINGS": "YES"}
app_config = configurations("app", {**common_settings, "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "INFOPLIST_FILE": "ChatGraph/Info.plist", "PRODUCT_BUNDLE_IDENTIFIER": "$(APP_BUNDLE_IDENTIFIER)", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"], "SKIP_INSTALL": "NO"})
ext_config = configurations("extension", {**common_settings, "APPLICATION_EXTENSION_API_ONLY": "YES", "INFOPLIST_FILE": "ChatGraphShare/Info.plist", "PRODUCT_BUNDLE_IDENTIFIER": "$(APP_BUNDLE_IDENTIFIER).share", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"], "SKIP_INSTALL": "YES"})
project_config = configurations("project", {"CLANG_ENABLE_OBJC_ARC": "YES", "CLANG_WARN_DOCUMENTATION_COMMENTS": "YES", "GCC_C_LANGUAGE_STANDARD": "gnu17", "ENABLE_STRICT_OBJC_MSGSEND": "YES", "SWIFT_COMPILATION_MODE": "wholemodule"})
extension_target = add("target:extension", "PBXNativeTarget", buildConfigurationList=ext_config, buildPhases=ext_phases, buildRules=[], dependencies=[], name="ChatGraphShare", productName="ChatGraphShare", productReference=ext_product, productType="com.apple.product-type.app-extension")
proxy = add("extension:proxy", "PBXContainerItemProxy", containerPortal=identifier("project"), proxyType="1", remoteGlobalIDString=extension_target, remoteInfo="ChatGraphShare")
dependency = add("extension:dependency", "PBXTargetDependency", target=extension_target, targetProxy=proxy)
app_target = add("target:app", "PBXNativeTarget", buildConfigurationList=app_config, buildPhases=app_phases, buildRules=[], dependencies=[dependency], name="ChatGraph", productName="ChatGraph", productReference=app_product, productType="com.apple.product-type.application")
project = add("project", "PBXProject", attributes={"BuildIndependentTargetsInParallel": "1", "LastSwiftUpdateCheck": "1600", "LastUpgradeCheck": "1600"}, buildConfigurationList=project_config, compatibilityVersion="Xcode 14.0", developmentRegion="zh-Hans", hasScannedForEncodings="0", knownRegions=["zh-Hans", "en", "Base"], mainGroup=main_group, productRefGroup=product_group, projectDirPath="", projectRoot="", targets=[app_target, extension_target])

def render(value, depth=0):
    indent = "\t" * depth
    if isinstance(value, dict):
        return "{\n" + "".join("\t" * (depth + 1) + json.dumps(k) + " = " + render(v, depth + 1) + ";\n" for k, v in value.items()) + indent + "}"
    if isinstance(value, list): return "(\n" + "".join("\t" * (depth + 1) + render(v, depth + 1) + ",\n" for v in value) + indent + ")"
    return json.dumps(value, ensure_ascii=False)

(ROOT / "ChatGraph.xcodeproj/project.pbxproj").write_text("// !$*UTF8*$!\n" + render({"archiveVersion": "1", "classes": {}, "objectVersion": "56", "objects": objects, "rootObject": project}) + "\n")
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_target}" BuildableName="ChatGraph.app" BlueprintName="ChatGraph" ReferencedContainer="container:ChatGraph.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_target}" BuildableName="ChatGraph.app" BlueprintName="ChatGraph" ReferencedContainer="container:ChatGraph.xcodeproj"/></BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_target}" BuildableName="ChatGraph.app" BlueprintName="ChatGraph" ReferencedContainer="container:ChatGraph.xcodeproj"/></BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(ROOT / "ChatGraph.xcodeproj/xcshareddata/xcschemes/ChatGraph.xcscheme").write_text(scheme)

# Opaque 1024px source icon, no external drawing dependency.
size = 1024
pixels = bytearray(bytes([67, 49, 137]) * size * size)
def dot(cx, cy, radius, color):
    for y in range(max(0, cy - radius), min(size, cy + radius + 1)):
        dx = int((max(0, radius * radius - (y - cy) ** 2)) ** 0.5)
        for x in range(max(0, cx - dx), min(size, cx + dx + 1)):
            position = (y * size + x) * 3
            pixels[position:position + 3] = bytes(color)
def line(a, b):
    steps = max(abs(a[0]-b[0]), abs(a[1]-b[1]))
    for step in range(steps + 1):
        fraction = step / steps
        dot(round(a[0] + (b[0] - a[0]) * fraction), round(a[1] + (b[1] - a[1]) * fraction), 21, [226, 220, 255])
points = [(280, 295), (735, 295), (510, 555), (285, 745), (750, 745)]
for first, second in [(0, 2), (1, 2), (2, 3), (2, 4)]: line(points[first], points[second])
for index, (x, y) in enumerate(points): dot(x, y, 75 if index == 2 else 59, [255, 255, 255] if index == 2 else [204, 245, 225])
def chunk(kind, payload): return struct.pack('!I', len(payload)) + kind + payload + struct.pack('!I', zlib.crc32(kind + payload) & 0xffffffff)
raw = b''.join(b'\x00' + pixels[y * size * 3:(y + 1) * size * 3] for y in range(size))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
assets = ROOT / "ChatGraph/Assets.xcassets"
(assets / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
(assets / "AppIcon.appiconset/AppIcon.png").write_bytes(png)
(assets / "AppIcon.appiconset/Contents.json").write_text(json.dumps({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
print("Generated ChatGraph.xcodeproj, plists, shared scheme and icon.")
