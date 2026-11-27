'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const tokenUrl='https://oauth2.googleapis.com/token';
let tokenCache=null,tokenFlight=null,writeCache=null,writeFlight=null;
async function accessToken(){
  if(tokenCache&&tokenCache.until>Date.now())return tokenCache.value;
  if(tokenFlight)return tokenFlight;
  tokenFlight=requestToken('https://www.googleapis.com/auth/spreadsheets.readonly').then(v=>{tokenCache=v;return v.value});
  try{return await tokenFlight}finally{tokenFlight=null}
}
async function accessWriteToken(){
  if(writeCache&&writeCache.until>Date.now())return writeCache.value;
  if(writeFlight)return writeFlight;
  writeFlight=requestToken('https://www.googleapis.com/auth/spreadsheets').then(v=>{writeCache=v;return v.value});
  try{return await writeFlight}finally{writeFlight=null}
}
async function requestToken(scope){
  let creds;
  try{creds=JSON.parse(fs.readFileSync('/etc/secrets/google-sheets.json','utf8'))}catch(e){throw new Error(e.code==='ENOENT'?'SECRET_FILE_MISSING':'SECRET_FILE_INVALID')}
  if(creds.type!=='service_account'||typeof creds.client_email!=='string'||typeof creds.private_key!=='string')throw new Error('INVALID_SERVICE_ACCOUNT');
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:creds.client_email,scope,aud:tokenUrl,iat:now,exp:now+3600});
  let assertion;try{assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),creds.private_key).toString('base64url')}catch{throw new Error('INVALID_PRIVATE_KEY')}
  const resp=await fetch(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!resp.ok)throw new Error('TOKEN_HTTP_'+resp.status);
  const token=await resp.json();if(typeof token.access_token!=='string')throw new Error('INVALID_TOKEN_RESPONSE');return {value:token.access_token,until:Date.now()+Math.max(0,Math.min(3300,(Number(token.expires_in)||3600)-120))*1000};
}
const monthNames=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function aggregate(rows,baseline){
  const totals=new Map(baseline.rows.map(([id,meta])=>[String(id),{meta,actual:0,products:new Map()}]));
  let lines=0,matched=new Set();
  for(const r of rows){
    const code=String(r[0]??'').trim(),v=totals.get(code);if(!v)continue;
    const p=String(r[1]??'').trim(),cents=typeof r[3]==='number'?Math.round(r[3]*100):null;
    if(!p||!Number.isSafeInteger(cents))throw new Error('INVALID_SALES_ROW');
    v.actual+=cents;if(!Number.isSafeInteger(v.actual))throw new Error('INVALID_SALES_TOTAL');
    v.products.set(p,(v.products.get(p)||0)+cents);matched.add(code);lines++;
  }
  if(!lines)throw new Error('INCOMPLETE_SALES_BASE');
  const soldByStore=Object.fromEntries([...totals].map(([id,v])=>[id,[...v.products].filter(([,n])=>n>0).map(([p])=>p).sort()]));
  return {matchedIds:[...matched].sort(),rows:[...totals].map(([id,v])=>[id,v.meta,v.actual]),mixByStore:Object.fromEntries(Object.entries(soldByStore).map(([id,p])=>[id,p.length])),soldByStore,lines,stores:matched.size};
}
function readOfficialGoal(values){
  const cols=(values[5]||[]).map((v,i)=>v==='Meta'&&values[3]?.[i]==='TOTAL'&&values[4]?.[i]==='Faturamento'?i:-1).filter(i=>i>=0);
  if(cols.length!==1||values[5]?.[1]!=='Cod'||values[5]?.[2]!=='EQUIPE')throw Error('INVALID_GOAL_LAYOUT');
  const matches=values.slice(6).filter(r=>String(r[1]??'').trim()==='1001'&&String(r[2]??'').trim().toLowerCase()==='americanas');
  if(matches.length!==1)throw Error('AMERICANAS_GOAL_ROW_MISSING_OR_DUPLICATE');
  const v=matches[0][cols[0]],cents=typeof v==='number'?Math.round(v*100):null;
  if(!Number.isSafeInteger(cents)||cents<=0)throw Error('INVALID_OFFICIAL_GOAL');
  return cents;
}
function readStoreGoals(values,baseline){
  const header=values[3]||[];
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const [year,month]=baseline.month.split('-'),expected=norm(monthNames[Number(month)-1]);
  if(!norm(values[0]?.[0]).includes(expected)||!norm(values[0]?.[0]).includes(year)||norm(header[1])!=='codigo cliente'||norm(header[4])!=='meta de faturamento (r$)')throw Error('INVALID_STORE_GOAL_LAYOUT_OR_MONTH');
  const ids=new Set(baseline.rows.map(r=>String(r[0]))),found=new Map();
  for(const r of values.slice(4)){
    const id=String(r[1]??'').trim();
    if(!ids.has(id))continue;
    if(found.has(id))throw Error('DUPLICATE_STORE_GOAL');
    const value=r[4],cents=typeof value==='number'?Math.round(value*100):null;
    if(!Number.isSafeInteger(cents)||cents<0)throw Error('INVALID_STORE_GOAL');
    found.set(id,cents);
  }
  if(found.size!==ids.size)throw Error('MISSING_STORE_GOALS');
  return found;
}
function validateCoverage(result,previous,minStores=30){
  if(result.stores<minStores)throw Error('SALES_COVERAGE_TOO_LOW');
  if(previous?.live&&Number.isInteger(previous.lineCount)&&result.lines<Math.ceil(previous.lineCount*0.8))throw Error('SUDDEN_SALES_ROW_DROP');
  if(previous?.live&&Array.isArray(previous.matchedIds)&&previous.matchedIds.filter(id=>!result.matchedIds.includes(id)).length>2)throw Error('SUDDEN_STORE_COVERAGE_DROP');
}
const errorCode=e=>/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'CONNECTION_FAILED';
const monthNow=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Bahia'}).slice(0,7);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{20,120}$/.test(id);
const validMonth=m=>typeof m==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
function makeSync(baseline,config={}){
  const id=config.salesId??process.env.PRIME_SHEETS_FIRST_ID;
  const gid=config.goalsId??process.env.PRIME_SHEETS_GOALS_ID;
  const month=baseline.month,expected=monthNames[Number(month.slice(5))-1];
  const minStores=config.minStores??30;
  let current={...baseline},inflight=null,checkedAt=0;
  let health={sales:{status:'pending'},official:{status:'pending'},individual:{status:'pending'}};
  function mark(k,status,extra={}){const at=new Date().toISOString();health[k]={...health[k],status,checkedAt:at,...extra,...(status==='ok'?{lastSuccess:at,error:null}:{})}}
  const failure=(k,e)=>{const status=health[k].lastSuccess?'stale':'unavailable';mark(k,status,{error:errorCode(e)});return status};
  const refresh=async(force=false)=>{
    if(inflight)return inflight;
    if(force!==true&&Date.now()-checkedAt<300000)return current;
    checkedAt=Date.now();
    inflight=(async()=>{
      try{
        const token=await accessToken();
        const get=async(sheet,suffix)=>{if(!validId(sheet))throw Error('INVALID_SHEETS_CONFIG');const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(sheet)+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok){if(r.status===401)tokenCache=null;throw Error('SHEETS_HTTP_'+r.status)}return r.json()};
        const checkTitle=async(sheet,requireYear)=>{const data=await get(sheet,'?fields=properties(title)');const title=String(data.properties?.title||'').toLowerCase();const years=title.match(/\b20\d{2}\b/g)||[];if(!title.includes(expected)||(years.length&&!years.includes(month.slice(0,4)))||(requireYear&&!years.includes(month.slice(0,4))))throw Error('SOURCE_MONTH_MISMATCH')};
        const values=(sheet,range)=>get(sheet,'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE');
        // Both Flash reads share a period check; the individual goal source is independent.
        const flashReady=checkTitle(id,config.requireYear===true);
        const tasks=[
          (async()=>{await flashReady;const data=await values(id,"'Dados'!A1:D");const [header,...rows]=data.values||[];if(header?.[0]!=='CODCLI'||header?.[1]!=='PRODUTO'||header?.[3]!=='VLVENDA')throw Error('INVALID_DATA_LAYOUT');const result=aggregate(rows,baseline);validateCoverage(result,current,minStores);return result})(),
          (async()=>{await flashReady;const data=await values(id,"'Metas x Realizado'!A1:ZZ997");return readOfficialGoal(data.values||[])})(),
          (async()=>{if(!gid)throw Error('GOALS_NOT_CONFIGURED');await checkTitle(gid,true);const data=await values(gid,"'Metas "+expected+"'!A1:E");return readStoreGoals(data.values||[],baseline)})()
        ];
        const [sales,official,individual]=await Promise.allSettled(tasks);
        const next={...current,month};
        if(sales.status==='fulfilled'){
          const r=sales.value,prevGoals=new Map(current.rows.map(([id,m])=>[id,m]));
          next.rows=r.rows.map(([id,m,actual])=>[id,prevGoals.get(id)??m,actual]);next.mixByStore=r.mixByStore;next.soldByStore=r.soldByStore;next.matchedIds=r.matchedIds;next.lineCount=r.lines;next.live=true;next.archived=false;next.mixStatus='ok';next.source='Flash de Vendas - aba Dados';
          const changed=JSON.stringify([next.rows.map(([id,m,a])=>[id,a]),r.soldByStore,r.matchedIds,r.lines])!==JSON.stringify([current.rows.map(([id,m,a])=>[id,a]),current.soldByStore,current.matchedIds,current.lineCount]);
          if(changed||!current.syncedAt)next.syncedAt=new Date().toISOString();
          mark('sales','ok',{month,lines:r.lines,stores:r.stores,totalCents:r.rows.reduce((n,x)=>n+x[2],0),missingStores:baseline.rows.length-r.stores});
          console.log('[mix-sync] '+JSON.stringify({status:'ok',month,stores:baseline.rows.length,positiveStores:Object.values(r.soldByStore).filter(x=>x.length).length,distinctCodes:new Set(Object.values(r.soldByStore).flat()).size}));
          console.log('[sheets-sync] '+JSON.stringify({status:'ok',month,stores:r.stores,lines:r.lines,totalCents:health.sales.totalCents,changed}));
        }else{next.mixStatus=failure('sales',sales.reason);console.log('[sheets-sync] '+JSON.stringify({month,status:next.mixStatus,code:errorCode(sales.reason)}))}
        if(official.status==='fulfilled'){
          if(next.officialGoal!==official.value||!next.goalSyncedAt)next.goalSyncedAt=new Date().toISOString();next.officialGoal=official.value;next.goalStatus='ok';mark('official','ok',{totalCents:official.value});
          console.log('[goals-sync] '+JSON.stringify({status:'ok',month,officialGoalCents:official.value}));
        }else{next.goalStatus=failure('official',official.reason);console.log('[goals-sync] '+JSON.stringify({month,status:next.goalStatus,code:errorCode(official.reason)}))}
        if(individual.status==='fulfilled'){
          const goals=individual.value,changed=next.rows.some(([id,m])=>goals.get(id)!==m);
          next.rows=next.rows.map(([id,m,a])=>[id,goals.get(id),a]);if(changed||!next.storeGoalSyncedAt)next.storeGoalSyncedAt=new Date().toISOString();next.storeGoalStatus='ok';
          const totalCents=next.rows.reduce((n,x)=>n+x[1],0);mark('individual','ok',{stores:goals.size,totalCents});
          console.log('[individual-sync] '+JSON.stringify({status:'ok',month,stores:goals.size,totalCents,differenceCents:Number.isSafeInteger(next.officialGoal)?totalCents-next.officialGoal:null}));
        }else{next.storeGoalStatus=failure('individual',individual.reason);console.log('[individual-sync] '+JSON.stringify({month,status:next.storeGoalStatus,code:errorCode(individual.reason)}))}
        current=next;
      }catch(e){
        current={...current,mixStatus:failure('sales',e),goalStatus:failure('official',e),storeGoalStatus:failure('individual',e)};
        console.log('[sheets-sync] '+JSON.stringify({month,status:'error',code:errorCode(e)}));
      }finally{inflight=null}
      return current;
    })();
    return inflight;
  };
  return {get:()=>current,health:()=>health,restore(snapshot){if(!current.live&&snapshot?.month===month){current={...snapshot,live:true,archived:true,mixStatus:'stale',goalStatus:'stale',storeGoalStatus:'stale',source:'Histórico permanente'};for(const k of ['sales','official','individual'])health[k]={status:'stale',lastSuccess:snapshot.capturedAt}}},refresh,start(){refresh();const timer=setInterval(refresh,30000);timer.unref?.()}};
}
function makeMonthSync(baseline){
  const readers=new Map([[baseline.month,makeSync(baseline)]]),ids=new Set([process.env.PRIME_SHEETS_FIRST_ID,process.env.PRIME_SHEETS_GOALS_ID].filter(Boolean));
  let registryError=null;
  try{
    const extra=JSON.parse(process.env.PRIME_MONTH_SOURCES_JSON||'[]');
    if(!Array.isArray(extra))throw Error('INVALID_MONTH_REGISTRY');
    const accepted=[];
    for(const cfg of extra){
      if(!cfg||!validMonth(cfg.month)||cfg.month===baseline.month||accepted.some(x=>x.month===cfg.month)||!validId(cfg.salesId)||!validId(cfg.goalsId)||cfg.salesId===cfg.goalsId||ids.has(cfg.salesId)||ids.has(cfg.goalsId)||!Number.isInteger(cfg.minStores??1)||(cfg.minStores??1)<1||(cfg.minStores??1)>36)throw Error('INVALID_MONTH_REGISTRY');
      ids.add(cfg.salesId);ids.add(cfg.goalsId);accepted.push(cfg);
    }
    for(const cfg of accepted)readers.set(cfg.month,makeSync({month:cfg.month,rows:baseline.rows.map(([id])=>[id,null,null])},{...cfg,minStores:cfg.minStores??1,requireYear:true}));
  }catch(e){registryError=errorCode(e);console.log('[month-registry] '+JSON.stringify({status:'error',code:registryError}))}
  const active=()=>readers.has(monthNow())?monthNow():[...readers.keys()].filter(m=>m<=monthNow()).sort().at(-1)||baseline.month;
  const refresh=async(force=false)=>{const current=active();await Promise.allSettled([...readers].filter(([m,r])=>force||m===current||!r.get().live||r.get().goalStatus!=='ok'||r.get().storeGoalStatus!=='ok').map(([,r])=>r.refresh(force)));return get()};
  const get=()=>({...readers.get(active()).get(),months:Object.fromEntries([...readers].map(([m,r])=>[m,r.get()]))});
  const health=()=>({...readers.get(active()).health(),month:active(),calendarMonth:monthNow(),configuredMonths:[...readers.keys()].sort(),registryError,months:Object.fromEntries([...readers].map(([m,r])=>[m,r.health()]))});
  return {get,health,refresh,start(){refresh();const timer=setInterval(refresh,30000);timer.unref?.()}};
}
module.exports={makeSync,makeMonthSync,aggregate,readOfficialGoal,readStoreGoals,accessToken,accessWriteToken,validateCoverage};
