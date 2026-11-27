'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const tokenUrl='https://oauth2.googleapis.com/token';
let tokenCache=null,tokenFlight=null;
async function accessToken(){
  if(tokenCache&&tokenCache.until>Date.now())return tokenCache.value;
  if(tokenFlight)return tokenFlight;
  tokenFlight=requestToken();try{return await tokenFlight}finally{tokenFlight=null}
}
async function requestToken(){
  let creds;
  try{creds=JSON.parse(fs.readFileSync('/etc/secrets/google-sheets.json','utf8'))}catch(e){throw new Error(e.code==='ENOENT'?'SECRET_FILE_MISSING':'SECRET_FILE_INVALID')}
  if(creds.type!=='service_account'||typeof creds.client_email!=='string'||typeof creds.private_key!=='string')throw new Error('INVALID_SERVICE_ACCOUNT');
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:creds.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:tokenUrl,iat:now,exp:now+3600});
  let assertion;try{assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),creds.private_key).toString('base64url')}catch{throw new Error('INVALID_PRIVATE_KEY')}
  const resp=await fetch(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!resp.ok)throw new Error('TOKEN_HTTP_'+resp.status);
  const token=await resp.json();if(typeof token.access_token!=='string')throw new Error('INVALID_TOKEN_RESPONSE');tokenCache={value:token.access_token,until:Date.now()+Math.max(0,Math.min(3300,(Number(token.expires_in)||3600)-120))*1000};return token.access_token;
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
  if(!lines||matched.size<Math.ceil(totals.size/2))throw new Error('INCOMPLETE_SALES_BASE');
  const soldByStore=Object.fromEntries([...totals].map(([id,v])=>[id,[...v.products].filter(([,n])=>n>0).map(([p])=>p).sort()]));
  return {matchedIds:[...matched].sort(),rows:[...totals].map(([id,v])=>[id,v.meta,v.actual]),mixByStore:Object.fromEntries(Object.entries(soldByStore).map(([id,p])=>[id,p.length])),soldByStore,lines,stores:matched.size};
}
function readOfficialGoal(values){
  if(values[3]?.[81]!=='TOTAL'||values[4]?.[81]!=='Faturamento'||values[5]?.[81]!=='Meta'||values[5]?.[1]!=='Cod'||values[5]?.[2]!=='EQUIPE')throw new Error('INVALID_GOAL_LAYOUT');
  const matches=values.slice(6).filter(r=>String(r[1]??'').trim()==='1001'&&String(r[2]??'').trim().toLowerCase()==='americanas');
  if(matches.length!==1)throw new Error('AMERICANAS_GOAL_ROW_MISSING_OR_DUPLICATE');
  const v=matches[0][81],cents=typeof v==='number'?Math.round(v*100):null;
  if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('INVALID_OFFICIAL_GOAL');
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
function validateCoverage(result,previous){
  // Reject a large loss of coverage or lines; no assumption that a store with no row definitely had no sale.
  if(result.stores<30)throw Error('SALES_COVERAGE_TOO_LOW');
  if(previous?.live&&Number.isInteger(previous.lineCount)&&result.lines<Math.ceil(previous.lineCount*0.8))throw Error('SUDDEN_SALES_ROW_DROP');
  if(previous?.live&&Array.isArray(previous.matchedIds)&&previous.matchedIds.filter(id=>!result.matchedIds.includes(id)).length>2)throw Error('SUDDEN_STORE_COVERAGE_DROP');
}
function makeSync(baseline){
  const id=process.env.PRIME_SHEETS_FIRST_ID;
  let current=baseline,inflight=null,checkedAt=0;
  let health={sales:{status:'pending'},official:{status:'pending'},individual:{status:'pending'}};
  function mark(k,status,extra={}){health[k]={...health[k],status,checkedAt:new Date().toISOString(),...extra,...(status==='ok'?{lastSuccess:new Date().toISOString(),error:null}:{})}}
  const refresh=async(force=false)=>{
    if(!id||!baseline)return current;
    if(inflight)return inflight;
    if(force!==true&&Date.now()-checkedAt<300000)return current;
    checkedAt=Date.now();
    inflight=(async()=>{
      try{
        if(!/^[A-Za-z0-9_-]{20,120}$/.test(id)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(baseline.month))throw new Error('INVALID_SHEETS_CONFIG');
        const token=await accessToken(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
        const get=async suffix=>{const r=await fetch(base+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw new Error('SHEETS_HTTP_'+r.status);return r.json()};
        const info=await get('?fields=properties(title)');
        const expected=monthNames[Number(baseline.month.slice(5))-1];
        const title=String(info.properties?.title||'').toLowerCase();
        if(!title.includes(expected))throw new Error('SOURCE_MONTH_MISMATCH');
        const data=await get('/values/'+encodeURIComponent("'Dados'!A1:D")+'?valueRenderOption=UNFORMATTED_VALUE');
        const [header,...rows]=data.values||[];
        if(header?.[0]!=='CODCLI'||header?.[1]!=='PRODUTO'||header?.[3]!=='VLVENDA')throw new Error('INVALID_DATA_LAYOUT');
        const result=aggregate(rows,baseline);validateCoverage(result,current);mark('sales','ok',{month:baseline.month,lines:result.lines,stores:result.stores,totalCents:result.rows.reduce((a,r)=>a+r[2],0),missingStores:36-result.stores});
        let officialGoal=current.officialGoal??null,goalSyncedAt=current.goalSyncedAt??null,goalStatus='unavailable';
        try{
          const g=await get('/values/'+encodeURIComponent("'Metas x Realizado'!A1:CD997")+'?valueRenderOption=UNFORMATTED_VALUE');
          const next=readOfficialGoal(g.values||[]);
          if(next!==officialGoal||!goalSyncedAt)goalSyncedAt=new Date().toISOString();
          officialGoal=next;goalStatus='ok';mark('official','ok',{totalCents:next});
        }catch(e){goalStatus=officialGoal===null?'unavailable':'stale';mark('official',goalStatus,{error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'});console.log('[goals-sync] '+JSON.stringify({status:goalStatus,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
        let storeGoalStatus=current.storeGoalStatus==='ok'||current.storeGoalStatus==='stale'?'stale':'unavailable',storeGoalSyncedAt=current.storeGoalSyncedAt??null;
        const previousGoals=new Map(current.rows.map(r=>[String(r[0]),r[1]]));
        result.rows=result.rows.map(([id,meta,actual])=>[id,previousGoals.get(id)??meta,actual]);
        const gid=process.env.PRIME_SHEETS_GOALS_ID;
        if(gid){
          try{
            if(!/^[A-Za-z0-9_-]{20,120}$/.test(gid))throw Error('INVALID_GOALS_ID');
            const getG=async suffix=>{const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(gid)+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw Error('GOALS_HTTP_'+r.status);return r.json()};
            const gInfo=await getG('?fields=properties(title)');
            const title=String(gInfo.properties?.title||'').toLowerCase();
            if(!title.includes(expected)||!title.includes(baseline.month.slice(0,4)))throw Error('STORE_GOAL_MONTH_MISMATCH');
            const tab='Metas '+expected;
            const g=await getG('/values/'+encodeURIComponent("'"+tab+"'!A1:E")+'?valueRenderOption=UNFORMATTED_VALUE');
            const goals=readStoreGoals(g.values||[],baseline);
            result.rows=result.rows.map(([id,meta,actual])=>[id,goals.get(id),actual]);
            if(!storeGoalSyncedAt||result.rows.some(r=>r[1]!==previousGoals.get(r[0])))storeGoalSyncedAt=new Date().toISOString();
            storeGoalStatus='ok';mark('individual','ok',{stores:goals.size,totalCents:result.rows.reduce((n,r)=>n+r[1],0)});
            console.log('[individual-sync] '+JSON.stringify({status:'ok',month:baseline.month,stores:goals.size,totalCents:result.rows.reduce((n,r)=>n+r[1],0),differenceCents:officialGoal===null?null:result.rows.reduce((n,r)=>n+r[1],0)-officialGoal}));
          }catch(e){mark('individual',storeGoalStatus,{error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'});console.log('[individual-sync] '+JSON.stringify({status:storeGoalStatus,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
        }
        const signature=JSON.stringify([result.rows,result.mixByStore,result.soldByStore,result.matchedIds,result.lines,'ok',officialGoal,goalStatus,storeGoalStatus]);
        const oldSignature=JSON.stringify([current.rows,current.mixByStore,current.soldByStore,current.matchedIds,current.lineCount,current.mixStatus??'unavailable',current.officialGoal??null,current.goalStatus??'unavailable',current.storeGoalStatus??'unavailable']);
        if(signature!==oldSignature||!current.live)current={month:baseline.month,rows:result.rows,mixByStore:result.mixByStore,soldByStore:result.soldByStore,mixStatus:'ok',matchedIds:result.matchedIds,lineCount:result.lines,live:true,source:'Flash de Vendas - aba Dados',syncedAt:new Date().toISOString(),officialGoal,goalSyncedAt,goalStatus,storeGoalStatus,storeGoalSyncedAt};
        if(goalStatus==='ok')console.log('[goals-sync] '+JSON.stringify({status:'ok',month:baseline.month,officialGoalCents:officialGoal,storeGoalSumCents:result.rows.reduce((n,r)=>n+r[1],0)}));
        console.log('[mix-sync] '+JSON.stringify({status:'ok',month:baseline.month,stores:Object.keys(result.soldByStore).length,positiveStores:Object.values(result.soldByStore).filter(p=>p.length>0).length,distinctCodes:new Set(Object.values(result.soldByStore).flat()).size}));
        console.log('[sheets-sync] '+JSON.stringify({status:'ok',month:baseline.month,stores:result.stores,lines:result.lines,totalCents:result.rows.reduce((a,r)=>a+r[2],0),changed:signature!==oldSignature}));
      }catch(e){const error=/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED';for(const k of ['sales','official','individual'])mark(k,health[k].lastSuccess?'stale':'unavailable',{error});if(current?.live)current={...current,mixStatus:'stale',goalStatus:current.officialGoal?'stale':'unavailable',storeGoalStatus:current.storeGoalSyncedAt?'stale':'unavailable'};console.log('[sheets-sync] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
      finally{inflight=null}
      return current;
    })();
    return inflight;
  };
  return {get:()=>current,health:()=>health,refresh,start(){if(!id||!baseline)return;refresh();const timer=setInterval(refresh,30000);timer.unref?.()}};
}
module.exports={makeSync,aggregate,readOfficialGoal,readStoreGoals,accessToken,validateCoverage};
