'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {catalogFromSeed,createStore}=require('./operations-store.cjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COOKIE='__Host-prime_operational',LOGIN_COOKIE='__Host-prime_login_csrf',maxAge=8*3600;
const publicOrigin='https://prime-distribuicao-previa.onrender.com';
const cookieValue=(req,name)=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const json=(res,status,v)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(v))};
const html=(res,status,v)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(v)};
const style='*{box-sizing:border-box}body{margin:0;background:#101722;color:#edf1f7;font:15px Arial,sans-serif}header{padding:18px;background:#18263a;display:flex;align-items:center;gap:12px;flex-wrap:wrap}header b{font-size:23px;color:#fff}main{max-width:1250px;padding:16px;margin:auto}section{padding:16px;background:#18263a;border:1px solid #3b4b61;border-radius:12px;margin:12px 0}h1,h2,h3{margin:0 0 12px}p{line-height:1.5}label{display:block;margin:8px 0}input,select,textarea,button{font:inherit;color:#edf1f7;background:#121e30;border:1px solid #667890;border-radius:7px;padding:9px;max-width:100%}button{cursor:pointer;background:#d02c3b;border:0;font-weight:bold}button.secondary{background:#30445e}button:disabled{opacity:.5;cursor:default}a{color:#b8d6ff}small{color:#b5c4d6}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bar button{min-height:40px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:680px}td,th{padding:9px;border-bottom:1px solid #3d4e64;text-align:left;vertical-align:top}th{background:#22354d}td input[type=number]{width:92px}td input[type=date]{width:150px}.lots{display:grid;gap:5px}.lot{display:flex;gap:5px;flex-wrap:wrap}.warning{color:#ffda9a}.ok{color:#a5ecaa}.error{color:#ffb1b1}.tiles{display:flex;gap:12px;flex-wrap:wrap}.tile{border:1px solid #43556c;padding:12px;border-radius:9px;flex:1;min-width:150px}.tile strong{display:block;font-size:23px;margin-top:7px}#status{position:sticky;top:0;padding:10px;background:#283951;z-index:2}#status:empty{display:none}.login{max-width:420px;margin:35px auto}.login input{width:100%}nav{display:flex;gap:7px;flex-wrap:wrap}nav button{background:#30445e}nav button.active{background:#c42c39}.count{font-weight:bold}.hidden{display:none!important}@media(max-width:640px){main{padding:9px}section{padding:10px}header{padding:12px}table{min-width:560px}input,select,textarea{font-size:16px}}';
const shell=(body,title='Prime • Operacional')=>'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(title)+'</title><style>'+style+'</style></head><body>'+body+'</body></html>';
function makeOperations({seed,adminName,verifyAdmin,sign,safe,archiveId,excludedIds,token,getCommercial,getStock,getSupply,fetchFn,renderApp,renderLogin,getHealth,refreshSources,release=''}){
 const catalog=catalogFromSeed(seed);
 const store=createStore({id:archiveId,excludedIds,catalog,adminName,token,...(fetchFn?{fetchFn}:{})});
 const attempts=new Map();let lastSync=0;
 const script=fs.readFileSync(path.join(__dirname,'operations-ui.js'),'utf8');
 const originalScript=fs.readFileSync(path.join(__dirname,'operations-original.js'),'utf8');
 const login=(error='',csrf='')=>shell('<header><b>PRIME</b> Gestão Americanas • Operacional</header><main><section class="login"><h1>Acesso individual</h1><p>Ambiente operacional separado da demonstração. Registros reais somente após confirmação do servidor.</p>'+(error?'<p class="error">'+esc(error)+'</p>':'')+'<form action="/operacional/login" method="post"><input type="hidden" name="csrf" value="'+esc(csrf)+'"><label>Usuário<input name="username" autocomplete="username" required maxlength="64"></label><label>Senha<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button>Entrar</button></form><p><small>Sessão de 8 horas. Saia em dispositivos compartilhados.</small></p><a href="/">Voltar à demonstração</a></section></main>');
 const app=shell('<header><b>PRIME</b><span>Gestão Americanas • Operacional</span><span id="identity"></span><a href="/operacional/logout" id="logout">Sair</a></header><main><p id="status" role="status"></p><nav id="nav"></nav><div id="main"><section>Carregando dados autorizados…</section></div></main><script src="/operacional/ui.js"></script>');
 function claims(req){try{
  const val=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!val)return null;
  const [encoded,sig,extra]=val.split('.');if(extra||!safe(sig,sign('operations:'+encoded)))return null;
  const c=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));if(!c||!Number.isFinite(c.exp)||c.exp<=Date.now()||typeof c.username!=='string'||typeof c.version!=='string')return null;return c;
 }catch{return null}}
 function sessionCookie(c){const encoded=Buffer.from(JSON.stringify({...c,exp:Date.now()+maxAge*1000})).toString('base64url');return COOKIE+'='+encoded+'.'+sign('operations:'+encoded)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge}
 async function readBody(req,limit){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>limit)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413})}return body}
 const sameOrigin=req=>req.headers.origin===publicOrigin;
 function loginPage(res,status=200,error='',clearSession=false){
  const nonce=String(Date.now()+600000)+'.'+crypto.randomBytes(24).toString('hex'),csrf=nonce+'.'+sign('login:'+nonce);
  res.setHeader('Referrer-Policy','same-origin');
  const csrfCookie=LOGIN_COOKIE+'='+csrf+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600';
  res.setHeader('Set-Cookie',clearSession?[csrfCookie,COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']:csrfCookie);
  return html(res,status,renderLogin?renderLogin(error,csrf):login(error,csrf));
 }
 function validLogin(req,form){
  const origin=req.headers.origin,site=req.headers['sec-fetch-site'];
  if(origin&&origin!=='null'&&!sameOrigin(req))return false;
  if(site&&site!=='same-origin')return false;
  const c=cookieValue(req,LOGIN_COOKIE),v=form.get('csrf');
  if(!c||!safe(c,v))return false;
  const [exp,nonce,sig,...rest]=c.split('.');
  return rest.length===0&&/^\d{13}$/.test(exp)&&Number(exp)>Date.now()&&Number(exp)<=Date.now()+600000&&/^[0-9a-f]{48}$/.test(nonce)&&safe(sig,sign('login:'+exp+'.'+nonce));
 }
 function scopedCommercial(v,allowed){
  const a=new Set(allowed.map(l=>l.id)),out={};
  for(const [month,x] of Object.entries(v?.months||{})){const rows=(x.rows||[]).filter(r=>a.has(r[0]));out[month]={month,rows,live:!!x.live,source:x.source,mixStatus:x.mixStatus,goalStatus:x.goalStatus,storeGoalStatus:x.storeGoalStatus,syncedAt:x.syncedAt,goalSyncedAt:x.goalSyncedAt,storeGoalSyncedAt:x.storeGoalSyncedAt,officialSource:x.officialSource,capturedAt:x.capturedAt,archived:x.archived,closed:x.closed,mixByStore:Object.fromEntries(Object.entries(x.mixByStore||{}).filter(([id])=>a.has(id))),matchedIds:(x.matchedIds||[]).filter(id=>a.has(id)),soldByStore:Object.fromEntries(Object.entries(x.soldByStore||{}).filter(([id])=>a.has(id))),officialGoal:rows.length===catalog.stores.size?x.officialGoal:null}}
  return {month:v?.month,months:out};
 }
 async function viewFor(c){
  const v=await store.getState(c),branches=new Set(v.stores.map(s=>s.branch)),stock=getStock()?.branches||{},supply=getSupply?.()||null;
  const data={...v,commercial:scopedCommercial(getCommercial(),v.stores),stock:Object.fromEntries(Object.entries(stock).filter(([b])=>branches.has(b))),supply:supply?{status:supply.status,positions:supply.positions,prices:Object.fromEntries(Object.entries(supply.prices||{}).filter(([b])=>branches.has(b))),pending:Object.fromEntries(Object.entries(supply.pending||{}).filter(([id])=>v.stores.some(s=>s.id===id)))}:null};
  const version=crypto.createHash('sha256').update(release).update(JSON.stringify(data)).digest('hex').slice(0,24);
  return {...data,version,health:v.user.role==='admin'?(getHealth?.()||{}):{}};
 }
 async function handle(req,res,url){
  try{
   if(url==='/operacional/original.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(originalScript)}
   if(url==='/operacional/ui.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(script)}
   if(url==='/operacional/logout'&&req.method==='GET'){res.writeHead(303,{'Location':'/operacional','Set-Cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});return res.end()}
   if(url==='/operacional/login'&&req.method==='POST'){
    const f=new URLSearchParams(await readBody(req,4096));
    if(!validLogin(req,f)){console.log('[operations-login] '+JSON.stringify({status:'rejected',reason:'csrf_or_origin'}));return loginPage(res,403,'A página de acesso expirou ou a origem não foi confirmada. Preencha novamente.');}
    const ip=req.socket.remoteAddress+'|'+String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim(),now=Date.now();
    for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
    const a=attempts.get(ip)||{count:0,until:now+600000};if(a.count>=10||attempts.size>5000)return loginPage(res,429,'Muitas tentativas. Tente novamente mais tarde.');
    const username=(f.get('username')||'').trim().toLowerCase(),password=f.get('password')||'';
    let c=null;if(password.length<=128&&/^[a-z0-9._-]{3,64}$/.test(username)){if(username===adminName){if(verifyAdmin(password))c={username,version:'admin'}}else c=await store.authenticate(username,password)}
    if(!c){a.count++;attempts.set(ip,a);return loginPage(res,401,'Usuário ou senha incorretos.')}
    attempts.delete(ip);console.log('[operations-login] '+JSON.stringify({status:'ok'}));res.writeHead(303,{'Location':'/operacional','Set-Cookie':[sessionCookie(c),LOGIN_COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']});return res.end();
   }
   const c=claims(req);
   if((url==='/operacional'||url==='/operacional/login')&&req.method==='GET'){
    if(!c)return loginPage(res);
    try{const v=await viewFor(c);return html(res,200,renderApp?renderApp(v):app)}catch(e){if(e.status===401){return loginPage(res,200,'Sessão expirada. Entre novamente.',true)}throw e}
   }
   if(url==='/operacional/history'&&req.method==='GET'){
    if(!c)return json(res,401,{error:'AUTH_REQUIRED'});
    const offset=Number(new URL(req.url,'http://localhost').searchParams.get('offset')||0);
    return json(res,200,await store.history(c,offset));
   }
   if(url==='/operacional/api'&&req.method==='GET'){
    if(!c)return json(res,401,{error:'AUTH_REQUIRED'});
    return json(res,200,await viewFor(c));
   }
   if(url==='/operacional/sync'&&req.method==='POST'){
    if(!c)return json(res,401,{error:'AUTH_REQUIRED'});
    if(!sameOrigin(req)||!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,403,{error:'FORBIDDEN'});
    const v=await store.getState(c);if(v.user.role!=='admin')return json(res,403,{error:'FORBIDDEN'});
    if(Date.now()-lastSync<60000)return json(res,429,{error:'SYNC_RATE_LIMIT'});
    lastSync=Date.now();req.resume();await refreshSources?.();return json(res,200,await viewFor(c));
   }
   if(url==='/operacional/api'&&req.method==='POST'){
    if(!c)return json(res,401,{error:'AUTH_REQUIRED'});
    if(!sameOrigin(req)||!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,403,{error:'FORBIDDEN'});
    const body=JSON.parse(await readBody(req,60000));return json(res,200,await store.mutate(c,body));
   }
   return json(res,404,{error:'NOT_FOUND'});
  }catch(e){const code=/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'OPERATIONAL_UNAVAILABLE';if(url==='/operacional/login')return loginPage(res,e.status||503,'Serviço de acesso temporariamente indisponível.');return json(res,e.status||503,{error:code})}
 }
 return {handle,init:store.init,health:store.health};
}
module.exports={makeOperations};
