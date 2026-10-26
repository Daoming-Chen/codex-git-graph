import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, snapshot } from '../src/git.mjs';
import { filesDetail } from '../src/actions.mjs';

test('2001 commits, 20 worktrees and 1000 files remain bounded and report actual timings',async t=>{
 const base=path.resolve('.test-output/stress-'+randomUUID()),root=path.join(base,'main');await mkdir(root,{recursive:true});await git(root,['init','-b','main']);await git(root,['config','user.name','Stress']);await git(root,['config','user.email','stress@example.test']);
 let stream='';for(let i=0;i<2001;i++)stream+=`commit refs/heads/main\ncommitter Stress <stress@example.test> ${1600000000+i} +0000\ndata ${('checkpoint '+i).length}\ncheckpoint ${i}\n${i===0?'':'from :'+i+'\n'}mark :${i+1}\nM 100644 inline history.txt\ndata ${String(i).length}\n${i}\n\n`;
 // Marks belong immediately after the commit command in fast-import grammar.
 stream=stream.replace(/commit ([^\n]+)\n([\s\S]*?)mark :([0-9]+)\n/g,(_,ref,body,mark)=>`commit ${ref}\nmark :${mark}\n${body}`);
 await new Promise((resolve,reject)=>{const child=spawn('git',['-C',root,'fast-import','--quiet'],{windowsHide:true,stdio:['pipe','ignore','pipe']});let err='';child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve());child.stdin.end(stream);});
 await git(root,['reset','--hard','main']);for(let i=1;i<20;i++)await git(root,['worktree','add','--detach',path.join(base,'wt-'+i),'HEAD']);
 await Promise.all(Array.from({length:1000},(_,i)=>writeFile(path.join(root,`untracked ${i}.txt`),'test\n')));
 let started=performance.now();const data=await snapshot(root,{limit:300});const snapshotMs=performance.now()-started;assert.equal(data.commits.length,300);assert.equal(data.worktrees.length,20);assert.equal(data.hasMore,true);
 started=performance.now();const max=await snapshot(root,{limit:2000});const maxMs=performance.now()-started;assert.equal(max.commits.length,2000);assert.equal(max.hasMore,true);
 started=performance.now();const detail=await filesDetail(root,{worktreePath:root});const filesMs=performance.now()-started;assert.equal(detail.files.length,1000);t.diagnostic(JSON.stringify({snapshot300Ms:Math.round(snapshotMs),snapshot2000Ms:Math.round(maxMs),files1000Ms:Math.round(filesMs)}));
});
