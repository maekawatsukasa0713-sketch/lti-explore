"""Import bibliographic facts from an official university thesis list (no thesis text)."""
import re, html, json, hashlib, urllib.request, sys
from pathlib import Path
url='https://earth.sci.ehime-u.ac.jp/articlelist.html'
raw=Path(sys.argv[1]).read_text() if len(sys.argv)>1 else urllib.request.urlopen(url,timeout=25).read().decode('utf-8')
raw=re.sub(r'<!--.*?-->','',raw,flags=re.S)
def clean(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',s))).strip()
items=[]
for anchor,label,table in re.findall(r'<a name="([^"]+)">(.*?)</a>.*?<table[^>]*>(.*?)</table>',raw,re.S):
 m=re.search(r'令和(\d+)年度 (卒業|修士)論文',clean(label))
 if not m or int(m[1])<5:continue
 year=2018+int(m[1]);kind='bachelor' if m[2]=='卒業' else 'master'
 for row in re.findall(r'<tr[^>]*>(.*?)</tr>',table,re.S):
  cells=re.findall(r'<td[^>]*>(.*?)</td>',row,re.S)
  if len(cells)!=3:continue
  author,title,_=map(clean,cells)
  key=hashlib.sha256((url+str(year)+kind+title+author).encode()).hexdigest()[:20]
  items.append(dict(key=key,title=title,authors=author,university='愛媛大学',field='地学・環境',year=year,kind=kind,access='title',sourceUrl=url+'#'+anchor,checkedAt='2026-09-09'))
# These summary PDFs were individually verified; student IDs and summary text are not imported.
for key,title,author,kind,pdf in [
 ('waseda-arai-2025','トリルチル型CrTa₂O₆の作製と物性','荒井 理沙','bachelor','sotu_arai.pdf'),
 ('waseda-ikenoya-2025','Yb₁₋ₓCaₓTiO₃の軌道-スピン相互作用','池谷 陽太郎','bachelor','sotu_ikenoya.pdf'),
 ('waseda-ikeda-2025','Sm₁₋ₓGdₓTiO₃の軌道-スピン相互作用','池田 凱','master','shu_ron/shu_ikeda_k.pdf')]:
 items.append(dict(key=key,title=title,authors=author,university='早稲田大学',field='物理・物性',year=2025,kind=kind,access='summary',sourceUrl='https://katsuf.w.waseda.jp/lab/sotu.htm',documentUrl='https://katsuf.w.waseda.jp/lab/sotu_shu_ron/'+pdf,checkedAt='2026-09-09'))
assert len({p['key'] for p in items})==len(items)
Path(__file__).resolve().parents[1].joinpath('thesis-catalog.ts').write_text('export type Thesis = { key:string; title:string; authors:string; university:string; field:string; year:number; kind:"bachelor"|"master"|"doctoral"; access:"title"|"summary"|"full"; sourceUrl:string; documentUrl?:string; checkedAt:string };\nexport const theses: Thesis[] = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n')
print('Bibliographic records:',len(items))
