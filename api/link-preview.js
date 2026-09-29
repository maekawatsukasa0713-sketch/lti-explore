import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('fe80:') || lower === '::' ||
    lower.startsWith('2001:db8:');
}

async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  if (url.username || url.password) throw new Error('credentials not allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private ip');
  } else {
    const records = await lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(r => isPrivateIp(r.address))) throw new Error('private dns target');
  }
  return url;
}

async function safeFetch(raw, options = {}) {
  let current = await assertPublicUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(current, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'LTI-Explore-LinkPreview/1.0',
          'accept': options.accept || '*/*',
          ...(options.headers || {}),
        },
      });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('bad redirect');
        current = await assertPublicUrl(new URL(location, current).toString());
        continue;
      }
      return { response, finalUrl: current };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('too many redirects');
}

async function readLimited(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error('response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function extractMeta(html, base) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try { return new URL(match[1].replace(/&amp;/g, '&'), base).toString(); } catch {}
    }
  }
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  const raw = typeof req.query?.url === 'string' ? req.query.url : '';
  const mode = req.query?.image === '1' ? 'image' : 'meta';
  if (!raw) return res.status(400).json({ error: 'url required' });

  try {
    if (mode === 'image') {
      const { response } = await safeFetch(raw, { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' });
      if (!response.ok) return res.status(404).end();
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().startsWith('image/')) return res.status(415).end();
      const body = await readLimited(response, MAX_IMAGE_BYTES);
      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(body);
    }

    const { response, finalUrl } = await safeFetch(raw, { accept: 'text/html,application/xhtml+xml' });
    if (!response.ok) return res.status(404).json({ image: '' });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) return res.status(200).json({ image: '' });
    const html = (await readLimited(response, MAX_HTML_BYTES)).toString('utf8');
    const image = extractMeta(html, finalUrl);
    if (!image) return res.status(200).json({ image: '' });
    await assertPublicUrl(image);
    return res.status(200).json({ image: '/api/link-preview?image=1&url=' + encodeURIComponent(image) });
  } catch {
    return res.status(200).json({ image: '' });
  }
}
