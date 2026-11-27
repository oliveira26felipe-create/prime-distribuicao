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

// A partial snapshot preserves each independently confirmed component. Null is unknown, never zero.
function normalizeOrders(history,ids){
 if(!history||typeof history!=='object'||Array.isArray(history))return {};
 const out={};
 for(const [id,orders] of Object.entries(history)){
  if(!ids.has(id)||!Array.isArray(orders)||orders.length>3)continue;
  if(orders.every(o=>o&&/^[A-Za-z0-9._-]{1,40}$/.test(o.id)&&['5','8'].includes(o.branch)&&/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&/^\d{4}-\d{2}-\d{2}$/.test(o.exit)&&o.date<=o.exit&&o.items&&typeof o.items==='object'&&!Array.isArray(o.items)&&Object.keys(o.items).length<=1000&&Object.entries(o.items).every(([p,x])=>p&&p.length<=64&&Array.isArray(x)&&x.length===2&&Number.isFinite(x[0])&&x[0]>0&&Number.isSafeInteger(x[1])&&x[1]>0)))out[id]=orders;
 }
 return out;
}
function normalizePartial(v,storeIds){
 if(!v||!validMonth(v.month)||!Array.isArray(v.rows)||v.rows.length!==storeIds.size||!v.valid||!['sales','official','individual'].every(k=>typeof v.valid[k]==='boolean')||!Object.values(v.valid).some(Boolean))throw Error('INVALID_PARTIAL_HISTORY');
 const valid={sales:v.valid.sales,official:v.valid.official,individual:v.valid.individual},seen=new Set(),rows=[];
 for(const r of v.rows){
  if(!Array.isArray(r)||r.length!==3||!storeIds.has(r[0])||seen.has(r[0])||(valid.individual?(!Number.isSafeInteger(r[1])||r[1]<0):r[1]!==null)||(valid.sales?!Number.isSafeInteger(r[2]):r[2]!==null))throw Error('INVALID_PARTIAL_HISTORY_ROW');
  seen.add(r[0]);rows.push(r.slice());
 }
 rows.sort((a,b)=>a[0].localeCompare(b[0]));
 if(valid.official?(!Number.isSafeInteger(v.officialGoal)||v.officialGoal<=0):v.officialGoal!==null)throw Error('INVALID_PARTIAL_HISTORY_GOAL');
 const soldByStore={},mixByStore={};let matchedIds=[],lineCount=null;
 if(valid.sales){
  if(!Number.isSafeInteger(v.lineCount)||v.lineCount<1||!Array.isArray(v.matchedIds)||new Set(v.matchedIds).size!==v.matchedIds.length||v.matchedIds.some(id=>!seen.has(id))||v.lineCount<v.matchedIds.length||!v.soldByStore)throw Error('INVALID_PARTIAL_HISTORY_SALES');
  lineCount=v.lineCount;matchedIds=v.matchedIds.slice().sort();
  for(const [id] of rows){const p=v.soldByStore[id];if(!Array.isArray(p)||new Set(p).size!==p.length||p.some(x=>typeof x!=='string'||!x||x.length>64))throw Error('INVALID_PARTIAL_HISTORY_MIX');soldByStore[id]=p.slice().sort();mixByStore[id]=p.length}
 }
 return {version:2,month:v.month,valid,rows,officialGoal:v.officialGoal,lineCount,matchedIds,soldByStore,mixByStore,...(valid.sales&&v.orderHistory?{orderHistory:normalizeOrders(v.orderHistory,storeIds),orderStatus:v.orderStatus==='ok'?'ok':'partial'}:{})};
}
function combineSnapshot(v,prior,storeIds){
 const old=prior?.valid||{sales:!!prior?.live,official:Number.isSafeInteger(prior?.officialGoal),individual:!!prior?.rows?.every(r=>Number.isSafeInteger(r[1]))};
 const take={sales:v.live&&v.mixStatus==='ok',official:v.goalStatus==='ok',individual:v.storeGoalStatus==='ok'};
 if(!Object.values(take).some(Boolean))return null;
 const valid={sales:!!(take.sales||old.sales),official:!!(take.official||old.official),individual:!!(take.individual||old.individual)};
 const sales=take.sales?v:prior,goals=take.individual?v:prior,official=take.official?v:prior;
 const sm=new Map((sales?.rows||[]).map(r=>[r[0],r[2]])),gm=new Map((goals?.rows||[]).map(r=>[r[0],r[1]]));
 return normalizePartial({version:2,month:v.month,valid,rows:[...storeIds].map(id=>[id,valid.individual?gm.get(id):null,valid.sales?sm.get(id):null]),officialGoal:valid.official?official.officialGoal:null,lineCount:valid.sales?sales.lineCount:null,matchedIds:valid.sales?sales.matchedIds:[],soldByStore:valid.sales?sales.soldByStore:{},...(valid.sales&&sales.orderHistory?{orderHistory:sales.orderHistory,orderStatus:sales.orderStatus}:{})},storeIds);
}

function encodeSnapshot(v,storeIds,now=new Date().toISOString()){
  let data=v.version===2?normalizePartial(v,storeIds):normalizeSnapshot(v,storeIds),json=JSON.stringify(data),packed=zlib.gzipSync(Buffer.from(json,'utf8')).toString('base64');
  if(packed.length>48000&&data.orderHistory){delete data.orderHistory;delete data.orderStatus;json=JSON.stringify(data);packed=zlib.gzipSync(Buffer.from(json,'utf8')).toString('base64');console.log('[orders-history] '+JSON.stringify({month:data.month,status:'archive_size_limit'}))}
  const hash=digest(json);
  if(packed.length>48000)throw Error('HISTORY_SNAPSHOT_TOO_LARGE');
  return [data.month,now,hash,packed];
}
function decodeSnapshot(row,storeIds){
  if(!Array.isArray(row)||row.length!==4||!validMonth(row[0])||typeof row[1]!=='string'||!Number.isFinite(Date.parse(row[1]))||Date.parse(row[1])>Date.now()+600000||!/^[0-9a-f]{64}$/.test(row[2])||typeof row[3]!=='string'||row[3].length>48000)throw Error('INVALID_HISTORY_ARCHIVE_ROW');
  let json;
  try{json=zlib.gunzipSync(Buffer.from(row[3],'base64'),{maxOutputLength:1000000}).toString('utf8')}catch{throw Error('INVALID_HISTORY_PAYLOAD')}
  if(digest(json)!==row[2])throw Error('HISTORY_DIGEST_MISMATCH');
  const raw=JSON.parse(json),data=raw.version===2?normalizePartial(raw,storeIds):normalizeSnapshot(raw,storeIds);if(data.month!==row[0])throw Error('HISTORY_MONTH_MISMATCH');
  return {...data,capturedAt:row[1],digest:row[2],syncedAt:row[1],goalSyncedAt:row[1],storeGoalSyncedAt:row[1],live:data.valid?.sales??true,archived:true,mixStatus:data.valid?.sales===false?'unavailable':'archived',goalStatus:data.valid?.official===false?'unavailable':'archived',storeGoalStatus:data.valid?.individual===false?'unavailable':'archived',source:'Histórico permanente'};
}
function makeHistory({id,storeIds,excludedIds,token,fetchFn=fetch,log=console.log}){
  const configured=typeof id==='string'&&id.length>0;
  let status={configured,status:configured?'pending':'not_configured'},ready=false,loaded=new Map(),flight=null,checkedAt=0;
  const setStatus=(state,error=null)=>{status={...status,status:state,checkedAt:new Date().toISOString(),error,months:[...loaded.keys()].sort(),...(state==='ok'?{lastSuccess:new Date().toISOString()}: {})}};
  const fail=e=>{ready=false;setStatus(loaded.size?'stale':'unavailable',/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'HISTORY_CONNECTION_FAILED');log('[history-sync] '+JSON.stringify({status:status.status,code:status.error}))};
  const getRequest=async()=>{if(!/^[A-Za-z0-9_-]{20,120}$/.test(id)||excludedIds.has(id))throw Error('INVALID_HISTORY_DESTINATION');const bearer=await token(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);return async(suffix,method='GET',body)=>{const r=await fetchFn(base+suffix,{method,headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw Error('HISTORY_HTTP_'+r.status);return r.json()}};
  const range=encodeURIComponent("'Comercial'!A1:D");
  async function load(force=false){
    if(!configured)return loaded;if(flight)return flight;if(ready&&!force&&Date.now()-checkedAt<300000)return loaded;if(!force&&Date.now()-checkedAt<60000)return loaded;
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
      log('[history-sync] '+JSON.stringify({status:'ok',months:[...loaded.keys()].sort()}));
    }catch(e){fail(e)}finally{flight=null}return loaded})();
    return flight;
  }
  async function save(values){
    if(!configured)return;if(!ready){await load();if(!ready)return}
    // The caller serializes refresh/save. A lost response is resolved by reloading the archive before retry.
    try{
      const rows=[];
      for(const v of values){
        const merged=combineSnapshot(v,loaded.get(v.month),storeIds);if(!merged)continue;
        const row=encodeSnapshot(merged,storeIds);if(loaded.get(v.month)?.digest!==row[2])rows.push(row);
      }
      if(!rows.length)return;
      const req=await getRequest(),result=await req('/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:rows});
      if(result.updates?.updatedRows!==rows.length)throw Error('HISTORY_WRITE_UNCONFIRMED');
      for(const row of rows){const v=decodeSnapshot(row,storeIds);loaded.set(v.month,v)}
      setStatus('ok');status={...status,lastSaved:new Date().toISOString()};
      log('[history-sync] '+JSON.stringify({status:'saved',months:rows.map(r=>r[0])}));
    }catch(e){fail(e)}
  }
  return {configured,load,save,get:()=>new Map(loaded),health:()=>status};
}
module.exports={makeHistory,normalizeSnapshot,normalizePartial,combineSnapshot,encodeSnapshot,decodeSnapshot};
