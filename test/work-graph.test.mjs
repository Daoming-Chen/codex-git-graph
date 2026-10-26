import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../src/git.mjs';
import { readWorkGraph } from '../src/work-graph.mjs';

test('real work ownership follows hashes and trailers without inventing validation or hiding dirty files', async()=>{
  await mkdir('.test-output',{recursive:true});const root=await mkdtemp(path.resolve('.test-output/work-live-'));
  await git(root,['init','-b','main']);await git(root,['config','user.name','Test']);await git(root,['config','user.email','test@example.test']);
  await writeFile(path.join(root,'a.txt'),'one');await git(root,['add','.']);await git(root,['commit','-m','base']);
  const first=(await git(root,['rev-parse','HEAD'])).trim();
  await writeFile(path.join(root,'.workgraph.json'),JSON.stringify({version:1,works:[{id:'WG-A',title:'实际工作',status:'进行中',commits:[first]}]}));
  await git(root,['add','.']);await git(root,['commit','-m','work records','-m','Work-Item: WG-A']);
  await writeFile(path.join(root,'pending.txt'),'not committed');
  const result=await readWorkGraph(root);
  assert.equal(result.records.length,2);assert.ok(result.records.every(r=>r.workId==='WG-A'));assert.equal(result.works[0].status,'进行中');assert.ok(result.dirty.some(f=>f.path==='pending.txt'));
  await writeFile(path.join(root,'.workgraph.json'),JSON.stringify({version:1,works:[]}));
  const unassigned=await readWorkGraph(root);assert.ok(unassigned.records.every(r=>r.workId==='UNASSIGNED'));
  await writeFile(path.join(root,'.workgraph.json'),'{broken');await assert.rejects(()=>readWorkGraph(root));
});
