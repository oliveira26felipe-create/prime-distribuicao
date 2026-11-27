'use strict';
// Explicit, isolated integration test. No mutation to the Operacional tab or real accounts.
const crypto=require('node:crypto'),http=require('node:http'),assert=require('node:assert/strict');
const {makeOperations}=require('./operations-http.cjs');
const origin='https://prime-distribuicao-previa.onrender.com';
async function run({seed,archiveId,excludedIds,token,renderApp}){
 let sheetId=null,server=null,checks=[],cleanup=false,stage='destination';
 const check=(x,label)=>{assert.ok(x,label);checks.push(label)};
 const title='TESTE_SINCRONIA_'+crypto.randomBytes(10).toString('hex');
 if(!/^[A-Za-z0-9_-]{20,120}$/.test(archiveId||'')||excludedIds.has(archiveId))throw Error('INVALID_TEST_DESTINATION');
 const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(archiveId);
 async function google(suffix,method='GET',body){
  const r=await fetch(base+suffix,{method,headers:{Authorization:'Bearer '+await token(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!r.ok)throw Error('TEST_SHEETS_HTTP_'+r.status);
  return r.json();
 }
 try{
  const meta=await google('?fields=properties(title),sheets(properties(sheetId,title))');
  check(meta.properties?.title==='PRIME - Histórico Americanas','arquivo correto');
  stage='temporary_tab';
  const add=await google(':batchUpdate','POST',{requests:[{addSheet:{properties:{title,gridProperties:{rowCount:30,columnCount:4}}}}]});
  const p=add.replies?.[0]?.addSheet?.properties;if(p?.title!==title||!Number.isInteger(p.sheetId))throw Error('TEST_TAB_UNCONFIRMED');sheetId=p.sheetId;
  const from=encodeURIComponent("'Operacional'!"),to=encodeURIComponent("'"+title+"'!");
  const adapter=async(url,opt)=>{
   if(!url.startsWith(base))throw Error('TEST_WRONG_DESTINATION');
   const suffix=url.slice(base.length);
   if(suffix.startsWith('?fields='))return {ok:true,json:async()=>({properties:{title:'PRIME - Histórico Americanas'},sheets:[{properties:{title:'Operacional'}}]})};
   if(!suffix.startsWith('/values/'+from))throw Error('TEST_SCOPE_VIOLATION');
   return fetch(base+suffix.replace(from,to),opt);
  };
  const adminPass=crypto.randomBytes(24).toString('hex'),pass=crypto.randomBytes(20).toString('hex');
  const key=crypto.randomBytes(32),sign=v=>crypto.createHmac('sha256',key).update(v).digest('hex'),safe=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const opts={seed,adminName:'test-admin',verifyAdmin:v=>safe(v,adminPass),sign,safe,archiveId,excludedIds,token,fetchFn:adapter,getCommercial:()=>({month:'2026-11',months:{'2026-11':{month:'2026-11',rows:seed.lojas.map(l=>[l.id,null,null]),live:false}}}),getStock:()=>({branches:{}}),getSupply:()=>null,renderApp,release:'isolated-test'};
  let app=makeOperations(opts);await app.init();check(app.health().status==='ok','armazenamento real conectado');
  server=http.createServer((req,res)=>{app.handle(req,res,req.url).catch(()=>{res.statusCode=500;res.end()})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const url='http://127.0.0.1:'+server.address().port;
  const session=(ua)=>{const jar=new Map();return async(path,method='GET',body=null,headers={})=>{
   const r=await fetch(url+path,{method,redirect:'manual',headers:{'User-Agent':ua,'Cookie':[...jar].map(([k,v])=>k+'='+v).join('; '),...(method==='POST'?{Origin:origin,'Sec-Fetch-Site':'same-origin'}:{}),...headers},...(body!==null?{body}:{}),signal:AbortSignal.timeout(20000)});
   for(const c of r.headers.getSetCookie()){const [pair]=c.split(';'),at=pair.indexOf('=');if(at>0){const k=pair.slice(0,at),v=pair.slice(at+1);if(v)jar.set(k,v);else jar.delete(k)}}
   const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{}return {status:r.status,raw,json};
  }};
  async function login(client,username,password){
   const get=await client('/operacional');const csrf=get.raw.match(/name="csrf" value="([^"]+)"/)?.[1];
   assert.ok(get.status===200&&csrf,'login form');
   const r=await client('/operacional/login','POST',new URLSearchParams({username,password,csrf}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
   check(r.status===303,'login '+username);
  }
  const request=(client,kind,data,id=crypto.randomUUID())=>client('/operacional/api','POST',JSON.stringify({id,kind,data}),{'Content-Type':'application/json'});
  const admin=session('Prime integration test admin'),mobile=session('Mozilla/5.0 (Linux; Android 15) Mobile Prime integration test'),desktop=session('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prime integration test'),outsider=session('Prime integration test outsider');
  stage='accounts';
  const tiago=seed.lojas.find(l=>l.promotor==='Tiago'),other=seed.lojas.find(l=>l.promotor!=='Tiago'),prod=seed.produtos[0];
  assert.ok(tiago&&other&&prod);
  await login(admin,'test-admin',adminPass);
  for(const [username,profile] of [['tiago',tiago.promotor],['leonir','Leonir'],['outro',other.promotor]]){
   const r=await request(admin,'account',{username,profile,password:pass,enabled:true});check(r.status===200&&r.json.ok,'conta de teste '+username);
  }
  await login(mobile,'tiago',pass);await login(desktop,'leonir',pass);await login(outsider,'outro',pass);
  stage='balance';
  const before=await desktop('/operacional/api');check(before.status===200&&before.json.user.role==='chief'&&before.json.stores.length===36&&before.json.balances.length===0,'Leonir antes do envio');
  const prom=await mobile('/operacional/api');check(prom.status===200&&prom.json.user.role==='promoter'&&prom.json.stores.every(l=>l.promoter==='Tiago'),'escopo promotor');
  const data={store:tiago.id,items:{[prod.id]:{qty:5,lots:[{date:'2027-02-15',qty:3}]}},note:'TESTE ISOLADO - NÃO É ESTOQUE REAL'};
  const eventId=crypto.randomUUID();const saved=await request(mobile,'balance',data,eventId);
  check(saved.status===200&&saved.json.ok===true&&saved.json.id===eventId,'gravação confirmada');
  const after=await desktop('/operacional/api'),record=after.json?.balances?.find(b=>b.id===eventId);
  check(after.status===200&&record?.store===tiago.id&&record.author==='Tiago'&&record.items[prod.id].qty===5&&record.items[prod.id].lots[0].qty===3&&record.note===data.note&&record.at===saved.json.at,'Leonir recebe quantidade validade autor observação e horário');
  check(after.json.latest[tiago.id][prod.id].qty===5,'estoque disponível para reposição');
  const forbidden=await request(mobile,'balance',{...data,store:other.id});check(forbidden.status===403,'bloqueio de gravação em outra loja');
  const otherRead=await outsider('/operacional/api');check(otherRead.status===200&&!otherRead.json.balances.some(b=>b.id===eventId),'outro promotor não visualiza');
  const retry=await request(mobile,'balance',data,eventId);check(retry.status===200&&retry.json.duplicate===true,'reenvio sem duplicar');
  stage='restart';
  app=makeOperations(opts);await app.init();
  const recovered=await desktop('/operacional/api');check(recovered.status===200&&recovered.json.balances.filter(b=>b.id===eventId).length===1&&recovered.json.latest[tiago.id][prod.id].qty===5,'persistência após reinício do serviço de dados');
  if(renderApp){const page=await desktop('/operacional');check(page.status===200&&page.raw.includes(eventId)&&page.raw.includes('PRIME_OPERATIONAL')&&page.raw.includes('/operacional/original.js'),'layout original recebe balanço real do teste')}
  stage='complete';
  return {status:'ok',checks,store:tiago.id,product:prod.id,quantity:5,validityQuantity:3,validity:'2027-02-15'};
 }finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  if(sheetId!==null){try{const m=await google('?fields=sheets(properties(sheetId,title))');const own=m.sheets?.find(x=>x.properties.sheetId===sheetId&&x.properties.title===title);if(!own)throw Error('TEST_TAB_ID_MISMATCH');await google(':batchUpdate','POST',{requests:[{deleteSheet:{sheetId}}]});const end=await google('?fields=sheets(properties(sheetId,title))');cleanup=!end.sheets?.some(x=>x.properties.sheetId===sheetId||x.properties.title===title)}catch{cleanup=false}}
  console.log('[balance-integration-cleanup] '+JSON.stringify({stage,cleanup,checks:checks.length}));
  if(sheetId!==null&&!cleanup)throw Error('TEST_CLEANUP_UNCONFIRMED');
 }
}
module.exports={run};
