import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createZip } from '../lib/zip.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')).version;
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--android-apk', '--ios-ipa', '--output'].includes(key) || !value || options.has(key)) throw new Error('用法：node package-native.mjs --android-apk <已验证的测试 APK> --ios-ipa <未签名 IPA> [--output <目录>]');
  options.set(key, path.resolve(value));
}
if (!options.has('--android-apk') || !options.has('--ios-ipa')) throw new Error('必须提供已构建的 Android APK 和未签名 iOS IPA，不能把只有源码的 ZIP 当成 App 安装包。');
const output = options.get('--output') || path.join(project, 'test-output', 'releases');
const forbidden = new Set(['build', 'build-simulator', '.gradle', '.git', '.DS_Store', 'local.properties', 'signing.properties', 'keystore.properties', 'ExportOptions.local.plist', 'Configuration.local.xcconfig', 'xcuserdata', 'native-artifacts', 'node_modules', 'test-output', 'dist']);
const extensions = new Set(['.md', '.txt', '.png', '.java', '.gradle', '.properties', '.xml', '.bat', '.sh', '.swift', '.plist', '.pbxproj', '.xcscheme', '.xcworkspacedata', '.xcconfig', '.entitlements', '.xcprivacy', '.json', '.py']);
const special = new Set(['.gitignore', 'gradlew', 'gradle-wrapper.jar', 'GRADLE-LICENSE', 'LICENSE']);

async function filesFor(platform) {
  const root = path.join(project, 'mobile', platform);
  const entries = [];
  async function walk(relative = '') {
    const current = path.join(root, relative);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('原生发布源不允许符号链接：' + relative);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(current)).sort()) {
        if (forbidden.has(name) || (name.startsWith('.') && name !== '.gitignore')) continue;
        await walk(path.join(relative, name));
      }
    } else if (stat.isFile() && (special.has(path.basename(relative)) || extensions.has(path.extname(relative)))) {
      if (stat.size > 8 * 1024 * 1024) throw new Error('原生源文件异常过大：' + relative);
      entries.push(['source/' + relative.split(path.sep).join('/'), await fs.readFile(current)]);
    }
  }
  await walk();
  const required = platform === 'android'
    ? ['source/app/src/main/AndroidManifest.xml', 'source/app/src/main/java/app/chatgraph/mobile/MainActivity.java', 'source/gradle/wrapper/gradle-wrapper.jar', 'source/gradlew', 'source/settings.gradle', 'source/README.md']
    : ['source/ChatGraph.xcodeproj/project.pbxproj', 'source/Configuration.xcconfig', 'source/ChatGraph/ChatGraphApp.swift', 'source/ChatGraphShare/ShareViewController.swift', 'source/Shared/AppGroups.entitlements', 'source/README.md'];
  for (const name of required) if (!entries.some(([entry]) => entry === name)) throw new Error('原生源码包缺少必要文件：' + name);
  return entries;
}
async function readBinary(filename, kind) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1000 || stat.size > 150 * 1024 * 1024) throw new Error('原生二进制文件不符合发布要求。');
  const names = execFileSync('unzip', ['-Z1', filename], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }).split('\n');
  if (kind === 'android' && (!names.includes('AndroidManifest.xml') || !names.includes('classes.dex'))) throw new Error('输入不是已编译的 Android APK。');
  if (kind === 'ios' && (!names.includes('Payload/ChatGraph.app/Info.plist') || !names.includes('Payload/ChatGraph.app/ChatGraph'))) throw new Error('输入不是已编译的 ChatGraph iOS IPA。');
  if (kind === 'ios' && names.some(name => name.endsWith('embedded.mobileprovision'))) throw new Error('本脚本只发布未签名 IPA，不能意外包含个人描述文件。');
  return fs.readFile(filename);
}
await fs.mkdir(output, { recursive: true });
for (const platform of ['android', 'ios']) {
  const entries = await filesFor(platform);
  const android = platform === 'android';
  const binaryName = android ? `ChatGraph-android-${version}-debug.apk` : `ChatGraph-ios-${version}-unsigned.ipa`;
  entries.push([binaryName, await readBinary(options.get(android ? '--android-apk' : '--ios-ipa'), platform)]);
  entries.push(['LICENSE', await fs.readFile(path.join(project, 'LICENSE'))]);
  const instructions = android
    ? `# ChatGraph Android ${version}\n\n解压后，在安卓手机打开 ${binaryName}，按系统提示允许本次安装。这是 debug 测试签名 APK，不是商店正式版。不同构建的签名可能不同；已安装旧版时，可在原 App 中填写可用工作区地址，不必为了连接服务器重装。不要为处理签名冲突直接卸载，卸载会删除本机数据。\n\n若发布者已预置工作区，首页直接点“打开工作区”并登录；未预置时点“连接工作区”，填写真实已部署、手机可访问的 HTTPS 根地址。更换入口在“更换工作区 / 设置”中操作。该 App 接收其他 App 主动分享的文字/文件，不会读取它们的私有聊天数据库。模型 Key 留在服务器。\n\n本包附完整 Android 工程；重新构建请进入 source，运行 bash ./gradlew :app:assembleDebug :app:lintDebug。安装、数据保留与限制见 source/README.md。\n`
    : `# ChatGraph iOS ${version}\n\n本包包含已编译但未签名的 ${binaryName} 和完整 Xcode 工程。**这个 IPA 不能直接点开安装到普通 iPhone。** 需要使用自己的 Apple 开发者身份、Bundle ID 和 App Group 完成签名，或通过 TestFlight 分发。\n\n在有 Xcode 的 Mac 上打开 source/ChatGraph.xcodeproj，按 source/README.md 配置两个 target 的签名与 App Group，再运行或 Archive。测试机的 App Group 权限需由自己的开发者账号提供。\n\n若发布者已预置工作区，首页直接点“打开工作区”并登录；未预置时点“连接工作区”，填写真实已部署、手机可访问的 HTTPS 根地址。更换入口在“更换工作区”中操作。分享扩展接收原应用实际提供的文字/文件，保存后手动打开 ChatGraph 继续导入。包内没有模型 Key 或个人签名证书。\n`;
  entries.push(['先读我.md', instructions + `\n手机不能直接访问电脑的 localhost。安装包和 ZIP 不会自动提供或部署一个可用服务器；预设入口也只是一条公开地址，服务仍需部署者运行维护。部署说明：https://github.com/Linxiushen/chatgraph/blob/chatgraph-v${version}/chatgraph/deploy/README.md\n\n已有工作区地址优先于新安装包的预设值；忘记工作区后不会自动恢复预设地址。登录密码仅在工作区页面填写。打开 App 不会自动上传收件内容或调用 AI。\n\n构建与静态检查不等于真机验收。请先用非敏感样例验证系统分享、登录和图谱生成。\n`]);
  const sums = entries.map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}`).sort().join('\n');
  entries.push(['SHA256SUMS', sums + '\n']);
  const archive = createZip(entries.sort(([a], [b]) => a.localeCompare(b)));
  const filename = `ChatGraph-${platform === 'android' ? 'Android' : 'iOS'}-${version}.zip`;
  await fs.writeFile(path.join(output, filename), archive);
  const digest = createHash('sha256').update(archive).digest('hex');
  await fs.writeFile(path.join(output, filename + '.sha256'), `${digest}  ${filename}\n`);
  console.log(JSON.stringify({ platform, file: path.join(output, filename), sha256: digest, bytes: archive.length, binary: binaryName, distributionSigning: android ? 'debug-test-only' : 'unsigned' }));
}
