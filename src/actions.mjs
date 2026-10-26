import { createHash, randomUUID } from 'node:crypto';
import { realpath, lstat, open, readlink, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { git, resolveRepository, parseStatus, parseWorktrees, boundedDiff, commitDetail } from './git.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const sha = x => typeof x === 'string' && /^[a-f0-9]{40,64}$/.test(x);
const inside = (a, b) => { const r = path.relative(a, b); return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
const exists = p => access(p).then(() => true, () => false);
const cleanText = (x, max = 4096) => { if (typeof x !== 'string' || !x || x.includes('\0') || x.length > max) throw new Error('输入为空、过长或包含无效字符。'); return x; };
const preparations = new Map(), operations = new Map(), queues = new Map();
const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
export async function resolveRef(repository, ref) {
  const { root } = await resolveRepository(repository);
  cleanText(ref);
  if (!sha(ref)) {
    if (!ref.startsWith('refs/') || ref.startsWith('-')) throw new Error('仅接受完整引用名或提交 SHA。');
    await git(root, ['check-ref-format', ref]);
    await git(root, ['show-ref', '--verify', ref]);
  }
  const result = (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  if (!sha(result)) throw new Error('引用不是提交。');
  return { hash: result };
}
async function workspace(repository, target) {
  const { root, bare } = await resolveRepository(repository);
  if (bare) throw new Error('裸仓库没有可操作工作区。');
  cleanText(target);
  const canonical = await realpath(target);
  const trees = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain', '-z']));
  let found;
  for (const tree of trees) if (!tree.bare && !tree.prunable && await realpath(tree.path).catch(() => null) === canonical) found = tree;
  if (!found) throw new Error('目录不是本仓库可用的 Worktree。');
  const common = async p => realpath((await git(p, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  if (await common(root) !== await common(canonical)) throw new Error('Git common dir 不一致。');
  return { root, path: canonical, tree: found };
}
async function fileVersion(root, name) {
  if (typeof name !== 'string' || name.includes('\0') || path.isAbsolute(name) || !inside(root, path.resolve(root, name))) throw new Error('文件路径越界。');
  const full = path.resolve(root, name);
  const stat = await lstat(full).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (!stat) return 'missing';
  if (stat.isSymbolicLink()) return hash(await readlink(full));
  if (!inside(await realpath(root), await realpath(full))) throw new Error('文件真实路径越界。');
  if (stat.isDirectory()) return 'directory';
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(full)) digest.update(chunk);
  return digest.digest('hex');
}
async function workState(repository, target) {
  const ws = await workspace(repository, target);
  const [raw, head, branch, index, identity] = await Promise.all([
    git(ws.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(ws.path, ['rev-parse', '--verify', 'HEAD']).then(x => x.trim(), () => null),
    git(ws.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(x => x.trim(), () => null),
    git(ws.path, ['ls-files', '--stage', '-z']).then(x => hash(x), () => null),
    git(ws.path, ['var', 'GIT_AUTHOR_IDENT']).then(x => x.trim().replace(/ \d+ [+-]\d{4}$/, ''), () => null),
  ]);
  const status = parseStatus(raw), versions = [];
  for (const f of status.files) versions.push([f.path, await fileVersion(ws.path, f.path)]);
  const gitdir = (await git(ws.path, ['rev-parse', '--absolute-git-dir'])).trim();
  const ongoing = [];
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) if (await exists(path.join(gitdir, name))) ongoing.push(name);
  return { ...ws, status, head, branch, index, identity, ongoing, version: hash(JSON.stringify({ raw, head, branch, index, identity, versions, ongoing })) };
}
function statusFiles(status) {
  return status.files.flatMap(f => f.conflict ? [{ ...f, group: 'conflict', id: `conflict:${f.path}`, status: 'U' }] : f.index === '?' ? [{ ...f, group: 'untracked', id: `untracked:${f.path}`, status: '?' }] : [
    ...(f.index !== ' ' ? [{ ...f, group: 'staged', id: `staged:${f.path}`, status: f.index }] : []),
    ...(f.working !== ' ' ? [{ ...f, group: 'unstaged', id: `unstaged:${f.path}`, status: f.working }] : []),
  ]);
}
function parseNames(raw) {
  const pieces = raw.split('\0'), result = [];
  for (let i = 0; i < pieces.length && pieces[i];) {
    const status = pieces[i++];
    const originalPath = /^[RC]/.test(status) ? pieces[i++] : undefined;
    const name = pieces[i++];
    result.push({ id: name, path: name, originalPath, status, group: 'commit' });
  }
  return result;
}
export async function filesDetail(repository, input) {
  if (input.worktreePath) {
    const s = await workState(repository, input.worktreePath);
    return { kind: 'worktree', path: s.path, status: s.status, files: statusFiles(s.status), version: s.version, head: s.head, branch: s.branch, index: s.index, identity: s.identity, ongoing: s.ongoing };
  }
  const { root } = await resolveRepository(repository);
  const b = (await resolveRef(root, input.b || input.hash)).hash;
  const raw = (await git(root, ['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b', b, '--'])).split('\0');
  const commit = { hash: raw[0], parents: raw[1].split(' ').filter(Boolean), author: raw[2], email: raw[3], date: raw[4], subject: raw[5], body: raw[6]?.trim() };
  let a;
  if (input.a) a = (await resolveRef(root, input.a)).hash;
  else {
    const parent = input.parent ?? 0;
    if (!Number.isInteger(parent) || parent < 0 || parent >= Math.max(1, commit.parents.length)) throw new Error('父提交编号无效。');
    a = commit.parents[parent];
  }
  const args = a ? ['diff', ...flags, '--name-status', '-z', a, b, '--'] : ['diff-tree', ...flags, '--root', '--no-commit-id', '-r', '--name-status', '-z', b, '--'];
  return { kind: 'commit', commit, a: a || null, b, parent: input.parent ?? 0, files: parseNames(await git(root, args)) };
}
export async function fileDiff(repository, input) {
  const detail = await filesDetail(repository, input);
  const file = detail.files.find(f => f.id === input.fileId);
  if (!file) throw new Error('文件已不在变更清单中，请刷新后重试。');
  if (input.version && input.version !== detail.version) throw new Error('文件状态已变化，请刷新后重新查看。');
  if (file.group === 'untracked') {
    const root = detail.path, full = path.resolve(root, file.path);
    await fileVersion(root, file.path);
    const stat = await lstat(full);
    let buffer;
    if (stat.isSymbolicLink()) buffer = Buffer.from(await readlink(full));
    else {
      const handle = await open(full, 'r');
      try { const preview = Buffer.alloc(Math.min(stat.size, 262144)); const { bytesRead } = await handle.read(preview, 0, preview.length, 0); buffer = preview.subarray(0, bytesRead); }
      finally { await handle.close(); }
    }
    const binary = buffer.subarray(0, 8192).includes(0);
    const truncated = stat.size > 262144;
    const text = buffer.toString('utf8'), lines = text ? text.replace(/\n$/, '').split('\n') : [];
    return { file, binary, truncated, patch: binary || !lines.length ? '' : `--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => '+' + l).join('\n') + (!text.endsWith('\n') && !truncated ? '\n\\ No newline at end of file' : '') };
  }
  const { root } = await resolveRepository(repository);
  const paths = [...new Set([file.originalPath, file.path].filter(Boolean))].map(p => `:(literal)${p}`);
  const args = detail.kind === 'worktree' ? ['diff', ...(file.group === 'staged' ? ['--cached'] : []), ...flags, '--', ...paths] : detail.a ? ['diff', ...flags, detail.a, detail.b, '--', ...paths] : ['show', '--format=', ...flags, detail.b, '--', ...paths];
  const result = await boundedDiff(detail.path || root, args);
  return { ...result, file, binary: /Binary files |GIT binary patch/.test(result.patch), submodule: /Subproject commit/.test(result.patch) };
}
const actionNames = ['stage', 'unstage', 'commit', 'branch', 'switch', 'worktree'];
async function validated(repository, action, payload) {
  if (!actionNames.includes(action)) throw new Error('不支持的操作。');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('操作参数无效。');
  const allowed = { stage: ['worktreePath', 'paths'], unstage: ['worktreePath', 'paths'], commit: ['worktreePath', 'message'], branch: ['start', 'name'], switch: ['worktreePath', 'name'], worktree: ['start', 'name', 'target'] }[action];
  if (Object.keys(payload).some(k => !allowed.includes(k))) throw new Error('操作包含未知字段。');
  const { root } = await resolveRepository(repository);
  let s, args, cwd = root, extra = {};
  if (['stage', 'unstage', 'commit', 'switch'].includes(action)) {
    s = await workState(root, payload.worktreePath); cwd = s.path;
    if (s.status.conflicts || s.ongoing.length) throw new Error('存在冲突或进行中的 Git 操作：' + s.ongoing.join(', '));
  }
  if (action === 'stage' || action === 'unstage') {
    if (!Array.isArray(payload.paths) || !payload.paths.length || payload.paths.length > 5000) throw new Error('请选择明确的文件。');
    const files = statusFiles(s.status);
    for (const p of payload.paths) if (!files.some(f => f.path === p && (action === 'stage' ? ['unstaged', 'untracked'].includes(f.group) : f.group === 'staged'))) throw new Error('文件不符合操作状态，请刷新。');
    const selected = s.status.files.filter(f => payload.paths.includes(f.path));
    const paths = [...new Set(selected.flatMap(f => [f.path, f.originalPath].filter(Boolean)))].map(p => `:(literal)${p}`);
    args = action === 'stage' ? ['add', '--', ...paths] : s.head ? ['reset', '-q', 'HEAD', '--', ...paths] : ['update-index', '--force-remove', '--', ...[...new Set(selected.flatMap(f => [f.path, f.originalPath].filter(Boolean)))]];
  }
  if (action === 'commit') {
    cleanText(payload.message, 65536);
    if (!payload.message.trim()) throw new Error('提交消息不能为空。');
    if (!s.branch) throw new Error('detached HEAD 请先创建并切换分支。');
    if (!s.status.staged) throw new Error('没有已暂存文件。');
    if (!s.identity) throw new Error('缺少 Git 作者身份。');
    args = ['commit', '-m', payload.message];
  }
  if (['branch', 'switch', 'worktree'].includes(action)) {
    cleanText(payload.name, 1024);
    if (payload.name.startsWith('-')) throw new Error('分支名不能以 - 开头。');
    await git(root, ['check-ref-format', `refs/heads/${payload.name}`]);
    const ref = `refs/heads/${payload.name}`;
    const present = await git(root, ['show-ref', '--verify', ref]).then(() => true, () => false);
    if (action === 'switch') {
      if (!present) throw new Error('目标本地分支不存在。');
      if (s.status.total) throw new Error(`工作区必须完全干净；当前有 ${s.status.total} 个改动文件。`);
      const trees = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain', '-z']));
      const occupied = trees.find(w => w.branch === ref && path.resolve(w.path) !== path.resolve(cwd));
      if (occupied) throw new Error(`分支被 Worktree 占用：${occupied.path}`);
      extra.targetHead = (await resolveRef(root, ref)).hash;
      args = ['switch', '--', payload.name];
    } else {
      if (present) throw new Error('同名分支已存在。');
      const start = (await resolveRef(root, payload.start)).hash;
      extra.start = start;
      args = ['branch', payload.name, start];
      if (action === 'worktree') {
        cleanText(payload.target);
        if (!path.isAbsolute(payload.target)) throw new Error('Worktree 目标必须是绝对路径。');
        if (payload.target.split(/[\\/]/).includes('..')) throw new Error('Worktree 目标不能包含路径穿越。');
        const parent = await realpath(path.dirname(payload.target));
        const target = path.join(parent, path.basename(payload.target));
        if (await exists(target)) throw new Error('目标目录已存在。');
        const trees = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain', '-z']));
        for (const t of trees) if (inside(await realpath(t.path).catch(() => path.resolve(t.path)), target)) throw new Error('目标不能位于现有 Worktree 内。');
        const common = await realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
        if (inside(common, target)) throw new Error('目标不能位于 Git 元数据目录内。');
        extra.target = target; extra.parent = parent;
        args = ['worktree', 'add', '-b', payload.name, target, start];
      }
    }
  }
  return { root, cwd, args, version: hash(JSON.stringify({ version: s?.version, ...extra })), extra };
}
async function commonKey(root) { return realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()); }
const redact = text => text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]').replace(/((?:token|password|authorization|secret)\s*[:=]\s*)(\S+)/gi, '$1[redacted]');
export async function prepareAction(repository, action, payload, expectedVersion) {
  const v = await validated(repository, action, payload);
  if (['stage', 'unstage', 'commit', 'switch'].includes(action)) {
    if (!expectedVersion) throw new Error('缺少已审阅的工作区状态版本，请刷新。');
    const viewed = await workState(v.root, payload.worktreePath);
    if (viewed.version !== expectedVersion) throw new Error('已审阅的状态或文件内容已变化，请刷新后重试。');
    if (v.version !== hash(JSON.stringify({ version: viewed.version, ...v.extra }))) throw new Error('检查期间状态已变化，请刷新后重试。');
  }
  if (preparations.size > 1000) for (const [id, p] of preparations) if (p.expires < Date.now()) preparations.delete(id);
  const actionId = randomUUID(), expires = Date.now() + 120000;
  preparations.set(actionId, { repository: await commonKey(v.root), action, payload: structuredClone(payload), version: v.version, expires });
  return { actionId, action, target: v.cwd, summary: { ...payload, ...v.extra }, version: v.version, expires, executable: true, command: ['git', ...v.args] };
}
export async function executeAction(repository, actionId, operationId) {
  if (!/^[a-f0-9-]{36}$/.test(operationId || '')) throw new Error('operationId 必须是 UUID。');
  const { root } = await resolveRepository(repository);
  const common = await commonKey(root), key = common + ':' + operationId;
  if (operations.has(key)) {
    const old = operations.get(key);
    if (old.actionId !== actionId) throw new Error('operationId 已用于另一操作。');
    return old.promise;
  }
  const p = preparations.get(actionId);
  if (!p || p.repository !== common || p.expires < Date.now()) throw new Error('操作预览已过期，请重新检查。');
  const run = async () => {
    const result = { operationId, action: p.action, target: p.payload.worktreePath || root, startedAt: new Date().toISOString() };
    try {
      if (p.expires < Date.now()) throw new Error('操作在等待队列期间过期，请重新检查。');
      const v = await validated(root, p.action, p.payload);
      if (v.version !== p.version) throw new Error('状态或文件内容已变化，操作未执行；请刷新并重新检查。');
      result.output = redact(await git(v.cwd, v.args, { timeout: 60000 }));
      result.state = 'completed';
      if (p.action === 'commit') result.hash = (await git(v.cwd, ['rev-parse', 'HEAD'])).trim();
      if (p.action === 'worktree') result.path = v.extra.target;
    } catch (error) {
      result.state = error.cause?.killed ? 'unknown' : 'failed';
      result.error = redact(error.message).slice(0, 8000);
      if (p.action === 'worktree') result.residual = { directoryExists: await exists(p.payload.target), branchExists: await git(root, ['show-ref', '--verify', `refs/heads/${p.payload.name}`]).then(() => true, () => false) };
      if (p.action === 'commit') result.observedHead = await git(p.payload.worktreePath, ['rev-parse', 'HEAD']).then(x => x.trim(), () => null);
    }
    result.finishedAt = new Date().toISOString();
    return result;
  };
  const promise = (queues.get(common) || Promise.resolve()).catch(() => {}).then(run);
  queues.set(common, promise); operations.set(key, { actionId, promise });
  return promise;
}
