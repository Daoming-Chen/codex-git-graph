// Git Graph workflow controls. The graph remains the owner of selection and layout.
export function installFeatures(ctx) {
  const {state,$,esc,call,menu,closeMenu,refresh,showDetail,selectFile,notify,active,renderHistory}=ctx;
  const button=(label,op,data={})=>`<button data-feature="${op}" data-args="${esc(JSON.stringify(data))}">${esc(label)}</button>`;
  const field=(name,label,value='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
  const check=(name,label,checked=false)=>`<label class="check-label"><input type="checkbox" name="${name}" ${checked?'checked':''}>${esc(label)}</label>`;
  const select=(name,label,values,value)=>`<label>${esc(label)}<select name="${name}">${values.map(v=>{const [key,text]=Array.isArray(v)?v:[v,v];return `<option value="${esc(key)}" ${key===value?'selected':''}>${esc(text)}</option>`;}).join('')}</select></label>`;
    let preferences={config:{},reviews:{}},preferencesRepo=null,preferenceLoading=null,preferenceWrites=Promise.resolve();
  const config=()=>preferencesRepo===state.repositoryPath?preferences.config:{};
  async function loadPreferences(){
    if(preferencesRepo===state.repositoryPath)return;
    if(preferenceLoading)return preferenceLoading;
    const repo=state.repositoryPath;
    preferenceLoading=call('preferences').then(value=>{if(repo===state.repositoryPath){preferences=value;preferencesRepo=repo;applyColumnWidths();renderHistory();decorateFiles();}}).finally(()=>{preferenceLoading=null;});
    return preferenceLoading;
  }
  function persist(input){const repo=state.repositoryPath;const promise=preferenceWrites.catch(()=>{}).then(()=>{if(repo!==state.repositoryPath)throw new Error('仓库已切换，请重新保存。');return call('save_preferences',{input});});preferenceWrites=promise;return promise;}
  const saveConfig=async value=>{await loadPreferences();await persist({config:value});preferences.config=value;applyColumnWidths();};
  let filters={}, metadata=null, metadataRepo=null, formSpec=null, preparation=null, busy=false;
  const dialog=document.createElement('dialog');dialog.id='workflow-dialog';
  dialog.innerHTML='<form id="workflow-form"><h2 id="workflow-title"></h2><div id="workflow-fields"></div><p id="workflow-error" role="alert"></p><pre id="workflow-preview" hidden></pre><div class="dialog-actions"><button type="button" id="workflow-cancel">取消</button><button id="workflow-submit" type="submit">检查操作</button></div></form>';
  document.body.append(dialog);
  $('workflow-cancel').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  const remotes=()=>metadata?.remotes?.map(r=>r.name)||[];
  const branchName=()=>active()?.branch?.replace('refs/heads/','')||'';
  const remoteField=()=>select('remote','远程仓库',remotes());
  const targetField=(value='')=>select('ref','目标引用',state.data.refs.filter(r=>!r.symbolic&&r.type!=='stash').map(r=>[r.name,r.shortName]),value);
  async function info(){const repo=state.repositoryPath;const result=await call('repository_info');if(repo===state.repositoryPath){metadata=result;metadataRepo=repo;}return result;}
  async function openForm(title,fields,spec) {
    if($('menu').open)closeMenu();
    formSpec=spec;preparation=null;$('workflow-title').textContent=title;$('workflow-fields').innerHTML=fields;
    $('workflow-error').textContent='';$('workflow-preview').hidden=true;$('workflow-submit').textContent=spec.save?'保存':'检查操作';
    dialog.showModal();dialog.querySelector('input,select,button')?.focus();
  }
  function worktreePayload(){const w=active();if(!w||w.bare||w.prunable||w.error)throw new Error('请先选择可用的操作工作区。');return {worktreePath:w.path};}
  const danger=message=>`<p class="notice danger">${esc(message)}</p>${check('confirm','我已核对对象并确认执行')}`;
  const operationLabels={merge:'合并',rebase:'变基','cherry-pick':'拣选提交',revert:'还原提交',reset:'重置分支',drop:'删除提交',checkout:'检出提交',track:'创建跟踪分支',fetch:'获取远程更新',pull:'拉取',push:'推送','branch-rename':'重命名分支','branch-delete':'删除分支','tag-add':'创建标签','tag-delete':'删除标签','tag-push':'推送标签','remote-add':'添加远程仓库','remote-edit':'修改远程仓库','remote-remove':'删除远程仓库','remote-prune':'清理失效远程引用','stash-create':'保存 Stash','stash-apply':'应用 Stash','stash-pop':'弹出 Stash','stash-drop':'删除 Stash','stash-branch':'从 Stash 创建分支',discard:'丢弃文件修改',clean:'删除未跟踪文件','stage-resolved':'标记冲突已解决',continue:'继续 Git 操作',abort:'中止 Git 操作'};
  async function action(op,args={}) {
    if(metadataRepo!==state.repositoryPath||['fetch','pull','push','tag-push'].includes(op))await info();
    const {reviewVersion,...actionArgs}=args;
    let fields='',payload={...actionArgs};
    const workspaceActions=['pull','push','checkout','track','merge','rebase','cherry-pick','revert','reset','drop','stash-create','stash-apply','stash-pop','stash-drop','stash-branch','discard','clean','stage-resolved','continue','abort'];
    if(workspaceActions.includes(op))payload={...worktreePayload(),...payload};
    if(payload.worktreePath)fields+=`<p class="path">操作工作区：${esc(payload.worktreePath)}</p>`;
    if(op==='fetch')fields+=select('remote','远程仓库',[['','所有远程仓库'],...remotes()],args.remote||'')+check('prune','同时清理失效的远程跟踪引用');
    if(op==='pull')fields+=remoteField()+field('name','远程分支',branchName())+select('mode','整合方式',[['ff-only','仅快进'],['merge','合并'],['rebase','变基']]);
    if(op==='push')fields+=remoteField()+field('name','本地及远程分支',branchName())+check('setUpstream','设置为上游分支');
    if(['remote-add','remote-edit'].includes(op))fields+=field('name','远程名称',args.name||'origin')+field('url',op==='remote-edit'?'新 URL（原 URL 不预填）':'URL（SSH、HTTPS 或本地仓库路径）','');
    if(['remote-remove','remote-prune','remote-branch-delete'].includes(op))fields+=danger(`${operationLabels[op]||'删除远程分支'}：${args.name}`);
    if(op==='branch-rename')fields+=field('newName','新分支名',args.name);
    if(op==='branch-delete')fields+=check('force','允许删除尚未合并的分支')+danger(`删除本地分支 ${args.name}。不会删除远程分支。`);
    if(op==='tag-add')fields+=field('name','标签名')+field('message','附注内容（留空创建轻量标签）')+check('signed','签名标签（使用本机 Git 配置）');
    if(op==='tag-delete')fields+=danger(`删除本地标签 ${args.name}。`);
    if(op==='tag-push')fields+=remoteField();
    if(op==='checkout')fields+='<p>将进入 detached HEAD 状态；可随后创建分支保存工作。</p>';
    if(op==='track')fields+=field('name','新本地分支名',args.remoteBranch?.replace(/^refs\/remotes\/[^/]+\//,''));
    if(['merge','rebase','cherry-pick','revert','reset','drop'].includes(op)){
      fields+=args.ref?`<p class="mono path">目标：${esc(args.ref)}</p>`:targetField();
      if(op==='merge')fields+=select('ffMode','合并方式',[['ff','允许快进'],['no-ff','创建合并提交'],['ff-only','仅快进']]);
      if(['cherry-pick','revert'].includes(op))fields+=field('mainline','合并提交的主线父编号（普通提交留空）','','number')+check('noCommit','仅应用改动，稍后提交');
      if(op==='reset')fields+=select('mode','重置方式',[['soft','soft：保留暂存及文件'],['mixed','mixed：取消暂存，保留文件'],['hard','hard：重置暂存及跟踪文件']]);
      if(['rebase','reset','drop'].includes(op))fields+=danger(op==='drop'?'删除此提交并重放其后的线性历史。提交中的改动会移除，后续提交 SHA 会变化；不支持根提交或包含合并的复杂链。':op==='rebase'?'此操作会重放当前分支的提交并改变提交 SHA。':'此操作会移动分支；hard 会丢弃跟踪文件改动，mixed 会取消暂存。');
    }
    if(op==='stash-create')fields+=field('message','说明')+check('includeUntracked','包含未跟踪文件')+check('keepIndex','保留已暂存改动');
    if(['stash-apply','stash-pop'].includes(op))fields+=check('reinstateIndex','同时恢复暂存状态');
    if(op==='stash-drop')fields+=danger(`删除 Stash ${args.stash?.slice(0,12)}。`);
    if(op==='stash-branch')fields+=field('name','新分支名');
    if(['discard','clean','stage-resolved'].includes(op))fields+=`<ul>${(args.paths||[]).map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`;
    if(op==='discard')fields+=select('scope','丢弃范围',[['working','仅未暂存修改（恢复到 index）'],['all','全部修改（恢复到 HEAD）']])+danger('所选范围的文件修改将丢失。');
    if(op==='clean')fields+=danger('只删除上面列出的未跟踪文件；删除后不能通过 Git 恢复。');
    if(op==='stage-resolved')fields+='<p>请先在编辑器中处理冲突内容，再将这些文件标记为已解决。</p>';
    if(op==='abort')fields+=danger(`中止 ${args.operation}，恢复操作开始前的 Git 状态。`);
    if(op==='continue')fields+=`<p>继续 ${esc(args.operation)}。请先解决并暂存冲突文件。</p>`;
    if(args.name&& !['remote-add','remote-edit'].includes(op))fields=`<p class="path">对象：${esc(args.name)}</p>`+fields;
    await openForm(operationLabels[op]||op,fields,{op,payload,expectedVersion:reviewVersion});
  }
  $('workflow-form').oninput=()=>{preparation=null;$('workflow-preview').hidden=true;$('workflow-submit').textContent=formSpec?.save?'保存':'检查操作';};
  $('workflow-form').onsubmit=async e=>{
    e.preventDefault();if(busy||state.pending)return;busy=true;state.pending=true;$('workflow-cancel').disabled=true;$('workflow-submit').disabled=true;$('workflow-error').textContent='';
    try{
      const form=e.target,values=Object.fromEntries(new FormData(form));
      form.querySelectorAll('input[type=checkbox][name]').forEach(el=>values[el.name]=el.checked);
      if(formSpec.save){await formSpec.save(values,form);dialog.close();return;}
      if(!preparation){
        if('mainline'in values){if(values.mainline==='')delete values.mainline;else values.mainline=Number(values.mainline);}
        for(const key of ['message','remote'])if(values[key]==='')delete values[key];
        const payload={...formSpec.payload,...values};
        if('confirm'in values&&!values.confirm)throw new Error('请先核对对象并勾选确认。');
        const version=formSpec.expectedVersion||(payload.worktreePath?(await call('files',{input:{worktreePath:payload.worktreePath}})).version:undefined);
        preparation=await call('prepare',{action:formSpec.op,payload,expectedVersion:version});
        const labels={worktreePath:'工作区',ref:'目标提交／引用',hash:'提交',start:'起点',name:'名称',newName:'新名称',remote:'远程仓库',url:'URL',paths:'文件',stash:'Stash',mode:'方式',scope:'范围',operation:'进行中的操作',message:'说明',remoteBranch:'远程分支',mainline:'主线父提交',ffMode:'合并方式',prune:'清理失效引用',force:'允许删除未合并分支',signed:'签名',includeUntracked:'包含未跟踪文件',keepIndex:'保留暂存',reinstateIndex:'恢复暂存',noCommit:'仅应用不提交',setUpstream:'设置上游'};
        $('workflow-preview').textContent=Object.entries(payload).filter(([k])=>k!=='confirm').map(([k,v])=>`${labels[k]||k}：${Array.isArray(v)?v.join('\n  '):typeof v==='boolean'?(v?'是':'否'):v}`).join('\n');$('workflow-preview').hidden=false;$('workflow-submit').textContent='确认执行';
      }else{
        const result=await call('execute',{actionId:preparation.actionId,operationId:crypto.randomUUID()});
        preparation=null;metadataRepo=null;
        await refresh();
        if(result.state!=='completed'){
          $('workflow-error').textContent=(result.error||'操作未完成')+'\n请检查当前工作区；如有冲突，可从工作区菜单继续或中止。';
          $('workflow-preview').textContent=JSON.stringify(result,null,2);$('workflow-submit').textContent='重新检查';
        }else{dialog.close();notify(`${operationLabels[formSpec.op]}完成。`);}
      }
    }catch(error){preparation=null;$('workflow-error').textContent=error.message;$('workflow-submit').textContent=formSpec?.save?'保存':'检查操作';}
    finally{busy=false;state.pending=false;$('workflow-cancel').disabled=false;$('workflow-submit').disabled=false;ctx.filesRender();if(state.detail?.kind==='worktree'&&!state.detail.comparison)ctx.commitRender();}
  };
  async function stashes(){const data=await info();menu('<h2>Stash</h2>'+button('保存当前工作区','stash-create')+(data.stashes||[]).map(s=>`<div class="menu-row"><strong>${esc(s.message||s.subject||s.ref)}</strong><p class="mono">${esc(s.ref)} · ${esc(s.hash?.slice(0,12))}</p>${button('查看差异','stash-view',{hash:s.hash})}${['apply','pop','branch','drop'].map(a=>button({apply:'应用',pop:'弹出',branch:'创建分支',drop:'删除'}[a],'stash-'+a,{stash:s.hash})).join('')}</div>`).join(''));}
  async function remoteMenu(){const data=await info();menu('<h2>远程仓库</h2>'+button('添加远程仓库','remote-add')+(data.remotes||[]).map(r=>`<div class="menu-row"><strong>${esc(r.name)}</strong><p class="path">${esc(r.fetchUrl||r.url)}${r.pushUrl&&r.pushUrl!==r.fetchUrl?'<br>推送：'+esc(r.pushUrl):''}</p>${button('获取更新','fetch',{remote:r.name})}${button('修改','remote-edit',{name:r.name,url:r.fetchUrl||r.url})}${button('Prune','remote-prune',{name:r.name})}${button('删除','remote-remove',{name:r.name})}</div>`).join(''));}
  async function filterMenu(){
    const refs=state.data.refs.filter(r=>!r.symbolic&&r.type!=='stash');
    await openForm('历史筛选',`<p>选择多个引用时显示这些引用可达的全部历史；不选则显示全部。</p><div class="ref-checks">${refs.map(r=>check('refs:'+r.name,r.shortName,filters.scopes?.includes(r.name))).join('')}</div>`+field('branchGlob','分支通配符（例如 heads/feature/*）',filters.branchGlob||'')+check('firstParent','只沿第一父提交浏览',filters.firstParent)+check('includeReflogs','包含仅存在于 reflog 的提交',filters.includeReflogs)+check('showRemotes','显示远程引用',filters.showRemotes!==false)+check('showTags','显示标签',filters.showTags!==false)+check('showStashes','显示 Stash',filters.showStashes!==false),{save:async(values)=>{
      filters={scopes:Object.entries(values).filter(([k,v])=>k.startsWith('refs:')&&v).map(([k])=>k.slice(5)),branchGlob:values.branchGlob,firstParent:values.firstParent,includeReflogs:values.includeReflogs,showRemotes:values.showRemotes,showTags:values.showTags,showStashes:values.showStashes};state.scope='';state.limit=300;await refresh();
    }});
  }
  async function settings(){
    await loadPreferences();
    const c=config();
    await openForm('仓库设置',field('issueUrl','Issue URL 模板（{id} 为问题编号）',c.issueUrl||'')+field('prUrl','创建 PR／MR URL 模板（{branch} 为当前分支）',c.prUrl||'')+select('dateFormat','日期显示',[['short','月／日'],['full','完整日期时间'],['relative','相对时间']],c.dateFormat||'short')+check('autoLoad','滚动到底部继续加载',c.autoLoad)+check('fileTree','按目录组织变更文件',c.fileTree)+`<p>链接只在点击时打开。配置保存在此浏览器，可导出后分享给同一仓库的成员。</p>`,{save:async values=>{
      for(const key of ['issueUrl','prUrl'])if(values[key])safeUrl(values[key].replaceAll('{id}','1').replaceAll('{branch}','main'));
      await saveConfig({...c,...values});renderHistory();if(state.detailInput)await showDetail(state.detailInput);
    }});
  }
  function safeUrl(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw new Error('链接仅支持 HTTP 或 HTTPS。');return url.href;}
  function openUrl(value){window.open(safeUrl(value),'_blank','noopener,noreferrer');}
  function exportConfig(){const blob=new Blob([JSON.stringify(config(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='git-graph-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function importConfig(){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const file=input.files[0];if(!file||file.size>65536)throw new Error('配置文件不能超过 64 KiB。');const value=JSON.parse(await file.text());const allowed=['issueUrl','prUrl','dateFormat','autoLoad','fileTree','columnWidths'];if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('配置字段无效。');for(const key of ['issueUrl','prUrl']){if(key in value&&typeof value[key]!=='string')throw new Error('URL 模板必须是文本。');}for(const key of ['issueUrl','prUrl'])if(value[key])safeUrl(value[key].replaceAll('{id}','1').replaceAll('{branch}','main'));if(value.dateFormat&&!['short','full','relative'].includes(value.dateFormat))throw new Error('日期格式无效。');for(const key of ['autoLoad','fileTree'])if(key in value&&typeof value[key]!=='boolean')throw new Error('配置类型无效。');await saveConfig(value);notify('仓库配置已导入。');renderHistory();}catch(e){notify(e.message);}};input.click();}
  const reviewKey=()=>`${state.detail?.a||'root'}:${state.detail?.b||'root'}`;
  function review(){return preferences.reviews[reviewKey()]||{active:false,files:[]};}
  function saveReview(value){const key=reviewKey(),record={active:value.active,files:value.files};preferences.reviews[key]={...record,updatedAt:Date.now()};void persist({review:{key,...record}}).catch(e=>notify('审阅进度未保存：'+e.message));}
  function markReviewed(id){if(state.detail?.kind!=='commit')return;const r=review();if(r.active&&!r.files.includes(id)){r.files.push(id);saveReview(r);}decorateFiles();}
  function decorateFiles(){if(state.detail?.kind!=='commit')return;const r=review();$('files').querySelectorAll('[data-file]').forEach(el=>{const done=r.active&&r.files.includes(el.dataset.file);el.classList.toggle('review-needed',r.active&&!done);el.classList.toggle('review-done',done);});const b=$('review-toggle');if(b)b.textContent=r.active?`结束审阅 · ${state.detail.files.filter(f=>r.files.includes(f.id)).length}/${state.detail.files.length}`:'开始审阅';}
  async function fileView(revision){const d=state.detail;if(!state.file||!d)return;const result=await call('file_content',{input:{...state.detailInput,fileId:state.file,revision,version:d.version}});menu(`<h2>${esc(result.path||state.file)}</h2><p>${esc(revision==='current'?'当前文件':revision==='before'?'修改前':'修改后')}${result.truncated?' · 仅显示前 256 KiB':''}</p>${result.binary?'<p>二进制文件无法显示文本。</p>':`<pre class="file-content">${esc(result.text)}</pre>`}`);}
  async function commitMetadata(hash){const d=await call('commit_info',{hash}),statuses={G:'有效签名',B:'无效签名',U:'签名有效，信任未知',X:'签名已过期',Y:'签名密钥已过期',R:'签名密钥已撤销',E:'无法验证签名',N:'未签名'};menu(`<h2>提交信息</h2><p class="mono path">${esc(d.hash)}</p><p>作者：${esc(d.author.name)} &lt;${esc(d.author.email)}&gt; · ${esc(d.author.date)}</p><p>提交者：${esc(d.committer.name)} · ${esc(d.committer.date)}</p><p>签名：${esc(statuses[d.signature.status]||d.signature.status)} ${esc(d.signature.signer)} ${esc(d.signature.key)}</p><p>${d.includedInHead?'包含在仓库 HEAD 中':'不包含在仓库 HEAD 中'}</p><h3>包含此提交的分支</h3><pre class="path">${esc(d.branches.join('\n')||'无')}</pre><h3>包含此提交的标签</h3><pre class="path">${esc(d.tags.join('\n')||'无')}</pre>`);}
  async function tagMetadata(ref){const d=await call('ref_info',{ref});menu(`<h2>标签详情</h2><p>${esc(d.ref)}</p><p>${d.annotated?'附注标签':'轻量标签'}</p>${d.annotated?`<p>${esc(d.tagger)} &lt;${esc(d.email)}&gt; · ${esc(d.date)}</p><pre class="path">${esc(d.message)}</pre>`:''}<p class="mono">${esc(d.hash)}</p>`);}
  async function compareWorking(hash){const w=worktreePayload();state.compare={a:hash,working:true};await showDetail({...w,a:hash});}
  function fileMenu(id){const f=state.detail.files.find(f=>f.id===id);if(!f)return;state.file=id;const target={paths:[f.path],worktreePath:state.detail.path,reviewVersion:state.detail.version};let html=`<h2>${esc(f.path)}</h2>`+button('复制路径','copy-path',{path:f.path})+button('查看当前文件','file-current');if(state.detail.kind==='commit'||state.detail.comparison)html+=button('查看修改前','file-before')+button('查看修改后','file-after');if(state.detail.kind==='worktree'&&!state.detail.comparison){if(f.group==='untracked')html+=button('删除此未跟踪文件','clean',target);else if(f.group==='conflict')html+=button('标记为已解决','stage-resolved',target);else html+=button('丢弃修改','discard',target);}menu(html);}
  async function handle(op,args){
    if(op==='sync-menu')return menu('<h2>同步</h2>'+button('Fetch · 获取','fetch')+button('Pull · 拉取','pull')+button('Push · 推送','push'));
    if(op==='file-menu')return fileMenu(args.id);
    if(op==='stashes')return stashes();if(op==='remotes')return remoteMenu();if(op==='filters')return filterMenu();if(op==='settings')return settings();
    if(op==='export-config')return exportConfig();if(op==='import-config')return importConfig();
    if(op==='stash-view'){closeMenu();return showDetail({hash:args.hash});}
    if(op==='commit-info')return commitMetadata(args.hash);if(op==='tag-info')return tagMetadata(args.ref);
    if(op==='compare-working'){closeMenu();return compareWorking(args.hash);}
    if(op.startsWith('file-'))return fileView(op.slice(5));
    if(op==='copy-path'||op==='copy-ref'){await navigator.clipboard.writeText(args.path||args.ref);notify('已复制。');return;}
    if(op==='create-pr'){const c=config();if(!c.prUrl)throw new Error('请先在仓库设置中配置 PR／MR URL 模板。');return openUrl(c.prUrl.replaceAll('{branch}',encodeURIComponent(args.branch||branchName())));}
    return action(op,args);
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-feature]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();Promise.resolve(handle(b.dataset.feature,JSON.parse(b.dataset.args||'{}'))).catch(error=>notify(error.message));},true);
  $('files').addEventListener('contextmenu',e=>{const b=e.target.closest('[data-file]');if(b){e.preventDefault();fileMenu(b.dataset.file);}});
  $('detail-tabs').addEventListener('click',e=>{if(e.target.id==='review-toggle'){const r=review();saveReview({...r,active:!r.active});decorateFiles();}if(e.target.id==='review-reset'){saveReview({active:true,files:[]});decorateFiles();}});
  $('more').addEventListener('click',()=>{$('menu-content').insertAdjacentHTML('beforeend','<hr>'+button('远程仓库','remotes')+button('Stash','stashes')+button('历史筛选','filters')+button('仓库设置','settings')+button('导出仓库配置','export-config')+button('导入仓库配置','import-config'));});
  const header=$('refresh').parentElement;header.insertAdjacentHTML('beforeend',button('同步','sync-menu'));
  // Keep the header compact: the three remote actions live in one menu.
  // The generic feature handler above delegates sync-menu here as well.
  operationLabels['sync-menu']='同步';
  $('scope').insertAdjacentHTML('afterend',button('筛选','filters'));
  let loading=false;
  $('history-scroll').addEventListener('scroll',async()=>{const box=$('history-scroll');if(config().autoLoad&&state.data?.hasMore&&!loading&&box.scrollTop+box.clientHeight>=box.scrollHeight-48){loading=true;state.limit+=300;try{await refresh();}finally{loading=false;}}});
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;
    const mod=e.ctrlKey||e.metaKey;if(!mod)return;
    if(e.key.toLowerCase()==='r'){e.preventDefault();void refresh();}
    if(e.key.toLowerCase()==='h'){e.preventDefault();$('head').click();}
    if(e.key.toLowerCase()==='s'){e.preventDefault();void stashes();}
    if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const row=state.rows.find(r=>r.id===state.selected);if(!row||row.kind==='working')return;const target=e.key==='ArrowDown'?row.parents[e.shiftKey?1:0]:state.rows.find(r=>r.parents?.includes(row.hash))?.hash;if(target)void ctx.jump(target);}
  });
  function applyColumnWidths(){for(const key of ['author','date','sha'])$('app').style.setProperty(`--${key}-width`,`${config().columnWidths?.[key]||{author:116,date:64,sha:70}[key]}px`);}
  for(const key of ['author','date','sha']){
    const cell=document.querySelector(`.table-head .${key}`),handle=document.createElement('span');handle.className='column-resizer';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label',`调整${{author:'作者',date:'日期',sha:'SHA'}[key]}列宽`);handle.setAttribute('aria-orientation','vertical');cell.append(handle);
    let drag=null;
    handle.onpointerdown=e=>{e.preventDefault();drag={x:e.clientX,width:cell.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);};
    handle.onpointermove=e=>{if(drag)$('app').style.setProperty(`--${key}-width`,`${Math.max(40,Math.min(1000,drag.width+e.clientX-drag.x))}px`);};
    handle.onpointerup=async e=>{if(!drag)return;const width=Math.max(40,Math.min(1000,drag.width+e.clientX-drag.x));drag=null;try{await loadPreferences();await saveConfig({...config(),columnWidths:{...config().columnWidths,[key]:width}});}catch(error){notify(error.message);}};
    handle.onkeydown=async e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();try{await loadPreferences();const width=Math.max(40,Math.min(1000,cell.getBoundingClientRect().width+(e.key==='ArrowLeft'?-10:10)));await saveConfig({...config(),columnWidths:{...config().columnWidths,[key]:width}});}catch(error){notify(error.message);}};
  }
  return {
    loadPreferences,
    snapshotOptions:()=>filters,
    resetFilters:()=>{filters={};},
    nav:()=>'<h3>仓库</h3>'+button('远程仓库','remotes')+button('Stash','stashes'),
    rowActions:row=>'<hr>'+button('与操作工作区比较','compare-working',{hash:row.hash})+button('提交包含关系与签名','commit-info',{hash:row.hash})+button('检出此提交','checkout',{hash:row.hash})+button('创建标签','tag-add',{start:row.hash})+['merge','rebase','cherry-pick','revert','reset','drop'].map(op=>button(operationLabels[op],op,{ref:row.hash})).join(''),
    refActions:ref=>{const r=state.data.refs.find(r=>r.name===ref);if(!r)return '';let html=button('复制引用名','copy-ref',{ref:r.shortName});if(r.type==='branch')html+=button('重命名分支','branch-rename',{name:r.shortName})+button('删除分支','branch-delete',{name:r.shortName})+button('创建 PR／MR','create-pr',{branch:r.shortName});if(r.type==='remote'){const parts=r.shortName.split('/');html+=button('创建本地跟踪分支','track',{remoteBranch:r.name})+button('删除远程分支','remote-branch-delete',{remote:parts.shift(),name:parts.join('/')});}if(r.type==='tag')html+=button('标签详情','tag-info',{ref:r.name})+button('推送标签','tag-push',{name:r.shortName})+button('删除标签','tag-delete',{name:r.shortName});if(r.type==='branch'||r.type==='remote')html+=button('合并到操作工作区','merge',{ref:r.name})+button('将操作分支变基到此处','rebase',{ref:r.name});return html;},
    wtActions:w=>button('保存 Stash','stash-create',{worktreePath:w.path}),
    afterDetail(data){
      if(data.kind==='commit'){$('detail-tabs').innerHTML='<button id="review-toggle">开始审阅</button><button id="review-reset">重置审阅进度</button>'+button('包含关系／签名','commit-info',{hash:data.b});decorateFiles();}
      if(data.kind==='worktree'&&!data.comparison){
        const operation=data.ongoing?.some(n=>n.startsWith('rebase-'))?'rebase':data.ongoing?.includes('MERGE_HEAD')?'merge':data.ongoing?.includes('CHERRY_PICK_HEAD')?'cherry-pick':data.ongoing?.includes('REVERT_HEAD')?'revert':null;
        if(operation)$('detail-meta').insertAdjacentHTML('beforeend',`<p class="danger">正在进行 ${operation}</p>`+button('继续','continue',{worktreePath:data.path,operation})+button('中止','abort',{worktreePath:data.path,operation}));
        if(data.status.conflicts)$('detail-meta').insertAdjacentHTML('beforeend','<p>在文件菜单中标记冲突已解决，然后继续操作。</p>');
      }
      // URLs and configured issue references are links, never interpreted as HTML.
      const c=config();$('detail-meta').querySelectorAll('p').forEach(p=>{if(!p.textContent)return;const text=p.textContent;if(!/https?:\/\/|#\d+/.test(text))return;const parts=text.split(/(https?:\/\/[^\s<>]+|#\d+)/g);p.replaceChildren(...parts.map(part=>{let url=part.startsWith('http')?part:c.issueUrl&&/^#\d+$/.test(part)?c.issueUrl.replaceAll('{id}',part.slice(1)):null;if(!url)return document.createTextNode(part);try{url=safeUrl(url);}catch{return document.createTextNode(part);}const a=document.createElement('a');a.textContent=part;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}));});
    },
    afterFile(id){markReviewed(id);let bar=$('file-tools');if(!bar){bar=document.createElement('div');bar.id='file-tools';$('diff-pane').insertBefore(bar,$('diff-title'));}const file=state.detail?.files.find(f=>f.id===id);bar.hidden=false;bar.innerHTML=button('文件操作','file-menu',{id})+button('复制路径','copy-path',{path:file?.path});bar.querySelector('[data-feature="file-menu"]').onclick=e=>{e.stopPropagation();fileMenu(id);};},
    fileMenu,
    decorateFiles,
    dateText(value){const mode=config().dateFormat;const date=new Date(value);if(mode==='full')return date.toLocaleString('zh-CN');if(mode==='relative'){const days=Math.floor((Date.now()-date.getTime())/86400000);return days===0?'今天':days>0?`${days} 天前`:date.toLocaleDateString('zh-CN');}return date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});},
    fileTree:()=>config().fileTree,
  };
}
