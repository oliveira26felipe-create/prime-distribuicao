'use strict';
const {accessToken,accessWriteToken}=require('./sheets-reader.cjs');
const {makeStockBackup}=require('./stock-backup.cjs');
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function parsePosition(values,catalog){
  const header=values.find(r=>r.some(v=>norm(v)==='qt.estoque emb.master')&&r.some(v=>norm(v)==='qt.estoque')&&r.some(v=>norm(v)==='codigo'));
  if(!header||!values.some(r=>r.some(v=>norm(v).includes('105 - posicao do estoque'))))throw Error('INVALID_STOCK_HEADER');
  const h=values.find(r=>r.some(v=>norm(v).includes('105 - posicao do estoque')));
  const stamp=h[1];
  let position;
  if(typeof stamp==='number'&&stamp>40000&&stamp<80000)position=new Date(Date.UTC(1899,11,30)+Math.round(stamp*86400000)).toISOString().slice(0,19);
  else if(typeof stamp==='string'){
    const match=stamp.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if(!match)throw Error('INVALID_STOCK_DATE');
    const [,d,m,y,h='0',min='00',sec='00']=match;
    position=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0')+'T'+h.padStart(2,'0')+':'+min+':'+sec;
    const utc=Date.parse(position+'Z');if(!Number.isFinite(utc)||new Date(utc).toISOString().slice(0,19)!==position)throw Error('INVALID_STOCK_DATE');
  }else throw Error('INVALID_STOCK_DATE');
  const reportAt=Date.parse(position+'-03:00');
  if(!Number.isFinite(reportAt)||reportAt>Date.now()+600000)throw Error('INVALID_STOCK_DATE');
  // The report's merged header is offset from the detail lines: B code, C description, D unit, E units, H master boxes.
  const found=new Map(),rowById=new Map();let total=null,mismatch=0,precision=[],footerRow=null;
  const issue=(code,detail)=>Object.assign(Error(code),{detail});
  for(const [idx,r] of values.entries()){
    if(norm(r[2])==='itens listados'&&norm(r[3]).includes('total geral')){if(footerRow!==null)throw issue('INCOMPLETE_STOCK_REPORT',{reason:'multiple_footers',rows:[footerRow,idx+1]});total=Number(r[1]);footerRow=idx+1;continue}
    if(norm(r[3])!=='unidade'||!/^\d+$/.test(String(r[1]??'').trim()))continue;
    const id=String(r[1]).trim(),units=r[4],boxes=r[7];
    if(found.has(id))throw issue('DUPLICATE_STOCK_PRODUCT',{product:id,rows:[rowById.get(id),idx+1]});
    rowById.set(id,idx+1);
    if(typeof units!=='number'||typeof boxes!=='number'||!Number.isFinite(units)||!Number.isFinite(boxes))throw issue('INVALID_STOCK_QUANTITY',{product:id,row:idx+1});
    const size=catalog.get(id);
    const compatible=Number.isFinite(size)&&size>0&&Math.abs(units-boxes*size)<=Math.max(0.02,size*0.0050001+0.005);
    if(size&&!compatible){mismatch++;if(precision.length<5)precision.push({unitPerBox:size,difference:Math.round(Math.abs(units-boxes*size)*1000)/1000,boxDecimals:Number.isInteger(boxes)?0:String(boxes).split('.')[1]?.length||0})}
    found.set(id,{units,boxes,whole:compatible?Math.max(0,Math.floor(units/size+1e-9)):null,compatible});
  }
  if(!found.size||!Number.isInteger(total)||found.size!==total||[...rowById.values()].some(n=>n>footerRow))throw issue('INCOMPLETE_STOCK_REPORT',{expected:Number.isInteger(total)?total:null,identified:found.size,footerRow});
  const items=Object.fromEntries([...found].filter(([id])=>catalog.has(id)));
  return {position,items,reported:found.size,matched:Object.keys(items).length,mismatch,precision};
}
function makeStockSync(catalog){
  const id=process.env.PRIME_SHEETS_STOCK_ID;let current=null,inflight=null,checkedAt=0;let health={'5':{status:'pending'},'8':{status:'pending'}};
  const excludedIds=new Set([id,process.env.PRIME_SHEETS_FIRST_ID,process.env.PRIME_SHEETS_GOALS_ID,process.env.PRIME_SHEETS_PRICES_ID,process.env.PRIME_SHEETS_ORDERS_ID]);
  let registryValid=true;try{const r=JSON.parse(process.env.PRIME_MONTH_SOURCES_JSON||'[]');if(!Array.isArray(r))throw Error('INVALID_MONTH_REGISTRY');for(const v of r){excludedIds.add(v.salesId);excludedIds.add(v.goalsId)}}catch{registryValid=false}
  const backup=makeStockBackup({id:registryValid?process.env.PRIME_HISTORY_ID:null,catalog,excludedIds,token:accessWriteToken});
  function mark(k,status,extra={}){health[k]={...health[k],status,checkedAt:new Date().toISOString(),...extra,...(status==='ok'?{lastSuccess:new Date().toISOString(),error:null,detail:null}:{})}}
  async function refresh(force=false){
    if(!id)return current;if(inflight)return inflight;if(force!==true&&Date.now()-checkedAt<300000)return current;
    checkedAt=Date.now();
    inflight=(async()=>{
      try{
        const saved=await backup.load();
        if(saved.size){const branches={...(current?.branches||{})};for(const [k,v] of saved){if(!branches[k]?.position||v.position>branches[k].position){const {digest,branch,...entry}=v;branches[k]=entry;health[k]={status:'stale',position:v.position,reported:v.reported,matched:v.matched,mismatch:v.mismatch,lastSuccess:v.syncedAt,error:'RESTORED_STOCK_BACKUP'}}}current={branches}}
        if(!/^[A-Za-z0-9_-]{20,120}$/.test(id))throw Error('INVALID_STOCK_ID');
        const token=await accessToken(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
        const get=async suffix=>{const r=await fetch(base+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw Error('STOCK_HTTP_'+r.status);return r.json()};
        const info=await get('?fields=properties(title),sheets(properties(title,gridProperties(rowCount,columnCount)))');
        const tabs=info.sheets.map(t=>t.properties);
        const previous=current?.branches||{},next={...previous};
        for(const branch of ['5','8']){
          try{
            const tab=tabs.filter(t=>new RegExp('^estoque\\s*0?'+branch+'$').test(norm(t.title)));
            if(tab.length!==1)throw Error('STOCK_TAB_MISSING');
            const range="'"+tab[0].title.replace(/'/g,"''")+"'!A1:K"+tab[0].gridProperties.rowCount;
            const data=await get('/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE');
            const result=parsePosition(data.values||[],catalog);
            if(next[branch]?.position&&result.position<next[branch].position)throw Error('OLDER_STOCK_POSITION');
            const prev=next[branch];
            if(result.matched<Math.ceil(catalog.size*0.5)||prev?.matched&&result.matched<Math.ceil(prev.matched*0.8))throw Error('STOCK_COVERAGE_TOO_LOW');
            mark(branch,'ok',{position:result.position,reported:result.reported,matched:result.matched,mismatch:result.mismatch});
            next[branch]={...result,status:'ok',syncedAt:prev&&JSON.stringify([prev.position,prev.items])===JSON.stringify([result.position,result.items])?prev.syncedAt:new Date().toISOString()};
            console.log('[stock-sync] '+JSON.stringify({status:'ok',branch,tab:tab[0].title,position:result.position,reported:result.reported,matched:result.matched,mismatch:result.mismatch,precision:result.precision}));
          }catch(e){next[branch]={...(next[branch]||{items:{}}),status:next[branch]?.position?'stale':'unavailable'};mark(branch,next[branch].status,{error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED',detail:e.detail||null});console.log('[stock-sync] '+JSON.stringify({status:next[branch].status,branch,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED',detail:e.detail||null}))}
        }
        if(next['5']?.status==='ok'&&next['8']?.status==='ok'&&JSON.stringify(next['5'].items)===JSON.stringify(next['8'].items)){
          for(const k of ['5','8']){next[k]={...(previous[k]||{items:{}}),status:previous[k]?.position?'stale':'unavailable'};health[k]={...health[k],status:next[k].status,error:'IDENTICAL_BRANCH_REPORTS',lastSuccess:previous[k]?.syncedAt||null};}
          console.log('[stock-sync] '+JSON.stringify({status:'error',code:'IDENTICAL_BRANCH_REPORTS'}));
        }
        current={branches:next};
        await backup.save(next);
      }catch(e){for(const k of ['5','8'])mark(k,health[k].lastSuccess?'stale':'unavailable',{error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED'});if(current)current={branches:Object.fromEntries(Object.entries(current.branches).map(([b,v])=>[b,{...v,status:v.position?'stale':'unavailable'}]))};console.log('[stock-sync] '+JSON.stringify({status:'error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CHECK_FAILED'}))}
      finally{inflight=null}
      return current;
    })();return inflight;
  }
  return {get:()=>current,health:()=>({...health,backup:backup.health()}),refresh,start(){if(!id)return;refresh();const timer=setInterval(refresh,30000);timer.unref?.()}};
}
module.exports={makeStockSync,parsePosition};
