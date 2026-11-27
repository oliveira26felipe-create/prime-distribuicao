(()=>{
'use strict';
function recent(months,id,branch){
 const groups=new Map();
 for(const m of Object.values(months||{})){
  for(const o of m?.orderHistory?.[id]||[]){
   if(o.branch!==String(branch))continue;
   const key=o.branch+':'+o.id+':'+o.date,prior=groups.get(key);
   if(!prior){groups.set(key,{...o,items:Object.fromEntries(Object.entries(o.items).map(([p,x])=>[p,x.slice()]))});continue}
   if(o.exit>prior.exit)prior.exit=o.exit;
   for(const [p,x] of Object.entries(o.items)){const old=prior.items[p]||[0,0];prior.items[p]=[old[0]+x[0],old[1]+x[1]]}
  }
 }
 return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.exit.localeCompare(a.exit)||b.id.localeCompare(a.id)).slice(0,3);
}
function calculate({orders,product,manual,count,pending,stock,unit,now=Date.now()}){
 const vals=orders.map(o=>o.items[product.id]?.[0]||0),cents=orders.reduce((sum,o)=>sum+(o.items[product.id]?.[1]||0),0),average=vals.length?vals.reduce((s,n)=>s+n,0)/vals.length:null;
 const size=Number(product.unc),confirmed=['units','boxes'].includes(unit),convert=confirmed&&Number.isSafeInteger(size)&&size>0?(unit==='units'?size:1):null;
 const historyTarget=convert&&orders.length>=2&&vals.some(q=>q>0)?Math.ceil(average/convert):null;
 const t=manual!==null&&manual!==undefined?manual:historyTarget;
 const gross=t!==null&&count!==null&&Number.isSafeInteger(count)&&count>=0?Math.max(0,t-count):null;
 const need=gross===null?null:Math.ceil(Math.max(0,gross-(pending===null?0:pending/size)));
 const pos=stock?.position,stamp=pos?Date.parse(pos+'-03:00'):NaN,entry=stock?.items?.[product.id];
 const available=stock?.status==='ok'&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<=86400000&&entry?.compatible===true&&Number.isSafeInteger(entry.whole)&&entry.whole>=0?entry.whole:null;
 const s=need===0?0:need!==null&&available!==null?Math.min(need,available):null;
 return {average,historyTarget,t,gross,need,available,s,historyCents:cents,orderCount:orders.length,basis:manual!=null?'manual':historyTarget!=null?'history':'unknown',pendingKnown:pending!==null};
}
const api={recent,calculate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.primeOrderModel=api;
})();
