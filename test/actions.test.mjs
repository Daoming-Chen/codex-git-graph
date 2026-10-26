import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, snapshot } from '../src/git.mjs';
import { filesDetail, fileDiff, prepareAction, executeAction, resolveRef } from '../src/actions.mjs';
import { createFixture } from './fixture.mjs';

test('real Git review, file operations, version checks, first commit and index-only commit', async()=>{
 const base=path.resolve('.test-output/actions-'+randomUUID());await mkdir(base,{recursive:true});await git(base,['init','-b','main']);await git(base,['config','user.name','Fixture']);await git(base,['config','user.email','fixture@example.test']);
 const file=path.join(base,'space 中文.txt');await writeFile(file,'one\n');
 let d=await filesDetail(base,{worktreePath:base});assert.equal(d.files[0].group,'untracked');assert.match((await fileDiff(base,{worktreePath:base,fileId:d.files[0].id,version:d.version})).patch,/\+one/);
 const perform=async(action,payload,version)=>{const p=await prepareAction(base,action,payload,version);const op=randomUUID();const result=await executeAction(base,p.actionId,op);assert.equal(result.state,'completed',result.error);assert.deepEqual(await executeAction(base,p.actionId,op),result);return result;};
 await assert.rejects(prepareAction(base,'stage',{worktreePath:base,paths:['space 中文.txt']}),/缺少/);
 await perform('stage',{worktreePath:base,paths:['space 中文.txt']},d.version);
 d=await filesDetail(base,{worktreePath:base});await appendFile(file,'two\n');await assert.rejects(prepareAction(base,'unstage',{worktreePath:base,paths:['space 中文.txt']},d.version),/已变化/);
 d=await filesDetail(base,{worktreePath:base});await perform('unstage',{worktreePath:base,paths:['space 中文.txt']},d.version);assert.equal(await readFile(file,'utf8'),'one\ntwo\n');
 d=await filesDetail(base,{worktreePath:base});const prep=await prepareAction(base,'stage',{worktreePath:base,paths:['space 中文.txt']},d.version);await appendFile(file,'three\n');assert.equal((await executeAction(base,prep.actionId,randomUUID())).state,'failed');
 d=await filesDetail(base,{worktreePath:base});await perform('stage',{worktreePath:base,paths:['space 中文.txt']},d.version);await appendFile(file,'not committed\n');d=await filesDetail(base,{worktreePath:base});const commit=await perform('commit',{worktreePath:base,message:'initial index'},d.version);assert.ok(commit.hash);assert.doesNotMatch(await git(base,['show','HEAD:space 中文.txt']),/not committed/);assert.match(await readFile(file,'utf8'),/not committed/);
 const root=await filesDetail(base,{hash:commit.hash});assert.equal(root.a,null);assert.equal(root.files[0].path,'space 中文.txt');assert.match((await fileDiff(base,{hash:commit.hash,fileId:root.files[0].id})).patch,/\+three/);
 await perform('branch',{name:'codex/next',start:commit.hash});await assert.rejects(prepareAction(base,'branch',{name:'codex/next',start:commit.hash}),/已存在/);await assert.rejects(prepareAction(base,'branch',{name:'--help',start:commit.hash}));await assert.rejects(resolveRef(base,'HEAD~1'));await assert.rejects(fileDiff(base,{hash:commit.hash,fileId:'../outside'}));
 await assert.rejects(prepareAction(base,'switch',{worktreePath:base,name:'codex/next'},d.version),/完全干净/);
 d=await filesDetail(base,{worktreePath:base});await perform('stage',{worktreePath:base,paths:['space 中文.txt']},d.version);d=await filesDetail(base,{worktreePath:base});await perform('commit',{worktreePath:base,message:'remaining'},d.version);
 d=await filesDetail(base,{worktreePath:base});await perform('switch',{worktreePath:base,name:'codex/next'},d.version);assert.equal((await git(base,['symbolic-ref','--short','HEAD'])).trim(),'codex/next');
 const target=path.join(path.dirname(base),'linked-'+randomUUID());await perform('worktree',{name:'codex/linked',start:commit.hash,target});assert.equal((await git(target,['rev-parse','HEAD'])).trim(),commit.hash);await assert.rejects(prepareAction(base,'worktree',{name:'codex/exists',start:commit.hash,target}),/已存在/);await assert.rejects(prepareAction(base,'worktree',{name:'codex/nested',start:commit.hash,target:path.join(base,'nested')}),/Worktree 内/);
 // Idempotency crosses repository entry paths through common-dir normalization.
 const p=await prepareAction(base,'branch',{name:'codex/cross',start:commit.hash}),op=randomUUID();const result=await executeAction(base,p.actionId,op);assert.deepEqual(await executeAction(target,p.actionId,op),result);
 await assert.rejects(prepareAction(base,'stage',{worktreePath:base,paths:['../outside']},d.version));
});

test('scope ancestors, merge parents, structured rename and bounded untracked preview',async()=>{
 const f=await createFixture();const scoped=await snapshot(f.root,{scope:'refs/heads/feat/commit-detail'});assert.deepEqual(new Set(scoped.commits.map(c=>c.hash)),new Set((await git(f.root,['rev-list','refs/heads/feat/commit-detail'])).trim().split('\n')));
 const d=await filesDetail(f.root,{worktreePath:f.root});assert.equal(d.files.find(f=>f.status==='R').originalPath,'rename me.txt');
 const merge0=await filesDetail(f.root,{hash:f.merge,parent:0}),merge1=await filesDetail(f.root,{hash:f.merge,parent:1});assert.notEqual(merge0.a,merge1.a);assert.deepEqual(merge0.files.map(f=>f.path),['detail.js']);
 await writeFile(path.join(f.root,'large.txt'),'x'.repeat(300000));const large=await filesDetail(f.root,{worktreePath:f.root});const preview=await fileDiff(f.root,{worktreePath:f.root,fileId:'untracked:large.txt',version:large.version});assert.equal(preview.truncated,true);assert.ok(preview.patch.length<263000);
 await writeFile(path.join(f.root,'binary.bin'),Buffer.from([0,1,2]));assert.equal((await fileDiff(f.root,{worktreePath:f.root,fileId:'untracked:binary.bin'})).binary,true);
});

test('hook failure keeps index/message and redacts diagnostic credentials',async()=>{
 const f=await createFixture();const hook=path.join(f.root,'.git/hooks/pre-commit');await writeFile(hook,'#!/bin/sh\necho "token=secret-value https://name:pass@example.test" >&2\nexit 1\n');await chmod(hook,0o755);const d=await filesDetail(f.root,{worktreePath:f.root});const p=await prepareAction(f.root,'commit',{worktreePath:f.root,message:'kept message'},d.version);const r=await executeAction(f.root,p.actionId,randomUUID());assert.equal(r.state,'failed');assert.doesNotMatch(r.error,/secret-value|name:pass/);assert.match(r.error,/redacted/);assert.equal((await filesDetail(f.root,{worktreePath:f.root})).status.staged,1);
});

test('identity changes, index locks, locked Worktree writes and submodule pointer diffs',async()=>{
 const f=await createFixture();let d=await filesDetail(f.root,{worktreePath:f.root});await git(f.root,['config','user.name','Changed Author']);await assert.rejects(prepareAction(f.root,'commit',{worktreePath:f.root,message:'identity changed'},d.version),/已变化/);
 const linked=await filesDetail(f.root,{worktreePath:f.linked});const p=await prepareAction(f.root,'stage',{worktreePath:f.linked,paths:['notes 中文.txt']},linked.version);assert.equal((await executeAction(f.root,p.actionId,randomUUID())).state,'completed');
 d=await filesDetail(f.root,{worktreePath:f.root});const locked=await prepareAction(f.root,'stage',{worktreePath:f.root,paths:['README.md']},d.version);await writeFile(path.join(f.root,'.git/index.lock'),'fixture lock');const r=await executeAction(f.root,locked.actionId,randomUUID());assert.equal(r.state,'failed');assert.match(r.error,/index.lock/);
 // Only remove the single fixture lock created above; never clean a user directory.
 const {unlink}=await import('node:fs/promises');await unlink(path.join(f.root,'.git/index.lock'));
 await git(f.root,['update-index','--add','--cacheinfo',`160000,${f.first},fixture-module`]);await git(f.root,['commit','-m','add submodule pointer']);const head=(await git(f.root,['rev-parse','HEAD'])).trim();const files=await filesDetail(f.root,{hash:head});assert.ok(files.files.some(f=>f.path==='fixture-module'));assert.equal((await fileDiff(f.root,{hash:head,fileId:'fixture-module'})).submodule,true);
});

test('real shallow and prunable boundaries are explicit, occupied branches are rejected',async()=>{
 const f=await createFixture();const {pathToFileURL}=await import('node:url');const shallow=path.join(f.directory,'shallow');await git(f.directory,['clone','--depth=1','--no-local',pathToFileURL(f.root).href,shallow]);const data=await snapshot(shallow);assert.equal(data.commits.length,1);assert.equal(data.commits[0].shallowBoundary,true);assert.equal(data.commits[0].parents.length,2);
 const d=await filesDetail(f.root,{worktreePath:f.detached});await assert.rejects(prepareAction(f.root,'switch',{worktreePath:f.detached,name:'main'},d.version),/占用/);await assert.rejects(prepareAction(f.root,'commit',{worktreePath:f.detached,message:'detached'},d.version),/detached/);
 const {rename}=await import('node:fs/promises');const displaced=path.join(f.directory,'moved-detached');assert.ok(path.resolve(displaced).startsWith(path.resolve('.test-output')+path.sep));await rename(f.detached,displaced);const after=await snapshot(f.root);const missing=after.worktrees.find(w=>w.detached);assert.ok(missing.prunable||missing.error);assert.equal(missing.status,null);await assert.rejects(filesDetail(f.root,{worktreePath:f.detached}));
});
