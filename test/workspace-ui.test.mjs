import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createWorkspaceSession } from '../src/ui/workspace.js';

const source = await readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8');
const bundled = await build({ stdin:{contents:source.replace("import { App } from '@modelcontextprotocol/ext-apps';",'const App = globalThis.AppTest;')+'\nexport function testBridge(fn){app.callServerTool=fn;bridgeReady=Promise.resolve();}\nexport { state, switchRepository, call, receive, features, workspace, openAction, compare, refresh, showDetail, runAction, syncHostRepository };',resolveDir:fileURLToPath(new URL('../src/ui/',import.meta.url))}, bundle:true,write:false,format:'iife',globalName:'GraphTest',target:'es2022' });
function harness() {
  const nodes=new Map(),windowEvents=new Map(),timers=[];
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set(),el={id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,scrollTop:0,clientHeight:0,style:{setProperty(){}},dataset:{},tagName:'DIV',
      classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle(x,v){v??=!classes.has(x);v?classes.add(x):classes.delete(x);return v;}},
      querySelectorAll(){return [];},querySelector(){return null;},addEventListener(){},insertAdjacentHTML(){},setAttribute(){},before(){},after(){},append(child){(this.children??=[]).push(child);},focus(){},setPointerCapture(){},showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {width:100,top:0,bottom:0};}};
    nodes.set(id,el);el.parentElement=el;return el;
  };
  const parent={},document={getElementById:node,documentElement:node('root'),body:node('body'),activeElement:node('focused'),createElement:tag=>node('created-'+nodes.size),addEventListener(){},querySelectorAll(){return [...nodes.values()].filter(n=>n.open);},querySelector:selector=>node(selector)};
  class App { constructor(){App.instance=this;} connect(){return new Promise(()=>{});} callServerTool(args){return App.handler(args);} }
  // Run the actual bundled UI with a small host bridge and DOM surface.
  const context=vm.createContext({document,window:{parent,addEventListener(name,handler){windowEvents.set(name,handler);},removeEventListener(name,handler){if(windowEvents.get(name)===handler)windowEvents.delete(name);}},location:{hash:''},URL,URLSearchParams,AbortController,AbortSignal,crypto:globalThis.crypto,console,setTimeout,clearTimeout,setInterval:callback=>{timers.push(callback);return timers.length;},clearInterval(){},localStorage:{getItem(){return null;}},matchMedia:()=>({matches:false,addEventListener(){}}),ResizeObserver:class{observe(){}},navigator:{},AppTest:App});
  const js=bundled.outputFiles[0].text;
  vm.runInContext(js,context);
  return {api:context.GraphTest,node,host:App.instance,context,windowEvents,timers};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const data=path=>({repository:{path,name:path},commits:[],worktrees:[],refs:[],hasMore:false});

test('workspace epochs reject A → B → A and abort old HTTP reads',()=>{
  const session=createWorkspaceSession(),old=session.capture();session.invalidate();session.invalidate();
  assert.equal(old.signal.aborted,true);assert.throws(()=>old.assert(),{name:'StaleWorkspaceError'});
});

test('switch clears repository state, dialogs, filters, search, checked files and prepared inputs',()=>{
  const {api,node}=harness();api.switchRepository('A');
  Object.assign(api.state,{detail:{files:[]},detailInput:{hash:'old'},file:'old',selected:'old',compare:{a:'old'},compareStart:'old',scope:'old',message:'old',pending:true});api.state.checked.add('old');
  node('search').value='old';node('action-fields').innerHTML='old';node('action-dialog').showModal();
  api.switchRepository('B');
  for(const key of ['detail','detailInput','file','selected','compare','compareStart'])assert.equal(api.state[key],null,key);
  assert.equal(api.state.checked.size,0);assert.equal(api.state.pending,false);assert.equal(api.state.scope,'');assert.equal(api.state.message,'');
  assert.equal(node('search').value,'');assert.equal(node('action-dialog').open,false);assert.equal(node('detail').hidden,true);
  assert.equal(Object.keys(api.features.snapshotOptions()).length,0);
});

test('a late native tool result for the previous repository cannot switch the UI back',()=>{
  const {api,host}=harness();api.switchRepository('B');host.ontoolresult({structuredContent:data('A')});
  assert.equal(api.state.repositoryPath,'B');assert.equal(api.state.data,null);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('late snapshot, detail, and action preparation cannot affect the next workspace',async()=>{
  for(const operation of ['snapshot','detail','prepare']){
    const {api,node}=harness(),pending=deferred(),calls=[];
    api.switchRepository('A');
    api.testBridge(args=>{calls.push(args);return pending.promise;});
    const result=operation==='snapshot'?api.refresh():operation==='detail'?api.showDetail({hash:'old'}):api.runAction('stage',{worktreePath:'A',paths:['old']});
    await tick();assert.equal(calls.length,1);
    api.receive(data('B'));
    pending.resolve({structuredContent:operation==='snapshot'?data('A'):operation==='detail'?{kind:'commit',files:[]}: {actionId:'old'}});
    await result;
    assert.equal(api.state.repositoryPath,'B',operation);assert.equal(api.state.detail,null,operation);
    assert.equal(api.state.pending,false,operation);assert.equal(node('detail').hidden,true,operation);assert.equal(calls.length,1,'no old execute or refresh');
  }
});
test('initial snapshot and missing-context fallback leave refresh available',async()=>{
  for(const response of [data('A'),{needsRepository:true}]){
    const {api,node}=harness();
    api.testBridge(args=>Promise.resolve({structuredContent:args.name==='git_graph_preferences'?{config:{},reviews:{}}:response}));
    await api.refresh();
    assert.equal(node('refresh').disabled,false);
    if(response.needsRepository)assert.equal(node('repo-form').hidden,false);
    else assert.equal(api.state.repositoryPath,'A');
  }
});

test('same-repository out-of-order snapshots keep the latest refresh',async()=>{
  const {api}=harness(),older=deferred(),newer=deferred();let snapshots=0;
  api.receive(data('A'));
  api.testBridge(args=>args.name==='git_graph_preferences'?Promise.resolve({structuredContent:{config:{},reviews:{}}}):(++snapshots===1?older.promise:newer.promise));
  const first=api.refresh(),second=api.refresh();await tick();
  newer.resolve({structuredContent:{...data('A'),marker:'new'}});await second;
  older.resolve({structuredContent:{...data('A'),marker:'old'}});await first;
  assert.equal(api.state.data.marker,'new');
});
test('native result triggers a fresh read instead of rendering stale data, including path canonicalization',async()=>{
  const {api,host}=harness();api.switchRepository('A/../A');
  api.testBridge(args=>Promise.resolve({structuredContent:args.name==='git_graph_preferences'?{config:{},reviews:{}}:{...data('A'),marker:'fresh'}}));
  host.ontoolresult({structuredContent:{...data('A'),marker:'stale'}});await tick();
  assert.equal(api.state.repositoryPath,'A');assert.equal(api.state.data.marker,'fresh');
});

test('slow context polling is serialized and a host event schedules one follow-up',async()=>{
  const {api,host,timers,windowEvents}=harness(),first=deferred(),second=deferred();let calls=0;
  api.testBridge(()=>++calls===1?first.promise:second.promise);
  const pending=api.syncHostRepository();await tick();
  timers[0]();timers[0]();await tick();assert.equal(calls,1);
  first.resolve({structuredContent:{needsRepository:true,context:{status:'unavailable'}}});await pending;
  const follow=api.syncHostRepository();await tick();host.onhostcontextchanged({theme:'dark'});timers[0]();await tick();assert.equal(calls,2);
  second.resolve({structuredContent:{needsRepository:true,context:{status:'unavailable'}}});await follow;await tick();assert.equal(calls,3);
  host.onteardown();assert.equal(windowEvents.has('focus'),false);timers[0]();await api.syncHostRepository();assert.equal(calls,3);
});

test('column keyboard and pointer gestures cannot save into the next repository',async()=>{
  for(const gesture of ['keyboard','pointer']){
    const {api,node}=harness(),pending=deferred(),calls=[];api.receive(data('A'));
    api.testBridge(args=>{calls.push(args);return pending.promise;});
    const handle=node('.table-head .author').children[0];
    const result=gesture==='keyboard'?handle.onkeydown({key:'ArrowRight',preventDefault(){}}):(handle.onpointerdown({clientX:10,pointerId:1,preventDefault(){}}),handle.onpointerup({clientX:30}));
    await tick();api.receive(data('B'));pending.resolve({structuredContent:{config:{},reviews:{}}});await result;
    assert.equal(calls.length,1,gesture);assert.equal(calls[0].name,'git_graph_preferences');
  }
});

test('cached column preferences still check the repository after the await boundary',async()=>{
  const {api,node}=harness(),calls=[];api.receive(data('A'));
  api.testBridge(args=>{calls.push(args);return Promise.resolve({structuredContent:{config:{},reviews:{}}});});
  await api.features.loadPreferences();
  const result=node('.table-head .author').children[0].onkeydown({key:'ArrowRight',preventDefault(){}});
  api.receive(data('B'));await result;
  assert.equal(calls.filter(c=>c.name==='git_graph_save_preferences').length,0);
});

test('prepare resolution microtask cannot execute an action in a new workspace',async()=>{
  const {api}=harness(),pending=deferred(),calls=[];api.receive(data('A'));
  api.testBridge(args=>{calls.push(args);return pending.promise;});
  const running=api.runAction('stage',{worktreePath:'A',paths:['old']});await tick();
  pending.resolve({structuredContent:{actionId:'old'}});queueMicrotask(()=>api.receive(data('B')));
  await running;assert.equal(api.state.repositoryPath,'B');assert.equal(calls.length,1);assert.equal(calls[0].name,'git_graph_prepare');
});
test('execute resolution microtask cannot render results into a new workspace',async()=>{
  const {api,node}=harness(),pending=deferred(),calls=[];api.receive(data('A'));
  api.testBridge(args=>{calls.push(args);return pending.promise;});
  const running=api.runAction('commit',{worktreePath:'A'},{actionId:'prepared'});await tick();
  pending.resolve({structuredContent:{state:'completed',hash:'old',target:'A'}});queueMicrotask(()=>api.receive(data('B')));
  await running;assert.equal(api.state.repositoryPath,'B');assert.equal(api.state.selected,null);assert.equal(node('menu').open,false);assert.equal(calls.length,1);
});
