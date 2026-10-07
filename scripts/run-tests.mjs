import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const tests=(await readdir('tests')).filter(f=>f.endsWith('.test.mjs')).sort();
let failed=0;
for(let offset=0;offset<tests.length;offset+=4){
  const results=await Promise.all(tests.slice(offset,offset+4).map(test=>new Promise(resolve=>{
    const child=spawn(process.execPath,['tests/'+test]);let output='';
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    child.on('error',error=>resolve({test,code:1,output:error.message}));
    child.on('close',code=>resolve({test,code,output}));
  })));
  for(const result of results){
    console.log(`${result.code===0?'PASS':'FAIL'} ${result.test}`);
    if(result.code!==0){failed++;process.stderr.write(result.output);}
  }
}
console.log(`${tests.length} suites; ${failed} failed`);
if(failed)process.exit(1);
