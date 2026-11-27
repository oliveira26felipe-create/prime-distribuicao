'use strict';
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const HEAD=['competencia','capturado_em_utc','sha256','dados_gzip_base64'];
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const validMonth=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
function normalizeSnapshot(v,storeIds){
  if(!v||!validMonth(v.month)||!Array.isArray(v.rows)||v.rows.length!==storeIds.size||!Number.isSafeInteger(v.officialGoal)||v.officialGoal<=0||!Number.isSafeInteger(v.lineCount)||v.lineCount<1||!Array.isArray(v.matchedIds)||!v.soldByStore)throw Error('INVALID_HISTORY_SNAPSHOT');
  const ids=new Set(),rows=[];
  for(const r of v.rows){
    if(!Array.isArray(r)||r.length!==3||typeof r[0]!=='string'||!storeIds.has(r[0])||ids.has(r[0])||!Number.isSafeInteger(r[1])||r[1]<0||!Number.isSafeInteger(r[2]))throw Error('INVALID_HISTORY_ROW');
    ids.add(r[0]);rows.push(r.slice());
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  const matchedIds=[...new Set(v.matchedIds)].sort();
  if(matchedIds.length!==v.matchedIds.length||matchedIds.some(id=>!ids.has(id))||v.lineCount<matchedIds.length)throw Error('INVALID_HISTORY_COVERAGE');
  const soldByStore={},mixByStore={};
  for(const [id] of rows){
    const products=v.soldByStore[id];
    if(!Array.isArray(products)||products.some(p=>typeof p!=='string'||!p||p.length>64)||new Set(products).size!==products.length)throw Error('INVALID_HISTORY_MIX');
    soldByStore[id]=products.slice().sort();mixByStore[id]=products.length;
  }
  return {month:v.month,rows,officialGoal:v.officialGoal,lineCount:v.lineCount,matchedIds,soldByStore,mixByStore};
}
function encodeSnapshot(v,storeIds,now=new Date().toISOString()){
  const data=normalizeSnapshot(v,storeIds),json=JSON.stringify(data),hash=digest(json);
  const packed=zlib.gzipSync(Buffer.from(json,'utf8')).toString('base64');
  if(packed.length>48000)throw Error('HISTORY_SNAPSHOT_TOO_LARGE');
  return [data.month,now,hash,packed];
}
function decodeSnapshot(row,storeIds){
  if(!Array.isArray(row)||row.length!==4||!validMonth(row[0])||typeof row[1]!=='string'||!Number.isFinite(Date.parse(row[1]))||Date.parse(row[1])>Date.now()+600000||!/^[0-9a-f]{64}$/.test(row[2])||typeof row[3]!=='string'||row[3].length>48000)throw Error('INVALID_HISTORY_ARCHIVE_ROW');
  let json;
  try{json=zlib.gunzipSync(Buffer.from(row[3],'base64'),{maxOutputLength:1000000}).toString('utf8')}catch{throw Error('INVALID_HISTORY_PAYLOAD')}
  if(digest(json)!==row[2])throw Error('HISTORY_DIGEST_MISMATCH');
  const data=normalizeSnapshot(JSON.parse(json),storeIds);if(data.month!==row[0])throw Error('HISTORY_MONTH_MISMATCH');
  return {...data,capturedAt:row[1],digest:row[2],syncedAt:row[1],goalSyncedAt:row[1],storeGoalSyncedAt:row[1],live:true,archived:true,mixStatus:'archived',goalStatus:'archived',storeGoalStatus:'archived',source:'Histórico permanente'};
}
function makeHistory({id,storeIds,excludedIds,token,fetchFn=fetch}){
  const configured=typeof id==='string'&&id.length>0;
  let status={configured,status:configured?'pending':'not_configured'},ready=false,loaded=new Map(),flight=null,checkedAt=0;
  const setStatus=(state,error=null)=>{status={...status,status:state,checkedAt:new Date().toISOString(),error,months:[...loaded.keys()].sort(),...(state==='ok'?{lastSuccess:new Date().toISOString()}: {})}};
  const fail=e=>{ready=false;setStatus(loaded.size?'stale':'unavailable',/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'HISTORY_CONNECTION_FAILED');console.log('[history-sync] '+JSON.stringify({status:status.status,code:status.error}))};
  const getRequest=async()=>{if(!/^[A-Za-z0-9_-]{20,120}$/.test(id)||excludedIds.has(id))throw Error('INVALID_HISTORY_DESTINATION');const bearer=await token(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);return async(suffix,method='GET',body)=>{const r=await fetchFn(base+suffix,{method,headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw Error('HISTORY_HTTP_'+r.status);return r.json()}};
  const range=encodeURIComponent("'Comercial'!A1:D");
  async function load(force=false){
    if(!configured)return loaded;if(flight)return flight;if(ready&&!force)return loaded;if(!force&&Date.now()-checkedAt<60000)return loaded;
    checkedAt=Date.now();
    flight=(async()=>{try{
      const req=await getRequest(),meta=await req('?fields=properties(title),sheets(properties(title))');
      if(norm(meta.properties?.title)!=='prime - historico americanas')throw Error('HISTORY_TITLE_MISMATCH');
      if(!meta.sheets?.some(s=>s.properties?.title==='Comercial'))await req(':batchUpdate','POST',{requests:[{addSheet:{properties:{title:'Comercial'}}}]});
      let vals=(await req('/values/'+range+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
      if(!vals.length){await req('/values/'+encodeURIComponent("'Comercial'!A1:D1")+'?valueInputOption=RAW','PUT',{values:[HEAD]});vals=[HEAD]}
      if(JSON.stringify(vals[0])!==JSON.stringify(HEAD))throw Error('INVALID_HISTORY_HEADER');
      const next=new Map();
      for(const row of vals.slice(1)){
        if(!row.length)continue;const v=decodeSnapshot(row,storeIds),prior=next.get(v.month);
        if(!prior||Date.parse(v.capturedAt)>=Date.parse(prior.capturedAt))next.set(v.month,v);
      }
      loaded=next;ready=true;setStatus('ok');
      console.log('[history-sync] '+JSON.stringify({status:'ok',months:[...loaded.keys()].sort()}));
    }catch(e){fail(e)}finally{flight=null}return loaded})();
    return flight;
  }
  async function save(values){
    if(!configured)return;if(!ready){await load();if(!ready)return}
    // The caller serializes refresh/save. A lost response is resolved by reloading the archive before retry.
    try{
      const rows=[];
      for(const v of values){
        if(!v.live||v.mixStatus!=='ok'||v.goalStatus!=='ok'||v.storeGoalStatus!=='ok')continue;
        const row=encodeSnapshot(v,storeIds);if(loaded.get(v.month)?.digest!==row[2])rows.push(row);
      }
      if(!rows.length)return;
      const req=await getRequest(),result=await req('/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:rows});
      if(result.updates?.updatedRows!==rows.length)throw Error('HISTORY_WRITE_UNCONFIRMED');
      for(const row of rows){const v=decodeSnapshot(row,storeIds);loaded.set(v.month,v)}
      setStatus('ok');status={...status,lastSaved:new Date().toISOString()};
      console.log('[history-sync] '+JSON.stringify({status:'saved',months:rows.map(r=>r[0])}));
    }catch(e){fail(e)}
  }
  return {configured,load,save,get:()=>new Map(loaded),health:()=>status};
}
module.exports={makeHistory,normalizeSnapshot,encodeSnapshot,decodeSnapshot};
