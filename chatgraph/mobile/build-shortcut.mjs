import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildShortcut() {
  const extractor = await readFile(new URL('../extension/extractor.js', import.meta.url), 'utf8');
  if (!extractor.includes('globalThis.ChatGraphCapture =')) throw new Error('The shared capture adapter has changed; update the Shortcut wrapper.');
  return `/* ChatGraph Safari Shortcut — generated; edit build-shortcut.mjs or extension/extractor.js.
 * Paste this entire file into Shortcuts: Run JavaScript on Web Page.
 * Input must be a Safari Web Page. Output is conversation JSON text.
 * Runs only on this page, without network requests or account/session access.
 */
(() => {
  let shortcutCapture;
${extractor.replace('globalThis.ChatGraphCapture =', 'shortcutCapture =')}
  const capture = shortcutCapture.extractDocument(document, location.href);
  completion(JSON.stringify(capture, null, 2));
})();
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL('./safari-shortcut.js', import.meta.url);
  const content = await buildShortcut();
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== content) throw new Error('Run node chatgraph/mobile/build-shortcut.mjs to update the Safari capture script.');
    console.log('Safari Shortcut matches the shared capture adapter.');
  } else { await writeFile(output, content); console.log(fileURLToPath(output)); }
}
