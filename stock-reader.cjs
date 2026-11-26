'use strict';
const {accessToken}=require('./sheets-reader.cjs');
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function parsePosition(values,catalog){
  const header=values.find(r=>r.some(v=>norm(v)==='qt.estoque emb.master')&&r.some(v=>norm(v)==='qt.estoque')&&r.some(v=>norm(v)==='codigo'));
  if(!header||!values.some(r=>r.some(v=>norm(v).includes('105 - posicao do estoque'))))throw Error('INVALID_STOCK_HEADER');
  const h=values.find(r=>r.some(v=>norm(v).includes('105 - posicao do estoque')));
  const stamp=h[1];
  let position;
  if(typeof stamp==='number'&&stamp>40000&&stamp<80000)position=new Date(Date.UTC(1899,11,30)+Math.round(stamp*86400000)).toISOString().slice(0,19);
  else if(typeof stamp==='string'&&/^\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(stamp.trim())){const [d,m,y,...time]=stamp.trim().split(/[\/\s]/);position=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0')+(time.length?'T'+time[0].padStart(8,'0').replace(/^0(\d{2}:)/,'$1'):'');}
  else throw Error('INVALID_STOCK_DATE');
  // The report's merged header is offset from the detail lines: B code, C description, D unit, E units, H master boxes.
  const found=new Map();let total=null,mismatch=0,precision=[];
  for(const r of values){
    if(norm(r[2])==='itens listados'&&norm(r[3]).includes('total geral')){total=Number(r[1]);continue}
    if(norm(r[3])!=='unidade'||!/^\d+$/.test(String(r[1]??'').trim()))continue;
    const id=String(r[1]).trim(),units=r[4],boxes=r[7];
    if(found.has(id))throw Error('DUPLICATE_STOCK_PRODUCT');
    if(typeof units!=='number'||typeof boxes!=='number'||!Number.isFinite(units)||!Number.isFinite(boxes))throw Error('INVALID_STOCK_QUANTITY');
    const size=catalog.get(id);
    const compatible=Number.isFinite(size)&&size>0&&Math.abs(units-boxes*size)<=Math.max(0.02,size*0.0050001+0.005);
    if(size&&!compatible){mismatch++;if(precision.length<5)precision.push({unitPerBox:size,difference:Math.round(Math.abs(units-boxes*size)*1000)/1000,boxDecimals:Number.isInteger(boxes)?0:String(boxes).split('.')[1]?.length||0})}
    found.set(id,{units,boxes,whole:compatible?Math.max(0,Math.floor(units/size+1e-9)):null,compatible});
  }
  if(!found.size||!Number.isInteger(total)||found.size!==total)throw Error('INCOMPLETE_STOCK_REPORT');
  const items=Object.fromEntries([...found].filter(([id])=>catalog.has(id)));
  return {position,items,reported:found.size,matched:Object.keys(items).length,mismatch,precision};
}
function makeStockSync(catalog){
  const id=process.env.PRIME_SHEETS_STOCK_ID;let current=null,inflight=null,checkedAt=0;
  async function refresh(){
    if(!id)return current;if(inflight)return inflight;if(Date.now()-checkedAt<300000)return current;
    inflight=(async()=>{
      try{
        if(!/^[A-Za-z0-9_-]{20,120}$/.test(id))throw Error('INVALID_STOCK_ID');
        const token=await accessToken(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
        const get=async suffix=>{const r=await fetch(base+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw Error('STOCK_HTTP_'+r.status);return r.json()};
        const info=await get('?fields=properties(title),sheets(properties(title,gridProperties(rowCount,columnCount)))');
        const tabs=info.sheets.map(t=>t.properties);
        const next={...(current?.branches||{})};
        for(const branch of ['5','8']){
          try{
            const tab=tabs.filter(t=>new RegExp('^estoque\\s*0?'+branch+'$').test(norm(t.title)));
            if(tab.length!==1)throw Error('STOCK_TAB_MISSING');
            const range="'"+tab[0].title.replace(/'/g,"''")+"'!A1:K"+tab[0].gridProperties.rowCount;
            const data=await get('/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE');
            const result=parsePosition(data.values||[],catalog);
            if(next[branch]?.position&&result.position<next[branch].position)throw Error('OLDER_STOCK_POSITION');
            const prev=next[branch];
            next[branch]={...result,status:'ok',syncedAt:prev&&JSON.stringify([prev.position,prev.items])===JSON.stringify([result.position,result.items])?prev.syncedAt:new Date().toISOString()};
            console.log('[stock-sync] '+JSON.stringify({status:'ok',branch,tab:tab[0].title,position:result.position,reported:result.reported,matched:result.matched,mismatch:result.mismatch,precision:result.precision}));
          }catch(e){next[branch]={...(next[branch]||{items:{}}),status:next[branch]?.position?'stale':'unavailable'};console.log('[stock-sync] '+JSON.stringify({status:next[branch].status,branch,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED'}))}
        }
        current={branches:next};
      }catch(e){if(current)current={branches:Object.fromEntries(Object.entries(current.branches).map(([b,v])=>[b,{...v,status:v.position?'stale':'unavailable'}]))};console.log('[stock-sync] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED'}))}
      finally{checkedAt=Date.now();inflight=null}
      return current;
    })();return inflight;
  }
  return {get:()=>current,refresh,start(){if(!id)return;refresh();const timer=setInterval(refresh,300000);timer.unref?.()}};
}
module.exports={makeStockSync,parsePosition};
