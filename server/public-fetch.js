import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import net from 'node:net';

export function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Reject mapped IPv4, NAT64, local addresses and translation tunnels.
  if (!net.isIPv6(ip) || !/^[23][0-9a-f]{3}:/i.test(ip)) return false;
  const lower = ip.toLowerCase();
  const second = parseInt(lower.split(':')[1] || '0',16);
  return !/^(?:2002|3ffe|3fff):/.test(lower) &&
    !(lower.startsWith('2001:') && (second < 0x200 || second === 0xdb8));
}

export async function publicTarget(raw, resolve = dnsLookup) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('invalid URL');
  const url = new URL(raw);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw new Error('unsupported URL');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host');
  const family = net.isIP(host);
  const addresses = family ? [{address:host,family}] : await resolve(host,{all:true,verbatim:true});
  if (!addresses.length || addresses.some(r => !isPublicIp(r.address))) throw new Error('private target');
  return {url,address:addresses.find(r=>r.family===4)||addresses[0]};
}

const request = (url,options,callback) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url,options,callback);

export function createPublicFetcher({resolve=dnsLookup,send=request,timeoutMs=7000,maxRedirects=3}={}) {
  return async (raw,{accept='*/*',maxBytes=1024*1024,allowedTypes}={}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('preview timed out')),timeoutMs);
    const aborted = new Promise((_,reject) => controller.signal.addEventListener('abort',() => reject(controller.signal.reason),{once:true}));
    try {
      let current = raw;
      for (let redirects=0;redirects<=maxRedirects;redirects++) {
        const {url,address} = await Promise.race([publicTarget(current,resolve),aborted]);
        const result = await new Promise((resolveResponse,reject) => {
          const req = send(url,{
            method:'GET',agent:false,autoSelectFamily:false,signal:controller.signal,
            // Keep Host/TLS name; connect only to the IP validated above.
            lookup:(_host,options,callback) => options.all
              ? callback(null,[address]) : callback(null,address.address,address.family),
            headers:{'user-agent':'LTI-Explore-LinkPreview/1.0','accept':accept,'accept-encoding':'identity'},
          },response => {
            const status = response.statusCode || 502;
            const headers = new Headers();
            for (const [name,value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name,Array.isArray(value) ? value.join(', ') : value);
            response.on('error',reject);
            if ([301,302,303,307,308].includes(status) ||
                (allowedTypes && !allowedTypes.has((headers.get('content-type')||'').split(';')[0].trim().toLowerCase()))) {
              response.destroy();
              resolveResponse({status,headers,body:Buffer.alloc(0)});
              return;
            }
            if (Number(headers.get('content-length')) > maxBytes) {
              response.destroy(new Error('response too large'));return;
            }
            const chunks=[]; let size=0;
            response.on('data',chunk => {
              size+=chunk.length;
              if (size > maxBytes) {response.destroy(new Error('response too large'));return;}
              chunks.push(chunk);
            });
            response.on('end',() => resolveResponse({status,headers,body:Buffer.concat(chunks)}));
          });
          req.on('error',reject);req.end();
        });
        if (![301,302,303,307,308].includes(result.status)) return {...result,ok:result.status>=200&&result.status<300,finalUrl:url.toString()};
        const location=result.headers.get('location');
        if (!location) throw new Error('invalid redirect');
        current=new URL(location,url).toString();
      }
      throw new Error('too many redirects');
    } finally {clearTimeout(timer);}
  };
}

export const publicFetch=createPublicFetcher();
export const imageTypes=new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif']);
export function validImage(body,type) {
  if (type==='image/png') return body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type==='image/jpeg') return body.length>=3&&body[0]===255&&body[1]===216&&body[2]===255;
  if (type==='image/gif') return /^GIF8[79]a$/.test(body.subarray(0,6).toString());
  if (type==='image/webp') return body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP';
  if (type==='image/avif') return body.subarray(4,8).toString()==='ftyp'&&/avif|avis/.test(body.subarray(8,32).toString());
  return false;
}
