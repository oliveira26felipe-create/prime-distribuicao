'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const password = process.env.ADMIN_PASSWORD || process.env.PREVIEW_PASSWORD;
const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
if(!/^[a-z0-9._-]{3,64}$/.test(adminUsername)){console.error('Invalid admin username.');process.exit(1);}
const total = Number(process.env.PREVIEW_PARTS);
const parts = Array.from({length:Number.isInteger(total)&&total>0&&total<=30?total:0},(_,i)=>process.env['PREVIEW_HTML_'+i]);
const html = parts.length&&parts.every(p=>typeof p==='string'&&p.length)?parts.join(''):'';
if(!(password&&password.length>=24&&html.startsWith('<!doctype html>')&&html.endsWith('</html>')&&html.length===Number(process.env.PREVIEW_LENGTH))){console.error('Protected preview configuration incomplete.');process.exit(1);}

const icon192=Buffer.from("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",'base64');
const logo=html.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/);
const icon512='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#101722"/><rect x="32" y="160" width="448" height="192" rx="16" fill="#fff"/><image href="'+(logo?logo[0]:'data:image/png;base64,'+icon192.toString('base64'))+'" x="48" y="168" width="416" height="176" preserveAspectRatio="xMidYMid meet"/></svg>';
const manifest=JSON.stringify({id:'/',name:'Prime Distribuição — Estoque',short_name:'Prime',lang:'pt-BR',start_url:'/',scope:'/',display:'standalone',background_color:'#101722',theme_color:'#101722',icons:[{src:'/app-icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/app-icon-512.svg',sizes:'512x512 any',type:'image/svg+xml',purpose:'any'}]});
const worker="self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>e.request.mode==='navigate'?new Response('Sem internet. Conecte-se para abrir a Prime.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}):Response.error()));});";
const pwaHead='<link rel="manifest" href="/app.webmanifest"><meta name="theme-color" content="#101722"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prime"><link rel="apple-touch-icon" href="/app-icon-192.png"><script src="/install.js" defer></script>';
const installJs="(()=>{let promptEvent=null;const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;const mount=()=>{if(standalone())return;const bar=document.createElement('div');bar.id='prime-pwa-install';bar.style.cssText='background:#18263a;color:#fff;border-bottom:1px solid #40516b;padding:10px 14px;display:flex;align-items:center;justify-content:center;gap:12px;font:14px Arial;flex-wrap:wrap';const label=document.createElement('span');label.textContent='Prime no celular';const btn=document.createElement('button');btn.type='button';btn.textContent='Instalar aplicativo';btn.style.cssText='background:#d32f39;border:0;color:white;border-radius:8px;padding:10px 16px;width:auto;margin:0;font-weight:bold';const guide=document.createElement('div');guide.hidden=true;guide.style.cssText='width:100%;max-width:650px;padding:10px;line-height:1.5';guide.textContent='Android: abra no Chrome, toque em ⋮ e escolha Instalar app ou Adicionar à tela inicial. iPhone: abra no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início. Não é preciso baixar ZIP.';bar.append(label,btn,guide);document.body.prepend(bar);if(document.querySelector('form[action=\"/entrar\"]')){document.body.style.gridTemplateRows='auto 1fr';bar.style.width='100%';}btn.onclick=async()=>{if(promptEvent){const p=promptEvent;promptEvent=null;await p.prompt();}else guide.hidden=!guide.hidden;};window.addEventListener('appinstalled',()=>bar.remove());};window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvent=e;});if('serviceWorker' in navigator)navigator.serviceWorker.register('/app-sw.js').catch(()=>{});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();})();";
const withPwa=source=>source.replace(/<title>/i,pwaHead+'<title>');
const publicAssets={'/app.webmanifest':['application/manifest+json; charset=utf-8',manifest],'/app-icon-192.png':['image/png',icon192],'/app-icon-512.svg':['image/svg+xml',icon512],'/app-sw.js':['application/javascript; charset=utf-8',worker],'/install.js':['application/javascript; charset=utf-8',installJs]};

const expiryHtml=source=>{const changes=[["pages.push(['estoque','Estoque']);","pages.push(['estoque','Estoque'],['validade','Validades'],['oportunidades','Oportunidades de mix'],['estoqueprime','Estoque Prime']);if(role()==='Administrador')pages.push(['integracoes','Integrações']);"],["if(page==='historico')h+=historyPanel(a);","if(page==='historico')h+=historyPanel(a);if(page==='validade')h+=primeExpiryPanel(a);if(page==='oportunidades')h+=primeMixPanel(a,picker,search,table,tr);if(page==='estoqueprime')h+=primeStockPanel(a,search,table);if(page==='integracoes')h+=primeIntegrationPanel();"],["loginScreen();</script></html>",'loginScreen();</script><script src="/validade.js"></script></html>']];for(const [a,b] of changes){if(!source.includes(a))throw Error('Preview validity integration mismatch');source=source.replace(a,b)}return source};
const fs=require('node:fs'),pathUtil=require('node:path');
const updateJs=fs.readFileSync(pathUtil.join(__dirname,'session-update.js'),'utf8');
const commercialJs=fs.readFileSync(pathUtil.join(__dirname,'commercial-summary.js'),'utf8');
const commercialImport=JSON.parse(process.env.COMMERCIAL_SUMMARY_JSON||'null');
if(commercialImport&&(!/^\d{4}-\d{2}$/.test(commercialImport.month)||!Array.isArray(commercialImport.rows)||commercialImport.rows.length!==36||new Set(commercialImport.rows.map(r=>r[0])).size!==36||commercialImport.rows.some(r=>!/^\d+$/.test(r[0])||!Number.isSafeInteger(r[1])||!Number.isSafeInteger(r[2])||r[1]<0)))throw Error('Invalid commercial import');
const sheetsSync=require('./sheets-reader.cjs').makeMonthSync(commercialImport);
const stockJs=fs.readFileSync(pathUtil.join(__dirname,'stock-panel.js'),'utf8');
const mixJs=fs.readFileSync(pathUtil.join(__dirname,'mix-panel.js'),'utf8');
const integrationJs=fs.readFileSync(pathUtil.join(__dirname,'integration-panel.js'),'utf8');
const syncHealth=()=>({sales:sheetsSync.health(),stock:stockSync.health()});
let lastManualSync=0;
const stockCatalogBlock=html.match(/"produtos"\s*:\s*(\[[\s\S]*?\])\s*,\s*"visitas"/);
const stockCatalog=new Map(stockCatalogBlock?JSON.parse(stockCatalogBlock[1]).map(p=>[String(p.id),Number(p.unc)]):[]);
const stockSync=require('./stock-reader.cjs').makeStockSync(stockCatalog);

const commercialPayload=JSON.stringify(commercialImport).replace(/</g,'\\u003c');
const commercialTag='<script>window.PRIME_COMMERCIAL_IMPORT='+commercialPayload+';</script><script src="/commercial-summary.js"></script>';
const polishJs=fs.readFileSync(pathUtil.join(__dirname,'prime-polish.js'),'utf8');
const polishCss=fs.readFileSync(pathUtil.join(__dirname,'prime-polish.css'),'utf8');
const release=crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(pathUtil.join(__dirname,'validade.js'))).update(updateJs).update(polishJs).update(polishCss).update(commercialJs).update(stockJs).update(mixJs).update(integrationJs).update(commercialPayload).update(html).digest('hex').slice(0,24);
const enhancedHtml=expiryHtml(html).replace('</style>',".goal-progress{background:#344155!important}.goal-progress>div,.goal-progress.complete>div{background:linear-gradient(90deg,#7ED957 0%,#8EEA6B 100%)!important}</style>").replace('<script src="/validade.js"></script>',commercialTag+'<script src="/validade.js"></script>').replace(/<title>/i,'<meta name="prime-release" content="'+release+'"><title>').replace('</style>',polishCss+'</style>').replace('</html>','<script src="/prime-polish.js"></script><script src="/session-update.js"></script></html>');
function liveVersion(){const v=sheetsSync.get(),stock=stockSync.get();return v?.live||stock?crypto.createHash('sha256').update(release).update(JSON.stringify([v,stock])).digest('hex').slice(0,24):release}
function liveHtml(){const v=sheetsSync.get(),stock=stockSync.get();const payload=JSON.stringify(v).replace(/</g,'\\u003c'),stockPayload=JSON.stringify(stock).replace(/</g,'\\u003c');return enhancedHtml.replace(commercialTag,()=>'<script>window.PRIME_COMMERCIAL_IMPORT='+payload+';window.PRIME_STOCK_IMPORT='+stockPayload+';window.PRIME_SYNC_HEALTH='+JSON.stringify(syncHealth()).replace(/</g,'\\u003c')+';</script><script src="/commercial-summary.js"></script><script>'+stockJs+'</script><script>'+mixJs+'</script><script>'+integrationJs+'</script>').replace('content="'+release+'"','content="'+liveVersion()+'"')}
// A apresentação utiliza a mesma autenticação e as mesmas fontes somente leitura.
function presentationHtml(source){
  return source.replace(/<title>[^<]*<\/title>/i,'<title>Prime Distribuição | Gestão Americanas</title>')
    .replace('DEMONSTRAÇÃO INTERNA • Estoques de exemplo, sem validade operacional • Alterações temporárias nesta sessão','Apresentação executiva • Balanços de exemplo e alterações temporárias; dados comerciais vinculados')
    .replace('Gestão de estoque | Americanas','Gestão Americanas')
    .replace('</style>','.prime-presentation-switch{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:8px 18px;background:#142236;color:#e0e9f5;font:13px Arial,sans-serif}.prime-presentation-switch a{color:#c5dcff;text-decoration:none;font-weight:600}.prime-presentation-switch a:hover{text-decoration:underline}.prime-presentation-switch span{margin-right:auto;color:#aebed0}@media(max-width:600px){.prime-presentation-switch{padding:8px 12px;font-size:12px}} </style>')
    .replace('<header>','<div class="prime-presentation-switch"><span>Apresentação executiva</span><a href="/">Voltar à prévia</a></div><header>');
}
function presentationLogin(error=''){
  return page(error).replace('action="/entrar"','action="/entrar?modo=final"').replace('Acesso administrativo','Gestão comercial e estoque | Americanas').replace('Ambiente de demonstração. Os registros não são sincronizados.','Apresentação para validação. Os balanços e alterações de teste não são armazenados permanentemente.').replace('</main>','<p><a style="color:#b8d6ff" href="/">Voltar à prévia</a></p></main>');
}
const hash=v=>crypto.createHash('sha256').update(v).digest();
const expected=hash(password);
const key=crypto.scryptSync(password,'prime-preview-session-v1',32);
const sign=v=>crypto.createHmac('sha256',key).update(v).digest('hex');
const safe=(a,b)=>typeof a==='string'&&typeof b==='string'&&crypto.timingSafeEqual(hash(a),hash(b));
const attempts=new Map();
const page=(error='')=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prime Distribuição | Entrar</title><style>*{box-sizing:border-box}body{margin:0;background:#0d1522;color:#e8edf5;min-height:100vh;display:grid;place-items:center;padding:20px;font:16px Arial,sans-serif}main{width:100%;max-width:410px;background:#172438;padding:30px;border:1px solid #34455d;border-radius:18px}h1{margin:0 0 4px;font-size:30px;font-style:italic}small{color:#ff7175;letter-spacing:3px}p{line-height:1.5;color:#c4cede}label{display:block;margin:16px 0 6px}input,button{display:block;width:100%;padding:14px;border-radius:9px;font:inherit}input{color:#fff;background:#101a2a;border:1px solid #64748b}button{margin-top:20px;border:none;background:#d92c35;color:#fff;font-weight:bold}aside{color:#ffb5b5;margin:10px 0}</style></head><body><main>${logo?'<img alt="Prime Distribuição" src="'+logo[0]+'" style="display:block;width:190px;max-width:100%;padding:8px;background:#fff;border-radius:9px;margin:0 auto 20px">':'<h1>PRIME</h1><small>DISTRIBUIÇÃO</small>'}<p>Acesso administrativo</p>${error?'<aside>'+error+'</aside>':''}<form method="post" action="/entrar"><label for="user">Usuário</label><input id="user" name="user" value="${adminUsername}" autocomplete="username" required><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Entrar na plataforma</button><p style="font-size:13px">Sessão mantida por 30 dias neste navegador. Encerre a sessão em dispositivos compartilhados.</p></form><p>Ambiente de demonstração. Os registros não são sincronizados.</p></main></body></html>`;
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body)};
http.createServer(async(req,res)=>{
res.setHeader('Cache-Control','no-store, private, max-age=0');
res.setHeader('X-Content-Type-Options','nosniff');
res.setHeader('Referrer-Policy','no-referrer');
res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
res.setHeader('X-Frame-Options','DENY');
res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; img-src data: blob: 'self'; font-src data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
const path=req.url.split('?')[0];
const finalMode=path==='/final'||new URL(req.url,'http://localhost').searchParams.get('modo')==='final';
const loginPage=finalMode?presentationLogin:page;
if((req.method==='GET'||req.method==='HEAD')&&Object.hasOwn(publicAssets,path)){const [type,data]=publicAssets[path];res.writeHead(200,{'Content-Type':type});return res.end(req.method==='HEAD'?undefined:data)}
if((req.method==='GET'||req.method==='HEAD')&&path==='/validade.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:require('node:fs').readFileSync(require('node:path').join(__dirname,'validade.js')))}
if((req.method==='GET'||req.method==='HEAD')&&path==='/session-update.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:updateJs)}
if((req.method==='GET'||req.method==='HEAD')&&path==='/commercial-summary.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:commercialJs)}
if((req.method==='GET'||req.method==='HEAD')&&path==='/prime-polish.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:polishJs)}
if(path==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
if(req.method==='POST'&&path==='/entrar'){
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const now=Date.now();
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  let a=attempts.get(ip)||{count:0,until:now+600000};
  if(a.count>=12)return send(res,429,loginPage('Muitas tentativas. Tente novamente mais tarde.'));
  if(attempts.size>5000&&!attempts.has(ip))return send(res,429,loginPage('Tente novamente mais tarde.'));
  let body='';try{for await(const chunk of req){body+=chunk;if(body.length>4096){return send(res,413,loginPage('Solicitação inválida.'))}}}catch{return send(res,400,loginPage('Solicitação inválida.'))}
  const f=new URLSearchParams(body);
  if((f.get('user')||'').trim().toLowerCase()!==adminUsername||!crypto.timingSafeEqual(hash(f.get('password')||''),expected)){a.count++;attempts.set(ip,a);return send(res,401,loginPage('Usuário ou senha incorretos.'))}
  attempts.delete(ip);
  const token=String(now+30*24*60*60*1000)+'.'+crypto.randomBytes(16).toString('hex');
  res.writeHead(303,{'Location':finalMode?'/final?login=1':'/?login=1','Set-Cookie':'__Host-prime_preview='+token+'.'+sign(token)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000'});return res.end();
}
if(req.method!=='GET'&&req.method!=='HEAD'&&!(req.method==='POST'&&path==='/sincronizar')){res.writeHead(405);return res.end()}
if(path==='/sair-previa'){res.writeHead(303,{'Location':finalMode?'/final':'/','Set-Cookie':'__Host-prime_preview=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});return res.end()}
if(path!=='/'&&path!=='/index.html'&&path!=='/versao'&&path!=='/final'&&path!=='/sincronizar'){res.writeHead(404);return res.end('Not found')}
const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-prime_preview='));
let valid=false;if(cookie){const val=cookie.slice('__Host-prime_preview='.length).split('.');if(val.length===3&&Number(val[0])>Date.now()&&safe(val[2],sign(val[0]+'.'+val[1])))valid=true}
if((path==='/versao'||path==='/sincronizar')&&!valid){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'AUTH_REQUIRED'}))}
if(!valid)return send(res,200,withPwa(loginPage()));
if(path==='/sincronizar'){
  const origin=req.headers.origin||'';
  if(req.method!=='POST'||origin!=='https://'+req.headers.host||!String(req.headers['content-type']||'').startsWith('application/json')){res.writeHead(403);return res.end()}
  if(Date.now()-lastManualSync<60000){res.writeHead(429);return res.end()}
  lastManualSync=Date.now();
  req.resume();
  await Promise.allSettled([sheetsSync.refresh(true),stockSync.refresh(true)]);
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({version:liveVersion(),stock:stockSync.get(),health:syncHealth()}));
}
// A consulta de versão e a abertura autenticada também verificam fontes vencidas.
// Limitar a espera evita travar a navegação durante uma indisponibilidade do Google.
let timeout;
try{await Promise.race([Promise.allSettled([sheetsSync.refresh(),stockSync.refresh()]),new Promise(resolve=>{timeout=setTimeout(resolve,7000);timeout.unref?.()})])}finally{clearTimeout(timeout)}
if(path==='/versao'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({version:liveVersion(),stock:stockSync.get(),health:syncHealth()}))}
return send(res,200,withPwa(finalMode?presentationHtml(liveHtml()):liveHtml()));
}).listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>{console.log('Protected preview ready.');sheetsSync.start();stockSync.start()});
