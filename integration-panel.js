(()=>{
'use strict';
let h=window.PRIME_SYNC_HEALTH||{},running=false;
const fmt=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Bahia'}):'—';
const money=n=>Number.isSafeInteger(n)?brl(n):'—';
const age=p=>p?Date.now()-Date.parse(p+'-03:00'):Infinity;
const names={SALES_COVERAGE_TOO_LOW:'Cobertura de lojas abaixo do esperado',SUDDEN_SALES_ROW_DROP:'Queda brusca na quantidade de registros',SUDDEN_STORE_COVERAGE_DROP:'Lojas desapareceram da base',STOCK_COVERAGE_TOO_LOW:'Cobertura insuficiente do catálogo',SOURCE_MONTH_MISMATCH:'Mês da fonte não corresponde ao mês configurado',INVALID_DATA_LAYOUT:'Cabeçalhos do Flash alterados',INVALID_STORE_GOAL_LAYOUT_OR_MONTH:'Estrutura ou mês das metas alterado',OLDER_STOCK_POSITION:'Posição anterior à última leitura',INCOMPLETE_STOCK_REPORT:'Relatório incompleto',MISSING_STORE_GOALS:'Metas de lojas ausentes',STOCK_TAB_MISSING:'Aba de estoque não localizada'};
function row(name,v,detail,old=false){
 const status=v?.status==='ok'?(old?'Posição antiga':'Conectado'):v?.status==='stale'?'Última leitura válida':v?.status==='unavailable'?'Indisponível':'Aguardando';
 const clr=v?.status==='ok'&&!old?'#8EEA6B':v?.status==='unavailable'?'#ff7777':'#f2c66b';
 return '<tr><td>'+esc(name)+'</td><td style="color:'+clr+'">'+esc(status)+'</td><td>'+esc(fmt(v?.checkedAt))+'</td><td>'+esc(fmt(v?.lastSuccess))+'</td><td>'+esc(detail||'—')+(v?.error?'<br><small>'+esc(names[v.error]||v.error)+'</small>':'')+'</td></tr>';
}
function body(){
 const a=h.sales||{},g=h.stock||{},s=a.sales||{},o=a.official||{},i=a.individual||{};
 return '<div class="bar"><button type="button" id="primeSyncNow" onclick="primeSyncNow()" '+(running?'disabled':'')+'>'+(running?'Consultando…':'Sincronizar agora')+'</button><small>Consultas automáticas a cada 5 minutos enquanto o servidor estiver ativo.</small></div><p id="primeSyncFeedback" role="status"></p><div class="scroll"><table><thead><tr><th>Fonte</th><th>Estado</th><th>Última tentativa</th><th>Último sucesso</th><th>Detalhes</th></tr></thead><tbody>'+
 row('Flash / mix',s,(s.month||'')+' • '+(s.lines??'—')+' registros • '+(s.stores??'—')+'/36 lojas com linhas • '+money(s.totalCents))+
 row('Meta geral',o,money(o.totalCents))+
 row('Metas individuais',i,(i.stores??'—')+'/36 lojas • '+money(i.totalCents))+
 ['5','8'].map(k=>{const v=g[k]||{};return row('Estoque '+k.padStart(2,'0'),v,(v.position||'—').replace('T',' ')+' • '+(v.matched??'—')+' SKUs • '+(v.mismatch??'—')+' divergências',age(v.position)>86400000)}).join('')+
 '</tbody></table></div><p><small>Uma consulta bem-sucedida não significa que o relatório do Winthor seja recente. Estoque com mais de 24h é sinalizado. Lojas sem linhas no Flash exigem conferência na origem. Histórico permanente, contas individuais e novas competências ainda dependem de configuração.</small></p>';
}
window.primeIntegrationPanel=()=>role()==='Administrador'?'<h1>Integrações</h1><section id="primeIntegrationBody">'+body()+'</section>':'';
window.primeUpdateHealth=next=>{if(!next)return;h=next;window.PRIME_SYNC_HEALTH=next;const node=document.getElementById('primeIntegrationBody');if(node&&page==='integracoes')node.innerHTML=body()};
window.primeSyncNow=async()=>{if(running||role()!=='Administrador')return;running=true;const node=document.getElementById('primeIntegrationBody');if(node)node.innerHTML=body();let msg='';try{const r=await fetch('/sincronizar',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});if(r.status===429){msg='Aguarde um minuto entre consultas manuais.';return}if(!r.ok)throw Error('HTTP');const d=await r.json();window.primeUpdateHealth(d.health);window.primeUpdateStock?.(d.stock);msg='Consulta concluída; confira o estado de cada fonte.'}catch{msg='Não foi possível consultar o servidor. Tente novamente.'}finally{running=false;const n=document.getElementById('primeIntegrationBody');if(n)n.innerHTML=body();const p=document.getElementById('primeSyncFeedback');if(p)p.textContent=msg}};
})();