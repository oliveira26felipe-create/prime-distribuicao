'use strict';
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
function dateMonth(v){
 if(typeof v==='number'&&Number.isFinite(v)&&v>=40000&&v<80000)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,7);
 const t=String(v??'').trim(),a=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/),b=t.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
 const p=a?[a[3],a[2].padStart(2,'0'),a[1].padStart(2,'0')]:b?[b[1],b[2],b[3]]:null;
 if(!p)return null;const d=p.join('-'),ms=Date.parse(d+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===d?d.slice(0,7):null;
}
function normalizeFarolRows(rows,ids,month){
 const found=[];
 for(const r of rows){
  const id=String(r[0]??'').trim();if(!ids.has(id))continue;
  const m=dateMonth(r[11]);if(!m)throw Error('INVALID_FAROL_EXIT_DATE');if(m!==month)continue;
  const p=String(r[1]??'').trim(),amount=r[3],ret=r[8];
  if(!p||typeof amount!=='number'||!Number.isFinite(amount))throw Error('INVALID_FAROL_SALES_ROW');
  if(ret!==undefined&&ret!==null&&ret!==''&&(typeof ret!=='number'||!Number.isFinite(ret)))throw Error('INVALID_FAROL_RETURN_VALUE');
  // The old Flash and Farol agree on VLVENDA for the validated dataset; no nonzero return was present.
  // Fail closed until the accounting meaning of a separate nonzero return column is confirmed.
  if(typeof ret==='number'&&ret!==0)throw Error('FAROL_RETURN_RULE_UNCONFIRMED');
  found.push([id,p,'',amount]);
 }
 return found;
}
async function readFarol(get,id,baseline){
 const meta=await get(id,'?fields=properties(title),sheets(properties(title,gridProperties(rowCount)))');
 if(norm(meta.properties?.title)!=='8095 - FAROL')throw Error('FAROL_TITLE_MISMATCH');
 const tabs=meta.sheets?.filter(x=>x.properties?.title==='8095')||[];
 if(tabs.length!==1)throw Error('FAROL_TAB_MISSING');
 const count=tabs[0].properties.gridProperties?.rowCount;
 if(!Number.isInteger(count)||count<2||count>150000)throw Error('FAROL_RANGE_UNSUPPORTED');
 const values=async range=>(await get(id,'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
 const header=(await values("'8095'!1:1"))[0]||[];
 for(const [i,name] of [[2,'CODCLI'],[3,'PRODUTO'],[5,'VLVENDA'],[10,'VLDEVOLUCAO'],[13,'DTSAIDA']])if(norm(header[i])!==name)throw Error('INVALID_FAROL_LAYOUT');
 const ids=new Set(baseline.rows.map(r=>String(r[0]))),rows=[];
 for(let start=2;start<=count;start+=10000){const end=Math.min(count,start+9999);rows.push(...normalizeFarolRows(await values("'8095'!C"+start+":N"+end),ids,baseline.month))}
 return rows;
}
function readMetaRows(values){
 if(norm(values[0]?.[0])!=='COD'||norm(values[0]?.[1])!=='VENDEDOR'||norm(values[0]?.[46])!=='GERAL'||norm(values[1]?.[46])!=='FATURAMENTO'||norm(values[2]?.[47])!=='META')throw Error('INVALID_META_FLASH_LAYOUT');
 const matches=values.slice(3).filter(r=>String(r[0]??'').trim()==='1001'||norm(r[1])==='AMERICANAS');
 if(matches.length!==1||String(matches[0][0]).trim()!=='1001'||norm(matches[0][1])!=='AMERICANAS')throw Error('AMERICANAS_GOAL_ROW_MISSING_OR_DUPLICATE');
 const v=matches[0][47],cents=typeof v==='number'?Math.round(v*100):null;
 if(!Number.isSafeInteger(cents)||cents<=0)throw Error('INVALID_OFFICIAL_GOAL');
 return cents;
}
async function readMetaFlash(get,id,month,calendarMonth){
 if(month!==calendarMonth)throw Error('META_FLASH_PERIOD_UNCONFIRMED');
 const meta=await get(id,'?fields=properties(title)');
 if(norm(meta.properties?.title)!=='METAS - FLASH')throw Error('META_FLASH_TITLE_MISMATCH');
 const values=(await get(id,'/values/'+encodeURIComponent("'METAS'!A1:AY")+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
 return readMetaRows(values);
}
module.exports={dateMonth,normalizeFarolRows,readFarol,readMetaRows,readMetaFlash};
