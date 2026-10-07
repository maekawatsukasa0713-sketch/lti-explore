import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {transform} from 'esbuild';
const source=await readFile(new URL('../supabase-config.ts',import.meta.url),'utf8');
const js=(await transform(source,{loader:'ts',format:'iife',globalName:'Config',define:{'import.meta.env':'{}'}})).code;
for(const [origin,production] of [['https://explore.labtoimpact.com',true],['https://lti-explore-six.vercel.app',true],['https://preview.example',false],['http://localhost:5173',false]]){
 const context=vm.createContext({window:{location:new URL(origin)},URL});vm.runInContext(js,context);
 assert.equal(context.Config.IS_PRODUCTION,production);
 assert.equal(context.Config.PASSWORD_RECOVERY_URL,(production?'https://explore.labtoimpact.com':origin)+'/?flow=recovery');
}
console.log('PASS: production recovery uses public domain; previews remain isolated');
