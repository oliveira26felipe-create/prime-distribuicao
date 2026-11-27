'use strict';
const {accessToken}=require('./sheets-reader.cjs');
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const id=v=>String(v??'').trim();
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{20,120}$/.test(v);
const date=v=>{if(typeof v==='number'&&v>=40000&&v<80000)return new Date(Date.UTC(1899,11,30)+Math.round(v*86400000)).toISOString().slice(0,19)+'-03:00';const s=String(v??'').trim();return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(s)?s:null};
function validateControl(values,rows,now=Date.now()){
 const m=new Map(values.map(r=>[norm(r[0]),r[1]]));const stamp=date(m.get('POSICAO')),at=Date.parse(stamp||'');
 if(values.length!==3||m.size!==3||!Number.isFinite(at)||at>now+600000||now-at>86400000||m.get('REGISTROS')!==rows||norm(m.get('COMPLETO'))!=='SIM')throw Error('SUPPLY_REPORT_NOT_CONFIRMED');
 return new Date(at).toISOString();
}
function parsePending(values,control,catalog,now){
 const expected=['FILIAL','CODCLI','PRODUTO','PEDIDO','ITEM','QTD_PENDENTE_UN'];
 if(JSON.stringify((values[0]||[]).map(norm))!==JSON.stringify(expected))throw Error('INVALID_PENDING_LAYOUT');
 const rows=values.slice(1),position=validateControl(control,rows.length,now),seen=new Set(),out={};
 for(const r of rows){
  const branch=id(r[0]),store=id(r[1]),product=id(r[2]),order=id(r[3]),line=id(r[4]),units=r[5],key=JSON.stringify([branch,order,line]);
  if(!['5','8'].includes(branch)||!catalog.stores.has(store)||catalog.stores.get(store).branch!==branch||!catalog.products.has(product)||!order||!line||seen.has(key)||!finite(units)||units<0||units>1e9)throw Error('INVALID_PENDING_ROW');
  seen.add(key);const byStore=out[store]??={};byStore[product]=(byStore[product]||0)+units;
  if(!Number.isFinite(byStore[product]))throw Error('INVALID_PENDING_ROW');
 }
 return {position,items:out};
}
function parsePrices(values,control,catalog,now){
 const expected=['FILIAL','PRODUTO','PRECO_UN','UNIDADES_CAIXA'];
 if(JSON.stringify((values[0]||[]).map(norm))!==JSON.stringify(expected))throw Error('INVALID_PRICES_LAYOUT');
 const rows=values.slice(1),position=validateControl(control,rows.length,now),out={};
 for(const r of rows){
  const branch=id(r[0]),product=id(r[1]),price=r[2],size=r[3],p=catalog.products.get(product);
  if(!['5','8'].includes(branch)||!p||size!==p.unitsPerBox||!finite(price)||price<=0||price>1e6||out[branch]?.[product]!==undefined)throw Error('INVALID_PRICE_ROW');
  const cents=Math.round(price*size*100);if(!Number.isSafeInteger(cents)||cents<=0)throw Error('INVALID_PRICE_ROW');
  (out[branch]??={})[product]=cents;
 }
 if(!rows.length)throw Error('EMPTY_PRICE_REPORT');
 return {position,items:out};
}
function makeSupplySync({catalog,excludedIds,fetchFn=fetch,token=accessToken,config={}}){
 const sources={pending:config.pendingId??process.env.PRIME_SHEETS_ORDERS_ID,prices:config.pricesId??process.env.PRIME_SHEETS_PRICES_ID};
 const names={pending:['PRIME - PEDIDOS PENDENTES','Pedidos',parsePending],prices:['PRIME - PRECOS AMERICANAS','Precos',parsePrices]};
 let current={status:{pending:'not_configured',prices:'not_configured'},positions:{},errors:{},prices:{},pending:{}},checked=0,flight=null;
 async function refresh(force=false){
  if(flight)return flight;if(!force&&Date.now()-checked<300000)return current;checked=Date.now();
  flight=(async()=>{try{for(const k of ['pending','prices']){
   const sid=sources[k];if(!sid)continue;
   try{
    if(!validId(sid)||excludedIds.has(sid)||sources.pending===sources.prices)throw Error('INVALID_SUPPLY_SOURCE');
    const bearer=await token(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(sid);
    const get=async suffix=>{const r=await fetchFn(base+suffix,{headers:{Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw Error('SUPPLY_HTTP_'+r.status);return r.json()};
    const meta=await get('?fields=properties(title)');
    if(norm(meta.properties?.title)!==names[k][0])throw Error('SUPPLY_TITLE_MISMATCH');
    const read=async range=>(await get('/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
    const before=await read("'Controle'!A1:B3"),values=await read("'"+names[k][1]+"'!A:F"),after=await read("'Controle'!A1:B3");
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('SUPPLY_CHANGED_DURING_READ');
    const result=names[k][2](values,before,catalog);
    current={...current,[k]:result.items,status:{...current.status,[k]:'ok'},positions:{...current.positions,[k]:result.position},errors:{...current.errors,[k]:null}};
    console.log('[supply-sync] '+JSON.stringify({source:k,status:'ok',position:result.position}));
   }catch(e){const code=/^[A-Z_0-9]+$/.test(e.message)?e.message:'SUPPLY_READ_FAILED';current={...current,status:{...current.status,[k]:current.positions[k]?'stale':'unavailable'},errors:{...current.errors,[k]:code}};console.log('[supply-sync] '+JSON.stringify({source:k,status:current.status[k],code}))}
  }}finally{flight=null}return current})();return flight;
 }
 return {get:()=>{const status={...current.status};for(const k of ['pending','prices'])if(status[k]==='ok'&&Date.now()-Date.parse(current.positions[k])>86400000)status[k]='stale';return {...current,status}},refresh,start(){refresh();const t=setInterval(refresh,30000);t.unref?.()}};
}
module.exports={parsePending,parsePrices,makeSupplySync};
