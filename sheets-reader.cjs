'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const tokenUrl='https://oauth2.googleapis.com/token';
async function accessToken(){
  let creds;
  try{creds=JSON.parse(fs.readFileSync('/etc/secrets/google-sheets.json','utf8'))}catch(e){throw new Error(e.code==='ENOENT'?'SECRET_FILE_MISSING':'SECRET_FILE_INVALID')}
  if(creds.type!=='service_account'||typeof creds.client_email!=='string'||typeof creds.private_key!=='string')throw new Error('INVALID_SERVICE_ACCOUNT');
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:creds.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:tokenUrl,iat:now,exp:now+3600});
  let assertion;try{assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),creds.private_key).toString('base64url')}catch{throw new Error('INVALID_PRIVATE_KEY')}
  const resp=await fetch(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!resp.ok)throw new Error('TOKEN_HTTP_'+resp.status);
  const token=await resp.json();if(typeof token.access_token!=='string')throw new Error('INVALID_TOKEN_RESPONSE');return token.access_token;
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
  return {rows:[...totals].map(([id,v])=>[id,v.meta,v.actual]),mixByStore:Object.fromEntries([...totals].map(([id,v])=>[id,[...v.products.values()].filter(n=>n>0).length])),lines,stores:matched.size};
}
function readOfficialGoal(values){
  if(values[3]?.[81]!=='TOTAL'||values[4]?.[81]!=='Faturamento'||values[5]?.[81]!=='Meta'||values[5]?.[1]!=='Cod'||values[5]?.[2]!=='EQUIPE')throw new Error('INVALID_GOAL_LAYOUT');
  const matches=values.slice(6).filter(r=>String(r[1]??'').trim()==='1001'&&String(r[2]??'').trim().toLowerCase()==='americanas');
  if(matches.length!==1)throw new Error('AMERICANAS_GOAL_ROW_MISSING_OR_DUPLICATE');
  const v=matches[0][81],cents=typeof v==='number'?Math.round(v*100):null;
  if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('INVALID_OFFICIAL_GOAL');
  return cents;
}
function makeSync(baseline){
  const id=process.env.PRIME_SHEETS_FIRST_ID;
  let current=baseline,inflight=null,checkedAt=0;
  const refresh=async()=>{
    if(!id||!baseline)return current;
    if(inflight)return inflight;
    if(Date.now()-checkedAt<300000)return current;
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
        const result=aggregate(rows,baseline);
        let officialGoal=current.officialGoal??null,goalSyncedAt=current.goalSyncedAt??null,goalStatus='unavailable';
        try{
          const g=await get('/values/'+encodeURIComponent("'Metas x Realizado'!A1:CD997")+'?valueRenderOption=UNFORMATTED_VALUE');
          const next=readOfficialGoal(g.values||[]);
          if(next!==officialGoal||!goalSyncedAt)goalSyncedAt=new Date().toISOString();
          officialGoal=next;goalStatus='ok';
        }catch(e){goalStatus=officialGoal===null?'unavailable':'stale';console.log('[goals-sync] '+JSON.stringify({status:goalStatus,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
        const signature=JSON.stringify([result.rows,result.mixByStore,officialGoal,goalStatus]);
        const oldSignature=JSON.stringify([current.rows,current.mixByStore,current.officialGoal??null,current.goalStatus??'unavailable']);
        if(signature!==oldSignature||!current.live)current={month:baseline.month,rows:result.rows,mixByStore:result.mixByStore,live:true,source:'Flash de Vendas - aba Dados',syncedAt:new Date().toISOString(),officialGoal,goalSyncedAt,goalStatus};
        if(goalStatus==='ok')console.log('[goals-sync] '+JSON.stringify({status:'ok',month:baseline.month,officialGoalCents:officialGoal,storeGoalSumCents:baseline.rows.reduce((n,r)=>n+r[1],0)}));
        console.log('[sheets-sync] '+JSON.stringify({status:'ok',month:baseline.month,stores:result.stores,lines:result.lines,totalCents:result.rows.reduce((a,r)=>a+r[2],0),changed:signature!==oldSignature}));
      }catch(e){console.log('[sheets-sync] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
      finally{checkedAt=Date.now();inflight=null}
      return current;
    })();
    return inflight;
  };
  return {get:()=>current,refresh,start(){if(!id||!baseline)return;refresh();const timer=setInterval(refresh,300000);timer.unref?.()}};
}
module.exports={makeSync,aggregate,readOfficialGoal};
