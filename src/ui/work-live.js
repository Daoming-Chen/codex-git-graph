// Live repository projection. Read-only; all write operations remain in Git mode.
export function installWorkGraph({call}) {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data, selected, query='', filter='全部', generation=0, request=0, detail=true;
  const toggle=document.createElement('button'); toggle.id='work-mode'; toggle.textContent='Git 历史'; $('repo-name').after(toggle);
  const brand=document.createElement('strong');brand.className='work-brand';brand.textContent='WorkGraph';toggle.before(brand);
  const root=document.createElement('section');root.id='work-prototype';root.setAttribute('aria-label','仓库工作进展');
  root.innerHTML='<div class="bar work-toolbar"><strong>工作进展</strong><span class="muted" id="work-project"></span><select id="work-filter" aria-label="工作状态筛选"><option>全部</option><option>进行中</option><option>已完成</option><option>已搁置</option><option>待开始</option></select><input id="work-search" class="grow" placeholder="搜索工作与提交" aria-label="搜索工作与提交"><button id="work-reload">刷新</button><button id="work-theme">主题</button></div><div class="work-lanes bar" id="work-lanes"></div><div class="work-layout"><section class="work-list"><div class="work-row table-head"><span>轨道</span><span>工作 / 提交</span><span>状态</span><span>时间</span></div><div id="work-rows"></div></section><aside id="work-detail" aria-label="工作详情"></aside></div><div class="work-footer muted"><span id="work-count"></span><span>本地真实数据</span></div>';
  $('workspace').before(root);
  const mode=on=>{$('app').classList.toggle('work-mode',on);toggle.textContent=on?'Git 历史':'工作进展';};
  toggle.onclick=()=>mode(!$('app').classList.contains('work-mode'));
  mode(true);
  function reset() {generation++;request++;data=null;selected=null;$('work-rows').innerHTML='';$('work-detail').innerHTML='';$('work-lanes').textContent='';$('work-project').textContent='';$('work-count').textContent='读取工作记录…';}
  const time=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
  function rows() {
    const works=data.works.filter(w=>(filter==='全部'||filter===w.status)&&(!query||[w.title,w.id,w.next,...data.records.filter(r=>r.workId===w.id).map(r=>r.title)].join(' ').toLowerCase().includes(query)));
    return [...works.map(w=>({id:w.id,workId:w.id,title:w.title,current:true})),...data.records.filter(r=>works.some(w=>w.id===r.workId)).map(r=>({...r,id:r.hash}))];
  }
  function render(){
    if(!data)return;
    const list=rows(), lane=id=>data.works.findIndex(w=>w.id===id), width=Math.max(68,data.works.length*16+16);
    root.style.setProperty('--work-graph-width',width+'px');
    if(!list.some(r=>r.id===selected))selected=list[0]?.id;
    $('work-project').textContent=data.repository.name;
    $('work-lanes').innerHTML=data.works.map((w,i)=>`<span class="lane-key" style="--lane:var(--c${i%8})">${esc(w.title)}</span>`).join('');
    $('work-count').textContent=`${data.works.length} 项工作 · ${data.records.length} 个提交 · ${data.dirty.length} 个未提交文件${data.hasMore?' · 历史已截断':''}`;
    $('work-rows').innerHTML=list.map((r,n)=>{
      const i=lane(r.workId),w=data.works[i];let lines='';
      data.works.forEach((_,j)=>{const p=list.map((x,k)=>lane(x.workId)===j?k:-1).filter(k=>k>=0);if(p.length&&n>=p[0]&&n<=p.at(-1))lines+=`<path d="M${16+j*16} ${n===p[0]?16:0}V${n===p.at(-1)?16:32}" stroke="var(--c${j%8})" opacity=".5"/>`;});
      return `<button class="work-row commit-row ${r.current?'work-current':''} ${r.id===selected?'selected':''}" data-record="${esc(r.id)}" style="--row-color:var(--c${i%8})"><span class="work-graph"><svg viewBox="0 0 ${width} 32">${lines}<circle cx="${16+i*16}" cy="16" r="${r.current?4:3}" fill="var(--c${i%8})"/></svg></span><span class="work-summary"><span class="subject">${esc(r.title)}</span>${r.current?`<span class="work-row-next">${esc(w.next)}</span>`:`<span class="muted">${r.hash.slice(0,7)}</span>`}</span><span class="work-kind">${r.current?w.status:'提交'}</span><span class="date">${r.current?'':time(r.time)}</span></button>`;
    }).join('')||'<p class="notice">没有匹配的工作。</p>';
    $('work-detail').hidden=!detail;
    const r=list.find(x=>x.id===selected);
    if(!r){$('work-detail').innerHTML='';return;}
    const w=data.works[lane(r.workId)], count=data.records.filter(x=>x.workId===w.id).length;
    $('work-detail').innerHTML=`<div class="detail-bar"><strong>${esc(r.title)}</strong><span class="grow"></span>${!r.current?'<button id="work-patch">查看提交差异</button>':''}<button id="work-close">收起</button></div><div class="work-context"><section><p>${esc(w.summary)}</p><div class="work-next"><span class="muted">下一步</span><span>${esc(w.next||'—')}</span></div></section><section class="work-evidence"><p>${esc(w.status)} · ${count} 个关联提交</p><p class="muted">状态来自工作记录；提交不代表验证或用户验收。</p>${r.hash?`<p class="mono">${r.hash}</p>`:''}<details><summary>未提交文件 · ${data.dirty.length}</summary><p class="mono">${data.dirty.map(f=>esc(f.path)).join('<br>')||'工作区干净'}</p></details></section></div><pre id="work-real-patch" hidden></pre>`;
  }
  async function update(){const epoch=generation,seq=++request;try{const result=await call('work_graph');if(epoch!==generation||seq!==request)return;data=result;render();}catch(e){if(epoch===generation&&seq===request){data=null;$('work-detail').innerHTML='';$('work-lanes').textContent='';$('work-rows').textContent=e.message;$('work-count').textContent='工作记录读取失败';}}}
  root.onclick=async e=>{
    const row=e.target.closest('[data-record]');if(row){request++;selected=row.dataset.record;detail=true;render();}
    if(e.target.id==='work-close'){$('work-detail').hidden=true;detail=false;}
    if(e.target.id==='work-patch') {const id=selected,epoch=generation,seq=++request;const pane=$('work-real-patch');pane.hidden=false;pane.textContent='读取差异…';try{const result=await call('commit',{hash:id});if(epoch===generation&&seq===request&&selected===id)pane.textContent=result.patch+(result.truncated?'\n[差异已截断]':'');}catch(error){if(epoch===generation&&seq===request)pane.textContent=error.message;}}
  };
  $('work-filter').onchange=e=>{request++;filter=e.target.value;render();};$('work-search').oninput=e=>{request++;query=e.target.value.trim().toLowerCase();render();};$('work-reload').onclick=()=>update();
  $('work-theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light';};
  reset();
  return {reset,update};
}
