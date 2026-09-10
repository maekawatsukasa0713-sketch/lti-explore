"""Import metadata and verified PDF links, never republish thesis text."""
import re,html,json,hashlib,urllib.request,urllib.parse,subprocess,tempfile,concurrent.futures,sys
from pathlib import Path
from datetime import date
base='https://www2.yukawa.kyoto-u.ac.jp/~soken.editorial/'
raw=Path(sys.argv[1]).read_text() if len(sys.argv)>1 else urllib.request.urlopen(base+'shuron.html',timeout=30).read().decode('utf-8')
def clean(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',s))).strip()
rows=[]
for kind,section in [('bachelor',raw.split('<h2>卒業論文</h2>')[1].split('<h2>修士論文</h2>')[0]),('master',raw.split('<h2>修士論文</h2>')[1].split('<h2>')[0])]:
 for item in re.findall(r'<li id="shuron">(.*?)</li>',section,re.S):
  if 'ダイジェスト' in item or '修正版' in item:continue
  title=re.search('“(.*?)”',item,re.S);link=re.search(r'href="([^"]+)">PDF</a>',item)
  year=re.search(r'\((20\d\d|19\d\d)\)',clean(item))
  if not title or not link or not year or 'sokendenshi/' not in link[1]:continue
  author=clean(item.split('“')[0]);url=urllib.parse.quote(urllib.parse.urljoin(base,link[1]),safe=':/%')
  rows.append(dict(key='soken-'+hashlib.sha256(url.encode()).hexdigest()[:16],title=clean(title[1]),authors=author,university='素粒子論研究（所属は本文参照）',field='物理・宇宙',year=int(year[1]),kind=kind,access='full',sourceUrl=base+'shuron.html',documentUrl=url,checkedAt=date.today().isoformat()))
def verify(p):
 try:
  with urllib.request.urlopen(p['documentUrl'],timeout=30) as r:data=r.read(20000000)
  if not data.startswith(b'%PDF'):return None
  with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
   f.write(data);f.flush();info=subprocess.check_output(['pdfinfo',f.name],text=True)
  pages=int(re.search(r'Pages:\s+(\d+)',info)[1])
  if pages<10:return None
  print(p['key'],pages,flush=True);return p
 except Exception as e:print('Skipped',p['key'],type(e).__name__,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:verified=[p for p in pool.map(verify,rows) if p]
assert verified,'No verified PDFs'
Path(__file__).resolve().parents[1].joinpath('full-theses.ts').write_text("import type { Thesis } from './thesis-catalog';\nexport const fullTheses: Thesis[] = "+json.dumps(verified,ensure_ascii=False,indent=2)+';\n')
print('Verified full PDFs:',len(verified))
