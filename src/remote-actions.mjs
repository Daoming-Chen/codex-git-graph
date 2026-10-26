import path from 'node:path';
import { git, parseWorktrees } from './git.mjs';

export const remoteActionNames = ['fetch', 'pull', 'push', 'remote-add', 'remote-edit', 'remote-remove', 'remote-prune', 'remote-branch-delete', 'branch-rename', 'branch-delete', 'tag-add', 'tag-delete', 'tag-push', 'checkout', 'track'];
const fields = {
  fetch: ['remote', 'prune'], pull: ['worktreePath', 'remote', 'name', 'mode'], push: ['worktreePath', 'remote', 'name', 'setUpstream'],
  'remote-add': ['name', 'url'], 'remote-edit': ['name', 'url'], 'remote-remove': ['name', 'confirm'], 'remote-prune': ['name', 'confirm'],
  'remote-branch-delete': ['remote', 'name', 'confirm'],
  'branch-rename': ['name', 'newName'], 'branch-delete': ['name', 'force', 'confirm'], 'tag-add': ['name', 'start', 'message', 'signed'],
  'tag-delete': ['name', 'confirm'], 'tag-push': ['name', 'remote'], checkout: ['worktreePath', 'hash'], track: ['worktreePath', 'remoteBranch', 'name'],
};
const text = value => { if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value) || value.startsWith('-')) throw new Error('名称或参数无效。'); return value; };
const confirm = payload => { if (payload.confirm !== true) throw new Error('请明确确认此删除或清理操作。'); };
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

export async function validateRemoteAction(root, action, payload, { workState, resolveRef, hash }) {
  if (Object.keys(payload).some(k => !fields[action].includes(k))) throw new Error('操作包含未知字段。');
  for (const key of ['prune', 'setUpstream', 'force', 'signed']) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error(`${key} 必须为布尔值。`);
  const names = (await git(root, ['remote'])).trim().split('\n').filter(Boolean);
  const remote = name => { text(name); if (!names.includes(name)) throw new Error('远程仓库不存在。'); return name; };
  const refName = async (name, kind = 'heads') => { text(name); await git(root, ['check-ref-format', `refs/${kind}/${name}`]); return `refs/${kind}/${name}`; };
  const present = ref => git(root, ['show-ref', '--verify', '--hash', ref]).then(x => x.trim(), () => null);
  const trees = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain', '-z']));
  let state, cwd = root, args;
  const extra = {
    refsVersion: hash(await git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)'])),
    remotesVersion: hash(await git(root, ['config', '--local', '--null', '--list'])),
    worktreesVersion: hash(JSON.stringify(trees)),
  };
  if (['pull', 'push', 'checkout', 'track'].includes(action)) {
    state = await workState(root, payload.worktreePath); cwd = state.path;
    if (state.ongoing.length || state.status.conflicts) throw new Error('请先完成当前 Git 操作并解决冲突。');
    if (action !== 'push' && state.status.total) throw new Error('工作区必须完全干净，请先提交或 Stash。');
  }
  if (action === 'fetch') {
    if (payload.remote) remote(payload.remote);
    if (!names.length) throw new Error('尚未配置远程仓库。');
    args = ['fetch', ...(payload.prune ? ['--prune'] : []), ...(payload.remote ? ['--', payload.remote] : ['--all'])];
  } else if (action === 'pull') {
    remote(payload.remote); await refName(payload.name);
    if (!state.branch) throw new Error('请先切换到本地分支。');
    const mode = payload.mode || 'ff-only';
    if (!['ff-only', 'merge', 'rebase'].includes(mode)) throw new Error('拉取方式无效。');
    args = ['pull', ...(mode === 'ff-only' ? ['--ff-only'] : mode === 'rebase' ? ['--rebase'] : ['--no-rebase', '--no-edit']), '--', payload.remote, payload.name];
  } else if (action === 'push') {
    remote(payload.remote); const ref = await refName(payload.name);
    extra.source = await present(ref); if (!extra.source) throw new Error('本地分支不存在。');
    args = ['push', ...(payload.setUpstream ? ['--set-upstream'] : []), '--', payload.remote, `${ref}:${ref}`];
  } else if (action === 'remote-branch-delete') {
    confirm(payload); remote(payload.remote); const target = await refName(payload.name);
    extra.remoteHead = await present(`refs/remotes/${payload.remote}/${payload.name}`);
    if (!extra.remoteHead) throw new Error('请先 Fetch，确认远程分支当前状态。');
    args = ['push', `--force-with-lease=${target}:${extra.remoteHead}`, '--', payload.remote, `:${target}`];
  } else if (action.startsWith('remote-')) {
    const name = text(payload.name); await refName(`${name}/validation`, 'remotes');
    if (action === 'remote-add') { if (names.includes(name)) throw new Error('同名远程仓库已存在。'); }
    else remote(name);
    if (['remote-add', 'remote-edit'].includes(action)) {
      const url = text(payload.url);
      if (url.includes('::') || (!path.isAbsolute(url) && !/^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[^\s/:]+@[^\s/:]+:)/i.test(url))) throw new Error('请输入 SSH、HTTPS、Git、file URL 或本地绝对路径。');
      args = action === 'remote-add' ? ['remote', 'add', '--', name, url] : ['remote', 'set-url', '--', name, url];
    } else {
      confirm(payload); args = ['remote', action === 'remote-remove' ? 'remove' : 'prune', '--', name];
    }
  } else if (action.startsWith('branch-')) {
    const ref = await refName(payload.name); extra.source = await present(ref);
    if (!extra.source) throw new Error('本地分支不存在。');
    const occupied = trees.find(w => w.branch === ref);
    if (action === 'branch-delete') {
      confirm(payload); if (occupied) throw new Error(`分支被 Worktree 占用：${occupied.path}`);
      args = ['branch', payload.force ? '-D' : '-d', '--', payload.name];
    } else {
      const next = await refName(payload.newName); if (await present(next)) throw new Error('同名分支已存在。');
      if (occupied && !same(occupied.path, root)) throw new Error(`分支被另一个 Worktree 占用：${occupied.path}`);
      args = ['branch', '-m', '--', payload.name, payload.newName];
    }
  } else if (action.startsWith('tag-')) {
    const ref = await refName(payload.name, 'tags'); extra.tagObject = await present(ref);
    if (action === 'tag-add') {
      if (extra.tagObject) throw new Error('同名标签已存在。');
      extra.start = (await resolveRef(root, payload.start)).hash;
      if (payload.message !== undefined && (typeof payload.message !== 'string' || payload.message.includes('\0') || payload.message.length > 65536)) throw new Error('标签说明无效。');
      if (payload.signed && !payload.message?.trim()) throw new Error('签名标签需要填写说明。');
      args = ['tag', ...(payload.message?.trim() ? [payload.signed ? '-s' : '-a', '-m', payload.message] : []), '--', payload.name, extra.start];
    } else {
      if (!extra.tagObject) throw new Error('标签不存在。');
      if (action === 'tag-delete') { confirm(payload); args = ['tag', '-d', '--', payload.name]; }
      else { remote(payload.remote); args = ['push', '--', payload.remote, `${ref}:${ref}`]; }
    }
  } else if (action === 'checkout') {
    extra.start = (await resolveRef(root, payload.hash)).hash; args = ['switch', '--detach', extra.start];
  } else if (action === 'track') {
    const ref = text(payload.remoteBranch);
    if (!ref.startsWith('refs/remotes/') || !names.some(name => ref.startsWith(`refs/remotes/${name}/`)) || ref.endsWith('/HEAD')) throw new Error('请选择有效的远程跟踪分支。');
    extra.start = (await resolveRef(root, ref)).hash;
    const target = await refName(payload.name); if (await present(target)) throw new Error('同名本地分支已存在。');
    args = ['switch', '-c', payload.name, '--track', ref];
  }
  return { cwd, args, extra, state };
}
