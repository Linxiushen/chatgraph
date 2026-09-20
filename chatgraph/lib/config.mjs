import { readFileSync } from 'node:fs';

/** Only load the app's explicit private settings; never evaluate shell expressions. */
export function loadPrivateConfig(filename, env = process.env) {
  let text;
  try { text = readFileSync(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return env; throw error; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(CHATGRAPH_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}
