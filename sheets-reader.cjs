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
async function inspect(id){
  if(!/^[A-Za-z0-9_-]{20,120}$/.test(id))throw new Error('INVALID_SPREADSHEET_ID');
  const token=await accessToken(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
  const get=async range=>{const r=await fetch(base+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw new Error('SHEETS_HTTP_'+r.status);return (await r.json()).values||[]};
  const header=(await get("'Dados'!A1:Y1"))[0]||[];
  const ids=new Set((JSON.parse(process.env.COMMERCIAL_SUMMARY_JSON||'null')?.rows||[]).map(r=>String(r[0])));
  if(!ids.size)throw new Error('INVALID_STORE_LIST');
  const letter=i=>String.fromCharCode(65+i),norm=s=>String(s??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  console.log('[sheets-data] '+JSON.stringify({headers:header.map((h,i)=>({col:letter(i),label:String(h??'').slice(0,100)}))}));
  const codeCols=header.map((h,i)=>({i,h:norm(h)})).filter(x=>/CLI|COD|PDV|LOJA/.test(x.h)).map(x=>x.i);
  const cols=await Promise.all(codeCols.map(async i=>{const v=await get("'Dados'!"+letter(i)+"2:"+letter(i)+"55500");return {i,matched:v.filter(r=>ids.has(String(r[0]??'').trim())).length,stores:new Set(v.filter(r=>ids.has(String(r[0]??'').trim())).map(r=>String(r[0]).trim())).size}}));
  console.log('[sheets-data] '+JSON.stringify({codeCandidates:cols.map(c=>({col:letter(c.i),matches:c.matched,stores:c.stores})),expected:ids.size}));
}
function run(){const id=process.env.PRIME_SHEETS_FIRST_ID;if(!id)return;inspect(id).catch(e=>console.log('[sheets-data] '+JSON.stringify({status:'error',code:/^(SECRET_FILE_|INVALID_|TOKEN_HTTP_|SHEETS_HTTP_)[A-Z0-9_]+$/.test(e.message)?e.message:'CONNECTION_FAILED'})))}
module.exports={run,accessToken};
