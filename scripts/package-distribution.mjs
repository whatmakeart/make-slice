import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {zipSync} from 'fflate';
const source=fileURLToPath(new URL('../',import.meta.url)),app=dirname(source),workspace=dirname(app);
await mkdir(join(app,'dist'),{recursive:true});
for(const name of ['index.html','app.js','app.css'])await copyFile(join(source,'dist',name),join(app,'dist',name));
await copyFile(join(source,'public/favicon.svg'),join(app,'dist/favicon.svg'));
await copyFile(join(source,'public/favicon.svg'),join(app,'favicon.svg'));
await copyFile(join(source,'public/favicon.png'),join(app,'dist/favicon.png'));
await copyFile(join(source,'public/favicon.png'),join(app,'favicon.png'));
await copyFile(join(source,'dist/index.html'),join(app,'index.html'));
await copyFile(join(source,'README.md'),join(app,'README.md'));
const files={};
const excluded=new Set(['node_modules','.git','.sites-runtime','.browser-runtime','__pycache__','.checkpoints','.openai']);
async function collect(directory,relative=''){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(excluded.has(entry.name)||entry.name.endsWith('.tsbuildinfo')||entry.name.endsWith('.pyc')||relative==='source'&&entry.name==='dist')continue;
  const next=relative?relative+'/'+entry.name:entry.name,path=join(directory,entry.name);
  if(entry.isDirectory())await collect(path,next);
  else if(entry.isFile())files['slice-lab/'+next]=new Uint8Array(await readFile(path));
 }
}
await collect(app);
const bytes=zipSync(files,{level:6}),output=resolve(workspace,'slice-lab-web-code(1).zip');
await writeFile(output,bytes);
console.log(JSON.stringify({file:output,files:Object.keys(files).length,bytes:bytes.length}));
