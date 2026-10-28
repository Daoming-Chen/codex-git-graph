import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkGraph } from '../src/ui/work-live.js';

function mount(t, initialCall) {
  const nodes=new Map();
  function node(id='') {
    const attributes={};
    const n={id,innerHTML:'',textContent:'',scrollTop:0,style:{setProperty(){}},setAttribute(key,value){attributes[key]=value;},attributes,getBoundingClientRect(){return {height:600};},before(x){nodes.set(x.id,x)},after(x){nodes.set(x.id,x)},classList:{toggle(){},contains(){return true}}};
    nodes.set(id,n);return n;
  }
  const old=globalThis.document;
  globalThis.document={getElementById:id=>nodes.get(id)||node(id),createElement:()=>node(),documentElement:{dataset:{}}};
  t.after(()=>{globalThis.document=old;});
  let call=initialCall;
  const ui=installWorkGraph({call:(...args)=>call(...args)}),$=id=>nodes.get(id);
  const click=(kind,value)=>$('work-view').onclick({target:{id:kind==='id'?value:'',closest:selector=>kind==='tab'&&selector==='[role="tab"]'?{id:value}:selector===`[data-${kind}]`?{dataset:{[kind]:value}}:null}});
  return {$,ui,click,setCall:fn=>{call=fn;}};
}
const sample=()=>({repository:{name:'REPO'},works:[
  {id:'A',title:'接口工作',summary:'父级完整摘要',next:'父级下一步',status:'进行中'},
  {id:'A1',parentId:'A',title:'读取接口',summary:'已支持历史读取',next:'补充边界验证',status:'进行中',issues:['验证尚未结束']},
  {id:'A2',parentId:'A',kind:'outcome',title:'旧请求隔离',summary:'已隔离旧请求',status:'已完成',outcomes:['旧响应不能覆盖新工作']},
  {id:'B',title:'使用文档',summary:'说明已整理',next:'持续维护',status:'已完成',updatedAt:'2026-10-28T08:00:00.000Z'}
],records:[
  {hash:'a1234567890',workId:'A1',title:'fix: stale request',time:'2026-10-28T08:00:00Z'},
  {hash:'a2345678901',workId:'A',title:'feat: work records',time:'2026-10-27T08:00:00Z'},
  {hash:'b1234567890',workId:'B',title:'docs: usage',time:'2026-10-26T08:00:00Z'}
],dirty:[]});

test('old repository responses and failed refreshes cannot retain previous evidence',async t=>{
  let resolve;const {ui,$,setCall}=mount(t,()=>new Promise(r=>{resolve=r}));
  const first=ui.update();ui.reset();resolve(sample());await first;assert.equal($('work-project').textContent,'');
  setCall(async()=>sample());await ui.update();assert.equal($('work-project').textContent,'REPO');
  $('work-detail').innerHTML='old evidence';setCall(async()=>{throw Error('invalid records')});await ui.update();
  assert.equal($('work-detail').innerHTML,'');assert.equal($('work-count').textContent,'工作记录读取失败');assert.equal($('work-detail').hidden,true);
});

test('compact rows contain only work metadata and expand child work, never commits',async t=>{
  const {ui,$,click}=mount(t,async()=>sample());await ui.update();
  const html=$('work-rows').innerHTML;
  assert.match(html,/data-record="A"/);assert.match(html,/data-record="B"/);
  assert.doesNotMatch(html,/父级完整摘要|父级下一步|data-record="A1"|stale request|work-node/);
  assert.match(html,/尚未记录更新时间/);assert.match(html,/2026-10-28T08:00:00.000Z/);
  assert.equal($('work-detail').hidden,true);
  await click('expand','A');assert.match($('work-rows').innerHTML,/data-record="A1"/);assert.match($('work-rows').innerHTML,/data-record="A2"/);
  assert.doesNotMatch($('work-rows').innerHTML,/stale request|a1234567890/);
  await ui.update();assert.match($('work-rows').innerHTML,/data-record="A1"/);
  await click('expand','A');assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"/);
});

test('selecting titles updates one bottom pane without changing list scroll or expansion',async t=>{
  const {ui,$,click}=mount(t,async()=>sample());await ui.update();await click('expand','A');
  $('work-list').scrollTop=147;await click('record','A1');
  assert.equal($('work-list').scrollTop,147);assert.equal($('work-detail').hidden,false);assert.equal($('work-resize').hidden,false);
  assert.match($('work-detail').innerHTML,/已支持历史读取|验证尚未结束/);
  await click('record','B');assert.match($('work-detail').innerHTML,/说明已整理/);assert.equal($('work-list').scrollTop,147);
  assert.match($('work-rows').innerHTML,/data-record="A1"/);
  const oldDetail=$('work-detail').innerHTML;await click('expand','A');assert.equal($('work-detail').innerHTML,oldDetail);
  await click('id','work-close');assert.equal($('work-detail').hidden,true);assert.equal($('work-resize').hidden,true);
});

test('search reveals matching children with ancestor context; filtering during refresh keeps latest data',async t=>{
  const {ui,$,click,setCall}=mount(t,async()=>sample());await ui.update();
  $('work-search').oninput({target:{value:'stale request'}});
  assert.match($('work-rows').innerHTML,/data-record="A"/);assert.match($('work-rows').innerHTML,/data-record="A1"/);
  assert.doesNotMatch($('work-rows').innerHTML,/data-record="A2"|data-record="B"|stale request/);
  await click('expand','A');assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"/);
  $('work-search').oninput({target:{value:''}});assert.match($('work-rows').innerHTML,/data-record="B"/);
  let resolve;setCall(()=>new Promise(r=>{resolve=r}));const refresh=ui.update();$('work-filter').onchange({target:{value:'已完成'}});
  const next=sample();next.repository.name='REFRESHED';resolve(next);await refresh;
  assert.equal($('work-project').textContent,'REFRESHED');assert.match($('work-rows').innerHTML,/data-record="A2"|data-record="B"/);assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"/);
});

test('parent evidence aggregates labeled children, while children never inherit parent commits',async t=>{
  const {ui,$,click}=mount(t,async()=>sample());await ui.update();await click('record','A');await click('tab','work-tab-evidence');
  assert.match($('work-detail').innerHTML,/data-patch="a1234567890"/);assert.match($('work-detail').innerHTML,/来自子项：读取接口/);
  assert.match($('work-detail').innerHTML,/data-patch="a2345678901"/);
  await click('expand','A');await click('record','A1');assert.match($('work-detail').innerHTML,/data-patch="a1234567890"/);assert.doesNotMatch($('work-detail').innerHTML,/data-patch="a2345678901"/);
  await click('record','A2');assert.match($('work-detail').innerHTML,/暂无明确关联的提交/);
});

test('matching a parent reveals its children and status filtering still excludes nonmatching descendants',async t=>{
  const {ui,$,click}=mount(t,async()=>sample());await ui.update();
  $('work-search').oninput({target:{value:'接口工作'}});
  assert.match($('work-rows').innerHTML,/data-record="A1"/);assert.match($('work-rows').innerHTML,/data-record="A2"/);
  await click('expand','A');assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"/);
  await click('expand','A');assert.match($('work-rows').innerHTML,/data-record="A1"/);
  $('work-filter').onchange({target:{value:'已完成'}});
  assert.match($('work-rows').innerHTML,/data-record="A"/);assert.match($('work-rows').innerHTML,/data-record="A2"/);
  assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"|data-record="B"/);
});

test('closing, changing tabs or repository invalidates pending diff responses',async t=>{
  let resolve;const {ui,$,click}=mount(t,route=>route==='work_graph'?Promise.resolve(sample()):new Promise(r=>{resolve=r}));
  await ui.update();await click('record','A');await click('tab','work-tab-evidence');
  const first=click('patch','a1234567890');await click('id','work-close');resolve({patch:'OLD PATCH'});await first;assert.notEqual($('work-real-patch').textContent,'OLD PATCH');
  await click('record','A');const second=click('patch','a1234567890');await click('tab','work-tab-progress');resolve({patch:'OTHER PATCH'});await second;assert.notEqual($('work-real-patch').textContent,'OTHER PATCH');
  ui.reset();await ui.update();assert.equal($('work-search').value,'');assert.equal($('work-filter').value,'全部');assert.equal($('work-detail').hidden,true);assert.doesNotMatch($('work-rows').innerHTML,/data-record="A1"/);
});

test('detail resizing is bounded and supports pointer and keyboard adjustments',async t=>{
  const {ui,$,click}=mount(t,async()=>sample());await ui.update();await click('record','A');
  const handle=$('work-resize');assert.ok(Math.abs(parseFloat($('work-detail').style.height)-204)<1);
  handle.onkeydown({key:'End',preventDefault(){}});assert.equal($('work-detail').style.height,'360px');
  handle.onkeydown({key:'Home',preventDefault(){}});assert.equal($('work-detail').style.height,'140px');
  handle.onpointerdown({button:0,clientY:400,preventDefault(){}});handle.onpointermove({clientY:-500});assert.equal($('work-detail').style.height,'360px');handle.onpointerup();
  handle.onpointermove({clientY:1000});assert.equal($('work-detail').style.height,'360px');
});
