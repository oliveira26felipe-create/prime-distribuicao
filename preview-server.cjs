'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const password = process.env.PREVIEW_PASSWORD;
const total = Number(process.env.PREVIEW_PARTS);
const parts = Array.from({length:Number.isInteger(total)&&total>0&&total<=30?total:0},(_,i)=>process.env['PREVIEW_HTML_'+i]);
const html = parts.length&&parts.every(p=>typeof p==='string'&&p.length)?parts.join(''):'';
if(!(password&&password.length>=24&&html.startsWith('<!doctype html>')&&html.endsWith('</html>')&&html.length===Number(process.env.PREVIEW_LENGTH))){console.error('Protected preview configuration incomplete.');process.exit(1);}
const hash=v=>crypto.createHash('sha256').update(v).digest();
const expected=hash(password);
const key=crypto.randomBytes(32);
const sign=v=>crypto.createHmac('sha256',key).update(v).digest('hex');
const safe=(a,b)=>typeof a==='string'&&typeof b==='string'&&crypto.timingSafeEqual(hash(a),hash(b));
const attempts=new Map();
const page=(error='')=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prime Distribuição | Prévia restrita</title><style>*{box-sizing:border-box}body{margin:0;background:#0d1522;color:#e8edf5;min-height:100vh;display:grid;place-items:center;padding:20px;font:16px Arial,sans-serif}main{width:100%;max-width:410px;background:#172438;padding:30px;border:1px solid #34455d;border-radius:18px}h1{margin:0 0 4px;font-size:30px;font-style:italic}small{color:#ff7175;letter-spacing:3px}p{line-height:1.5;color:#c4cede}label{display:block;margin:16px 0 6px}input,button{display:block;width:100%;padding:14px;border-radius:9px;font:inherit}input{color:#fff;background:#101a2a;border:1px solid #64748b}button{margin-top:20px;border:none;background:#d92c35;color:#fff;font-weight:bold}aside{color:#ffb5b5;margin:10px 0}</style></head><body><main><h1>PRIME</h1><small>DISTRIBUIÇÃO</small><p>Prévia original 7.7 — acesso restrito</p>${error?'<aside>'+error+'</aside>':''}<form method="post" action="/entrar"><label for="user">Usuário</label><input id="user" name="user" value="prime" autocomplete="username" required><label for="password">Senha da prévia</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Entrar na plataforma</button></form><p>Ambiente de demonstração. Os registros não são sincronizados.</p></main></body></html>`;
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body)};
http.createServer(async(req,res)=>{
res.setHeader('Cache-Control','no-store, private, max-age=0');
res.setHeader('X-Content-Type-Options','nosniff');
res.setHeader('Referrer-Policy','no-referrer');
res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
res.setHeader('X-Frame-Options','DENY');
res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
const path=req.url.split('?')[0];
if(path==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
if(req.method==='POST'&&path==='/entrar'){
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const now=Date.now();
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  let a=attempts.get(ip)||{count:0,until:now+600000};
  if(a.count>=12)return send(res,429,page('Muitas tentativas. Tente novamente mais tarde.'));
  if(attempts.size>5000&&!attempts.has(ip))return send(res,429,page('Tente novamente mais tarde.'));
  let body='';try{for await(const chunk of req){body+=chunk;if(body.length>4096){return send(res,413,page('Solicitação inválida.'))}}}catch{return send(res,400,page('Solicitação inválida.'))}
  const f=new URLSearchParams(body);
  if(f.get('user')!=='prime'||!crypto.timingSafeEqual(hash(f.get('password')||''),expected)){a.count++;attempts.set(ip,a);return send(res,401,page('Usuário ou senha incorretos.'))}
  attempts.delete(ip);
  const token=String(now+8*60*60*1000)+'.'+crypto.randomBytes(16).toString('hex');
  res.writeHead(303,{'Location':'/','Set-Cookie':'__Host-prime_preview='+token+'.'+sign(token)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'});return res.end();
}
if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
if(path==='/sair-previa'){res.writeHead(303,{'Location':'/','Set-Cookie':'__Host-prime_preview=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});return res.end()}
if(path!=='/'&&path!=='/index.html'){res.writeHead(404);return res.end('Not found')}
const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-prime_preview='));
let valid=false;if(cookie){const val=cookie.slice('__Host-prime_preview='.length).split('.');if(val.length===3&&Number(val[0])>Date.now()&&safe(val[2],sign(val[0]+'.'+val[1])))valid=true}
if(!valid)return send(res,200,page());
return send(res,200,html);
}).listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Protected preview ready.'));
