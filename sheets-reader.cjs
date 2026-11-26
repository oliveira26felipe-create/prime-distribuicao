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
        if(!current.live){
          try{
            const ids=new Set(baseline.rows.map(r=>String(r[0]))),ranges=["'Metas x Realizado'!A1:CG997","'METAS DASH'!A1:BI1000","'Flash'!A1:AO1000","'Base Jose Carlos'!A1:Z1000"];
            for(const range of ranges){
              const g=await get('/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE'),rr=g.values||[];
              const col=i=>{let x=i+1,t='';while(x){x--;t=String.fromCharCode(65+x%26)+t;x=Math.floor(x/26)}return t};
              const max=Math.max(0,...rr.map(r=>r.length)),matches=Array.from({length:max},(_,j)=>({col:col(j),stores:new Set(rr.filter(r=>ids.has(String(r[j]??'').trim())).map(r=>String(r[j]).trim())).size})).filter(x=>x.stores>=2);
              const named=rr.map((r,i)=>({r,i})).filter(({r})=>r.some(v=>typeof v==='string'&&/americanas|\bLASA\b/i.test(v))).slice(0,40).map(({r,i})=>({row:i+1,labels:r.map((v,j)=>typeof v==='string'&&/americanas|\bLASA\b/i.test(v)?{col:col(j),text:v.slice(0,75)}:null).filter(Boolean),code:typeof r[1]==='number'?r[1]:null,totalMeta:range.includes('Metas x Realizado')&&typeof r[81]==='number'?r[81]:null}));
              const headers=rr.slice(0,13).map((r,i)=>({row:i+1,columns:r.map((v,j)=>typeof v==='string'&&/^(cod|cód|cliente|loja|meta|faturamento|equipe|vendedor)/i.test(v)&&v.length<35?{col:col(j),label:v}:null).filter(Boolean)})).filter(r=>r.columns.length>0);
              console.log('[goals-source] '+JSON.stringify({range,rows:rr.length,matches,named,headers:range.includes('Metas x Realizado')?undefined:headers.slice(0,5)}));
            }
          }catch(e){console.log('[goals-source] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED'}))}
        }
        const result=aggregate(rows,baseline);
        const signature=JSON.stringify([result.rows,result.mixByStore]);
        const oldSignature=JSON.stringify([current.rows,current.mixByStore]);
        if(signature!==oldSignature||!current.live)current={month:baseline.month,rows:result.rows,mixByStore:result.mixByStore,live:true,source:'Flash de Vendas - aba Dados',syncedAt:new Date().toISOString()};
        console.log('[sheets-sync] '+JSON.stringify({status:'ok',month:baseline.month,stores:result.stores,lines:result.lines,totalCents:result.rows.reduce((a,r)=>a+r[2],0),changed:signature!==oldSignature}));
      }catch(e){console.log('[sheets-sync] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}))}
      finally{checkedAt=Date.now();inflight=null}
      return current;
    })();
    return inflight;
  };
  return {get:()=>current,refresh,start(){if(!id||!baseline)return;refresh();const timer=setInterval(refresh,300000);timer.unref?.()}};
}
module.exports={makeSync,aggregate};
