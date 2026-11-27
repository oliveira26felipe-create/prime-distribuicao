(()=>{
'use strict';
const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
const branchFor=l=>window.PRIME_STOCK_IMPORT?.branches?.[String(Number(l.filial))]||null;
const position=(b)=>b?.position?b.position.slice(0,10).split('-').reverse().join('/')+' '+b.position.slice(11,16)+(b.status==='stale'?' • Última leitura válida; atualização indisponível.':''):'Posição ainda indisponível';
function stockContent(b,id){
 const v=b?.items?.[id];if(!v)return '—<br><small>Sem informação</small>';
 if(!v.compatible)return esc(fmt(v.units))+' un.<br><small>Conferir embalagem</small>';
 return '<b>'+esc(fmt(v.whole))+' CX</b><br><small>'+esc(fmt(v.units))+' un.'+(v.whole===0?' • Sem caixa completa':'')+'</small>';
}
const disclaimer='Saldo de posição, não confirmado como disponível para venda. Itens ausentes não são tratados como zero; a quantidade sugerida não é limitada automaticamente.';
const note=l=>'Posição do estoque Prime '+String(Number(l.filial)).padStart(2,'0')+': '+position(branchFor(l))+' • Fonte: Google Sheets / rotina 105. '+disclaimer;
const original=suggestionPanel;
suggestionPanel=function(a,picker,search,table){
 const l=a.find(x=>x.id===store);if(!l||!canSuggest())return original(a,picker,search,table);
 const b=branchFor(l);
 const wrapped=(heads,body)=>{
   const i=heads.indexOf('Situação');if(i<0||!heads.includes('Sugestão (CX)'))return table(heads,body);
   const next=heads.slice();next.splice(i,0,'Estoque Prime (CX)');
   return table(next,body.replace(/<td id="suggest-status-(\d+)"/g,(match,index)=>{const id=db.produtos[Number(index)]?.id||'';return '<td data-prime-stock-id="'+esc(id)+'">'+stockContent(b,id)+'</td>'+match}));
 };
 return original(a,picker,search,wrapped).replace('<p id="suggestMessage"','<p id="primeStockNote" class="sales-note">'+esc(note(l))+'</p><p id="suggestMessage"');
};
window.primeStockPanel=function(a,search,table){
 const branches=[...new Set(a.map(l=>String(Number(l.filial))))].filter(x=>['5','8'].includes(x)).sort();
 const info=window.PRIME_STOCK_IMPORT?.branches||{};
 let h='<h1>Estoque Prime</h1><section><p>Posição de estoque das filiais Prime • Google Sheets / rotina 105. Use o filtro de filial acima. '+esc(disclaimer)+'</p>';
 if(!branches.length)return h+'<p>Nenhuma filial disponível neste filtro.</p></section>';
 h+='<div class="tiles">'+branches.map(k=>{const b=info[k];return '<div class="tile">Filial '+k.padStart(2,'0')+'<b>'+esc(b?.matched??'—')+'</b><small>Produtos vinculados • '+esc(position(b))+'</small></div>'}).join('')+'</div>'+search;
 return h+table(['Código Prime','Produto',...branches.map(k=>'Filial '+k.padStart(2,'0')+' (CX / UN)')],db.produtos.map(p=>'<tr><td>'+esc(p.id)+'</td><td>'+esc(p.nome)+'</td>'+branches.map(k=>'<td>'+stockContent(info[k],p.id)+'</td>').join('')+'</tr>').join(''))+'</section>';
};
window.primeUpdateStock=function(next){
 if(!next||typeof next!=='object'||!next.branches)return;
 if(JSON.stringify(next)===JSON.stringify(window.PRIME_STOCK_IMPORT))return;
 window.PRIME_STOCK_IMPORT=next;
 if(page==='sugestao'){
   const l=allowed().find(x=>x.id===store);if(!l)return;
   const b=branchFor(l);document.querySelectorAll('[data-prime-stock-id]').forEach(td=>{td.innerHTML=stockContent(b,td.dataset.primeStockId)});
   const p=document.getElementById('primeStockNote');if(p)p.textContent=note(l);
 }else if(['estoqueprime','oportunidades'].includes(page)){render();if(query)filterRows()}
};
})();