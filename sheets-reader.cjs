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
  const get=async suffix=>{const r=await fetch(base+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw new Error('SHEETS_HTTP_'+r.status);return r.json()};
  const info=await get('?fields=properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount),hidden,sheetType))');
  const tabs=(info.sheets||[]).map(s=>s.properties).filter(Boolean);
  console.log('[sheets-check] '+JSON.stringify({status:'connected',title:info.properties?.title,locale:info.properties?.locale,tabs:tabs.map(t=>({gid:t.sheetId,name:t.title,hidden:!!t.hidden,rows:t.gridProperties?.rowCount,cols:t.gridProperties?.columnCount}))}));
  const words=/\b(meta|metas|realizado|realizada|faturamento|vendas?|vendido|codigo|cod|cliente|loja|filial|mes|periodo|atingimento|gap|saldo|promotor|produto|data|sku|mix|valor|cnpj|cidade|fantasia|razao|cobertura|positivacao)\b/i;
  for(const t of tabs.filter(t=>t.sheetType==='GRID'&&!t.hidden).slice(0,20)){
    const range="'"+t.title.replace(/'/g,"''")+"'!A1:AZ15";
    try{const data=await get('/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE');
    const headers=(data.values||[]).map((row,i)=>({row:i+1,columns:row.map((v,j)=>({col:j+1,label:typeof v==='string'&&v.length<=70&&!/\d{5,}/.test(v)&&words.test(v.normalize('NFD').replace(/[\u0300-\u036f]/g,''))?v:null})).filter(x=>x.label!==null)})).filter(r=>r.columns.length>=2).slice(0,5);
    console.log('[sheets-check] '+JSON.stringify({gid:t.sheetId,headerCandidates:headers}));
    }catch(e){console.log('[sheets-check] '+JSON.stringify({gid:t.sheetId,status:'header_unavailable'}))}
  }
}
function run(){const id=process.env.PRIME_SHEETS_FIRST_ID;if(!id)return;inspect(id).catch(e=>console.log('[sheets-check] '+JSON.stringify({status:'error',code:/^(SECRET_FILE_|INVALID_|TOKEN_HTTP_|SHEETS_HTTP_)[A-Z0-9_]+$/.test(e.message)?e.message:'CONNECTION_FAILED'})))}
module.exports={run,accessToken};
