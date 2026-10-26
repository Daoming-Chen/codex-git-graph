import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkGraph } from '../src/ui/work-live.js';
test('live work responses cannot repopulate a switched repository and read failures clear evidence',async()=>{
  const nodes=new Map();
  function node(id=''){const n={id,innerHTML:'',textContent:'',style:{setProperty(){}},setAttribute(){},before(x){nodes.set(x.id,x)},after(x){nodes.set(x.id,x)},classList:{toggle(){},contains(){return true}}};nodes.set(id,n);return n;}
  const old=globalThis.document;
  globalThis.document={getElementById:id=>nodes.get(id)||node(id),createElement:()=>node(),documentElement:{dataset:{}}};
  try {
    let resolve;let call=()=>new Promise(r=>{resolve=r});
    const ui=installWorkGraph({call:(...args)=>call(...args)});
    const first=ui.update();ui.reset();
    resolve({repository:{name:'OLD'},works:[],records:[],dirty:[]});await first;
    assert.equal(nodes.get('work-project').textContent,'');
    call=async()=>({repository:{name:'NEW'},works:[],records:[],dirty:[]});await ui.update();
    assert.equal(nodes.get('work-project').textContent,'NEW');
    nodes.get('work-detail').innerHTML='old evidence';call=async()=>{throw Error('invalid records')};await ui.update();
    assert.equal(nodes.get('work-detail').innerHTML,'');assert.equal(nodes.get('work-count').textContent,'工作记录读取失败');
  } finally {globalThis.document=old;}
});
