import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory=fileURLToPath(new URL('./',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
const destination=process.argv[2]?resolve(process.argv[2]):fileURLToPath(new URL(`../test-output/chatgraph-extension-${manifest.version}.zip`,import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'chatgraph-extension-'));
try{
  const archive=join(temporary,'extension.zip');
  const files=['manifest.json','extractor.js','destination.js','popup.html','popup.css','popup.js','README.md'].map(file=>join(directory,file));
  files.push(fileURLToPath(new URL('../LICENSE',import.meta.url)));
  const result=spawnSync('zip',['-q','-j',archive,...files],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.error?.message||result.stderr||'需要系统 zip 命令完成打包。');
  await mkdir(dirname(destination),{recursive:true});await rename(archive,destination);
  process.stdout.write(`${destination}\n`);
}finally{await rm(temporary,{recursive:true,force:true});}
