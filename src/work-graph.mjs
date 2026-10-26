import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { git, resolveRepository, parseStatus } from './git.mjs';

// Explicit work ownership; commit messages are evidence, never instructions.
export async function readWorkGraph(repositoryPath) {
  const { root, bare } = await resolveRepository(repositoryPath);
  let manifest = { version: 1, works: [] };
  if (!bare) {
    const filename = path.join(root, '.workgraph.json');
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw new Error('工作记录必须是小于 256 KiB 的普通文件。');
      manifest = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.works) || manifest.works.length > 100) throw new Error('工作记录格式无效。');
  const ids = new Set(), hashes = new Set();
  const works = manifest.works.map(w => {
    if (!/^[A-Z][A-Z0-9-]{0,39}$/.test(w.id) || ids.has(w.id) || typeof w.title !== 'string' || !w.title.trim() || w.title.length > 160 || !['进行中','已完成','已搁置','待开始'].includes(w.status) || !Array.isArray(w.commits)) throw new Error('工作项格式或标识无效。');
    ids.add(w.id);
    for (const h of w.commits) {
      if (!/^[a-f0-9]{40,64}$/.test(h) || hashes.has(h)) throw new Error('提交关联无效或重复。');
      hashes.add(h);
    }
    for (const key of ['next','summary']) if (w[key] !== undefined && (typeof w[key] !== 'string' || w[key].length > 1000)) throw new Error('工作摘要无效。');
    return { id:w.id, title:w.title, status:w.status, next:w.next || '', summary:w.summary || '', commits:w.commits };
  });
  const head = (await git(root, ['rev-parse','--verify','--quiet','HEAD']).catch(() => '')).trim();
  const raw = head ? await git(root, ['log','--max-count=301','--format=%H%x00%aI%x00%s%x00%b%x00','HEAD','--']) : '';
  const fields = raw.split('\0'), records = [];
  for (let i=0;i+3<fields.length;i+=4) {
    const hash=fields[i].trim(); if (!hash) continue;
    const explicit=works.find(w=>w.commits.includes(hash));
    const trailers=[...fields[i+3].matchAll(/^Work-Item: ([A-Z][A-Z0-9-]{0,39})\s*$/gm)].map(m=>m[1]);
    const owner=explicit || (trailers.length===1 ? works.find(w=>w.id===trailers[0]) : null);
    records.push({hash,time:fields[i+1],title:fields[i+2],workId:owner?.id || 'UNASSIGNED'});
  }
  const hasMore=records.length>300; records.length=Math.min(records.length,300);
  if(records.some(r=>r.workId==='UNASSIGNED')) works.push({id:'UNASSIGNED',title:'未关联的提交',status:'待开始',next:'核对提交归属',summary:'尚未关联到工作项的历史。',commits:[]});
  const dirty=bare?[]:parseStatus(await git(root,['status','--porcelain=v1','-z','--untracked-files=all'])).files;
  return {repository:{path:root,name:path.basename(root)},head,works,records,dirty,hasMore,scope:'HEAD 最近 300 条提交',source:'.workgraph.json + Git'};
}
