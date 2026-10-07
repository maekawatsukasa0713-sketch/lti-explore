import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {isPublicIp,publicTarget,createPublicFetcher,validImage,imageTypes} from '../server/public-fetch.js';
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','::ffff:7f00:1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::','fd00::1'])assert.equal(isPublicIp(ip),false,ip);
for(const ip of ['8.8.8.8','1.1.1.1','2606:4700::1111'])assert.equal(isPublicIp(ip),true,ip);
for(const url of ['http://2130706433','http://0x7f000001','http://[::ffff:127.0.0.1]/','file:///etc/passwd','http://localhost','http://a.localhost/','https://name:pass@example.com','http://example.com:8080'])await assert.rejects(()=>publicTarget(url));
await assert.rejects(()=>publicTarget('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
let lookups=0,calls=0,pinned;
const resolve=async()=>{lookups++;return [{address:'2606:4700::1111',family:6},{address:'8.8.8.8',family:4}];};
function sendWith(body,headers={},status=200){return (url,options,callback)=>{
 calls++;options.lookup(url.hostname,{},(_error,ip)=>pinned=ip);
 const req=new EventEmitter();options.signal.addEventListener('abort',()=>req.emit('error',options.signal.reason),{once:true});
 req.end=()=>queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers=headers;callback(response);if(body!==null)response.end(body);});
 return req;
};}
const fetcher=createPublicFetcher({resolve,send:sendWith('ok',{'content-type':'text/html'}),timeoutMs:50});
assert.equal((await fetcher('https://example.com')).body.toString(),'ok');assert.equal(lookups,1);assert.equal(pinned,'8.8.8.8');
calls=0;
await assert.rejects(()=>createPublicFetcher({resolve,send:sendWith('',{location:'http://169.254.169.254/latest/meta-data'},302)})('https://example.com'));assert.equal(calls,1);
await assert.rejects(()=>createPublicFetcher({resolve,send:sendWith('12345')})('https://example.com',{maxBytes:4}),/too large/);
await assert.rejects(()=>createPublicFetcher({resolve,send:sendWith(null),timeoutMs:20})('https://example.com'),/timed out/);
await assert.rejects(()=>createPublicFetcher({resolve:()=>new Promise(()=>{}),timeoutMs:20})('https://example.com'),/timed out/);
const svg=await createPublicFetcher({resolve,send:sendWith('<svg/>',{'content-type':'image/svg+xml'})})('https://example.com',{allowedTypes:imageTypes});assert.equal(svg.body.length,0);
assert.equal(validImage(Buffer.from('<svg/>'),'image/png'),false);
assert.equal(validImage(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true);
console.log('PASS: public IP/DNS pinning, redirects, size/body/DNS deadlines and raster validation');
