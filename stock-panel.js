(()=>{
'use strict';
const data=window.PRIME_STOCK_IMPORT;
function branchFor(l){return data?.branches?.[String(Number(l.filial))]||null}
function stockCell(b,p){
  const v=b?.items?.[p.id];if(!v)return '<td>—<br><small>Sem informação</small></td>';
  const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
  if(!v.compatible)return '<td>'+esc(fmt(v.units))+' un.<br><small>Conferir embalagem</small></td>';
  return '<td><b>'+esc(fmt(v.whole))+' CX</b><br><small>'+esc(fmt(v.units))+' un.'+(v.whole===0?' • Sem caixa completa':'')+'</small></td>';
}
const original=suggestionPanel;
suggestionPanel=function(a,picker,search,table){
  const l=a.find(x=>x.id===store);if(!l||!canSuggest())return original(a,picker,search,table);
  const b=branchFor(l),branch=String(Number(l.filial)).padStart(2,'0');
  const note=b?.position?'Posição do estoque Prime '+branch+': '+b.position.slice(0,10).split('-').reverse().join('/')+' '+b.position.slice(11,16)+(b.status==='stale'?' • Última leitura válida; atualização indisponível.':' • Fonte: Google Sheets / rotina 105.'):'Estoque Prime '+branch+': posição ainda indisponível.';
  const wrapped=(heads,body)=>{
    const i=heads.indexOf('Situação');if(i<0||!heads.includes('Sugestão (CX)'))return table(heads,body);
    const next=heads.slice();next.splice(i,0,'Estoque Prime (CX)');
    return table(next,body.replace(/<td id="suggest-status-(\d+)"/g,(match,index)=>stockCell(b,db.produtos[Number(index)]||{})+match));
  };
  return original(a,picker,search,wrapped).replace('<p id="suggestMessage"', '<p class="sales-note">'+esc(note)+' Saldo de posição, não confirmado como disponível para venda. Itens ausentes não são tratados como zero; a quantidade sugerida não é limitada automaticamente.</p><p id="suggestMessage"');
};
})();