'use strict';
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const HEAD=['filial','capturado_em_utc','sha256','dados_gzip_base64'];
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function normalize(branch,v,catalog){
 if(!['5','8'].includes(branch)||!v||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v.position||'')||!Number.isFinite(Date.parse(v.position+'-03:00'))||Date.parse(v.position+'-03:00')>Date.now()+600000||!Number.isSafeInteger(v.reported)||!Number.isSafeInteger(v.matched)||v.matched<Math.ceil(catalog.size*.5)||v.reported<v.matched||!v.items||Object.keys(v.items).length!==v.matched)throw Error('INVALID_STOCK_BACKUP');
 const items={};let mismatch=0;
 for(const id of Object.keys(v.items).sort()){
  const x=v.items[id],size=catalog.get(id);
  if(!Number.isFinite(size)||size<=0||!Number.isFinite(x?.units)||!Number.isFinite(x.boxes)||typeof x.compatible!=='boolean')throw Error('INVALID_STOCK_BACKUP_ITEM');
  const compatible=Math.abs(x.units-x.boxes*size)<=Math.max(.02,size*.0050001+.005);
  if(x.compatible!==compatible||x.whole!==(compatible?Math.max(0,Math.floor(x.units/size+1e-9)):null))throw Error('INVALID_STOCK_BACKUP_ITEM');
  if(!compatible)mismatch++;
  items[id]={units:x.units,boxes:x.boxes,whole:x.whole,compatible};
 }
 if(v.mismatch!==mismatch)throw Error('INVALID_STOCK_BACKUP_MISMATCH');
 return {branch,position:v.position,reported:v.reported,matched:v.matched,mismatch,items};
}
function encode(branch,v,catalog,now=new Date().toISOString()){
 const json=JSON.stringify(normalize(branch,v,catalog)),packed=zlib.gzipSync(json).toString('base64');
 if(packed.length>48000)throw Error('STOCK_BACKUP_TOO_LARGE');
 return [branch,now,hash(json),packed];
}
function decode(row,catalog){
 if(!Array.isArray(row)||row.length!==4||!['5','8'].includes(row[0])||typeof row[1]!=='string'||!Number.isFinite(Date.parse(row[1]))||Date.parse(row[1])>Date.now()+600000||!/^[0-9a-f]{64}$/.test(row[2])||typeof row[3]!=='string'||row[3].length>48000)throw Error('INVALID_STOCK_BACKUP_ROW');
 const json=zlib.gunzipSync(Buffer.from(row[3],'base64'),{maxOutputLength:1000000}).toString('utf8');
 if(hash(json)!==row[2])throw Error('STOCK_BACKUP_DIGEST_MISMATCH');
 const raw=JSON.parse(json);if(raw.branch!==row[0])throw Error('STOCK_BACKUP_BRANCH_MISMATCH');
 return {...normalize(row[0],raw,catalog),digest:row[2],syncedAt:row[1],status:'stale',precision:[]};
}
function makeStockBackup({id,catalog,excludedIds,token,fetchFn=fetch,log=console.log}){
 const configured=!!id;let ready=false,loaded=new Map(),checkedAt=0,status={configured,status:configured?'pending':'not_configured'};
 const mark=(state,error=null)=>{status={...status,status:state,checkedAt:new Date().toISOString(),error,branches:[...loaded.keys()].sort(),...(state==='ok'?{lastSuccess:new Date().toISOString()}: {})}};
 const fail=e=>{ready=false;mark(loaded.size?'stale':'unavailable',/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'STOCK_BACKUP_FAILED');log('[stock-backup] '+JSON.stringify({status:status.status,code:status.error}))};
 const req=async()=>{if(!/^[A-Za-z0-9_-]{20,120}$/.test(id)||excludedIds.has(id))throw Error('INVALID_STOCK_BACKUP_DESTINATION');const bearer=await token(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);return async(suffix,method='GET',body)=>{const r=await fetchFn(base+suffix,{method,headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw Error('STOCK_BACKUP_HTTP_'+r.status);return r.json()}};
 const range=encodeURIComponent("'EstoquePrime'!A1:D");
 async function load(force=false){
  if(!configured)return loaded;if(ready&&!force&&Date.now()-checkedAt<300000)return loaded;checkedAt=Date.now();
  try{const get=await req(),meta=await get('?fields=properties(title),sheets(properties(title))');
   if(norm(meta.properties?.title)!=='prime - historico americanas')throw Error('HISTORY_TITLE_MISMATCH');
   if(!meta.sheets?.some(s=>s.properties?.title==='EstoquePrime'))await get(':batchUpdate','POST',{requests:[{addSheet:{properties:{title:'EstoquePrime'}}}]});
   let rows=(await get('/values/'+range+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
   if(!rows.length){await get('/values/'+encodeURIComponent("'EstoquePrime'!A1:D1")+'?valueInputOption=RAW','PUT',{values:[HEAD]});rows=[HEAD]}
   if(JSON.stringify(rows[0])!==JSON.stringify(HEAD))throw Error('INVALID_STOCK_BACKUP_HEADER');
   const next=new Map();for(const row of rows.slice(1)){if(!row.length)continue;const v=decode(row,catalog),prev=next.get(v.branch);if(!prev||v.position>prev.position||(v.position===prev.position&&v.syncedAt>=prev.syncedAt))next.set(v.branch,v)}
   loaded=next;ready=true;mark('ok');log('[stock-backup] '+JSON.stringify({status:'loaded',branches:[...loaded.keys()].sort()}));
  }catch(e){fail(e)}return loaded;
 }
 async function save(branches){
  if(!configured||!ready)return;
  try{const rows=[];for(const k of ['5','8']){const v=branches[k];if(v?.status!=='ok')continue;const row=encode(k,v,catalog);if(loaded.get(k)?.digest!==row[2])rows.push(row)}
   if(!rows.length)return;
   const get=await req(),r=await get('/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:rows});
   if(r.updates?.updatedRows!==rows.length)throw Error('STOCK_BACKUP_WRITE_UNCONFIRMED');
   for(const row of rows){const v=decode(row,catalog);loaded.set(v.branch,v)}
   mark('ok');log('[stock-backup] '+JSON.stringify({status:'saved',branches:rows.map(r=>r[0])}));
  }catch(e){fail(e)}
 }
 return {load,save,health:()=>status};
}
module.exports={makeStockBackup,encode,decode};
