'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const password = process.env.PREVIEW_PASSWORD;
const total = Number(process.env.PREVIEW_PARTS);
const parts = Array.from({length: Number.isInteger(total) && total>0 && total<=30 ? total : 0}, (_,i)=>process.env['PREVIEW_HTML_'+i]);
const html = parts.length && parts.every(p=>typeof p==='string'&&p.length) ? parts.join('') : '';
const ready = password && password.length >= 24 && html.startsWith('<!doctype html>') && html.endsWith('</html>') && html.length===Number(process.env.PREVIEW_LENGTH);
if (!ready) { console.error('Protected preview configuration incomplete.'); process.exit(1); }
const hash = v=>crypto.createHash('sha256').update(v).digest();
const expected = hash('prime:'+password);
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store, private, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 if(req.url==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok');}
 const auth=req.headers.authorization||'';
 let valid=false;
 if(auth.startsWith('Basic ')){try{valid=crypto.timingSafeEqual(hash(Buffer.from(auth.slice(6),'base64')),expected);}catch{}}
 if(!valid){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Prime - previa restrita", charset="UTF-8"','Content-Type':'text/plain; charset=utf-8'});return res.end('Prévia restrita. Informe o usuário e a senha de acesso.');}
 if(req.url==='/' || req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:html);}
 res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');
}).listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Protected preview ready.'));
