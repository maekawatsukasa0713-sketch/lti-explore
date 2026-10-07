import {publicFetch,imageTypes,validImage} from '../server/public-fetch.js';

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
  if (req.method && req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  const raw = typeof req.query?.url === 'string' ? req.query.url : '';
  const mode = req.query?.image === '1' ? 'image' : 'meta';
  if (!raw) return res.status(400).json({ error: 'url required' });

  try {
    if (mode === 'image') {
      const response = await publicFetch(raw, { accept: [...imageTypes].join(','), maxBytes: 5*1024*1024, allowedTypes: imageTypes });
      if (!response.ok) return res.status(404).end();
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const body = response.body;
      if (!imageTypes.has(type) || !validImage(body,type)) return res.status(415).end();
      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.status(200).send(body);
    }

    const response = await publicFetch(raw, { accept: 'text/html,application/xhtml+xml', maxBytes: 1024*1024 });
    const finalUrl = response.finalUrl;
    if (!response.ok) return res.status(404).json({ image: '' });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) return res.status(200).json({ image: '' });
    const html = response.body.toString('utf8');
    const image = extractMeta(html, finalUrl);
    if (!image) return res.status(200).json({ image: '' });
    if (!['http:','https:'].includes(new URL(image).protocol)) return res.status(200).json({ image: '' });
    return res.status(200).json({ image: '/api/link-preview?image=1&url=' + encodeURIComponent(image) });
  } catch {
    return res.status(200).json({ image: '' });
  }
}
