export async function extractLargePdf(file:Blob){
 const pdfjs=await import('pdfjs-dist');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
 try{const pdf=await task.promise;if(pdf.numPages>300)throw new Error('AI解析は300ページ以内です。原本は保存済みです。');let text='';let empty=0;
 for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();const value=content.items.map(item=>'str' in item?item.str:'').join(' ');if(value.trim().length<20)empty++;text+=`\n[${i}ページ]\n${value}`;page.cleanup();if(text.length>80000)throw new Error('本文が8万文字を超えるためAI解析できません。原本はそのまま保存されています。');}
 if(text.replace(/\[\d+ページ\]/g,'').trim().length<40||empty>pdf.numPages/2)throw new Error('画像中心の大容量PDFは本文を抽出できません。OCR済みPDFまたは圧縮したPDFをご用意ください。原本は保存されています。');
 return {text,basis:`PDF抽出テキスト（全${pdf.numPages}ページ・図表画像は対象外${empty?`・文字が少ないページ${empty}件あり`:''}）`};
 }finally{await task.destroy();}
}
