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
// Preserve purchase orders separately from commercial totals. Quantity is the
// report's raw QTVENDA; never assume it is units or boxes.
function reportDate(v){
 if(typeof v==='number'&&Number.isFinite(v)&&v>=40000&&v<80000)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);
 const t=String(v??'').trim(),a=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/),b=t.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
 const d=a?[a[3],a[2].padStart(2,'0'),a[1].padStart(2,'0')].join('-'):b?b.slice(1).join('-'):'';
 return dateMonth(d)?d:null;
}
function collectOrders(rows,ids,month,groups,bad){
 for(const r of rows){
  const store=String(r[0]??'').trim();if(!ids.has(store)||dateMonth(r[11])!==month||r[3]===0)continue;
  const id=String(r[13]??'').trim(),branch=String(Number(r[18])),sku=String(r[1]??'').trim(),date=reportDate(r[10]),exit=reportDate(r[11]),q=r[6],c=Math.round(r[3]*100);
  if(!/^[A-Za-z0-9._-]{1,40}$/.test(id)||!['5','8'].includes(branch)||!/^\d{1,20}$/.test(sku)||!date||!exit||date>exit||typeof q!=='number'||!Number.isFinite(q)||q<=0||q>1e9||!Number.isSafeInteger(c)||c<=0){bad.add(store);continue}
  const m=groups.get(store)||new Map();groups.set(store,m);
  const key=branch+':'+id,rec=m.get(key)||{id,branch,date,exit,items:{}};m.set(key,rec);
  if(rec.date!==date){bad.add(store);continue}
  if(exit>rec.exit)rec.exit=exit;
  const old=rec.items[sku]||[0,0];rec.items[sku]=[old[0]+q,old[1]+c];
  if(!Number.isFinite(rec.items[sku][0])||!Number.isSafeInteger(rec.items[sku][1]))bad.add(store);
 }
}
function recentOrders(groups,bad){
 const out={};
 for(const [store,m] of groups)if(!bad.has(store))out[store]=[...m.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.exit.localeCompare(a.exit)||b.id.localeCompare(a.id)).slice(0,3);
 return out;
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
 const ids=new Set(baseline.rows.map(r=>String(r[0]))),rows=[],groups=new Map(),bad=new Set();
 const orderLayout=[[8,'QTVENDA'],[12,'DTPED'],[15,'PEDIDO'],[20,'FILIAL']].every(([i,name])=>norm(header[i])===name);
 for(let start=2;start<=count;start+=10000){const end=Math.min(count,start+9999),chunk=await values("'8095'!C"+start+":"+(orderLayout?'U':'N')+end);rows.push(...normalizeFarolRows(chunk,ids,baseline.month));if(orderLayout)collectOrders(chunk,ids,baseline.month,groups,bad)}
 rows.orderHistory=orderLayout?recentOrders(groups,bad):null;
 rows.orderStatus=!orderLayout?'layout_invalid':bad.size?'partial':'ok';
 console.log('[orders-history] '+JSON.stringify({month:baseline.month,status:rows.orderStatus,stores:Object.keys(rows.orderHistory||{}).length,orders:Object.values(rows.orderHistory||{}).reduce((n,x)=>n+x.length,0),invalidStores:bad.size}));
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
async function readMetaFlash(get,id,month,calendarMonth,confirmedMetaMonth){
 if(month!==calendarMonth)throw Error('META_FLASH_PERIOD_UNCONFIRMED');
 const meta=await get(id,'?fields=properties(title),sheets(properties(title))');
 if(norm(meta.properties?.title)!=='METAS - FLASH')throw Error('META_FLASH_TITLE_MISMATCH');
 const marker=(meta.sheets||[]).filter(s=>norm(s.properties?.title)==='COMPETENCIA');
 if(marker.length>1)throw Error('META_FLASH_PERIOD_UNCONFIRMED');
 const readMarker=async()=> (await get(id,'/values/'+encodeURIComponent("'"+marker[0].properties.title.replace(/'/g,"''")+"'!A1")+'?valueRenderOption=UNFORMATTED_VALUE')).values?.[0]?.[0];
 if(marker.length===1){
  const a=await readMarker();
  const period=typeof a==='number'?dateMonth(a):String(a??'').trim();
  if(period!==month)throw Error('META_FLASH_PERIOD_UNCONFIRMED');
 }else if(confirmedMetaMonth!==month)throw Error('META_FLASH_PERIOD_UNCONFIRMED');
 const values=(await get(id,'/values/'+encodeURIComponent("'METAS'!A1:AY")+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
 if(marker.length===1){const b=await readMarker();if((typeof b==='number'?dateMonth(b):String(b??'').trim())!==month)throw Error('META_FLASH_PERIOD_UNCONFIRMED')}
 return readMetaRows(values);
}
module.exports={dateMonth,normalizeFarolRows,readFarol,readMetaRows,readMetaFlash,collectOrders,recentOrders,reportDate};
