import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.mjs';

export const historyActionNames = ['merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'drop', 'stash-create', 'stash-apply', 'stash-pop', 'stash-drop', 'stash-branch', 'discard', 'clean', 'stage-resolved', 'continue', 'abort'];
const fields = {
  merge: ['ref', 'ffMode'], rebase: ['ref', 'confirm'], 'cherry-pick': ['ref', 'mainline', 'noCommit'], revert: ['ref', 'mainline', 'noCommit'],
  reset: ['ref', 'mode', 'confirm'], drop: ['ref', 'confirm'], 'stash-create': ['message', 'includeUntracked', 'keepIndex'],
  'stash-apply': ['stash', 'reinstateIndex'], 'stash-pop': ['stash', 'reinstateIndex'], 'stash-drop': ['stash', 'confirm'], 'stash-branch': ['stash', 'name'],
  discard: ['paths', 'scope', 'confirm'], clean: ['paths', 'confirm'], 'stage-resolved': ['paths'], continue: ['operation'], abort: ['operation', 'confirm'],
};
const text = (value, max = 4096) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > max) throw new Error('操作文本为空或无效。');
  return value;
};
const confirmed = payload => { if (payload.confirm !== true) throw new Error('此操作需要明确确认。'); };
const clean = state => { if (state.status.total) throw new Error('工作区必须完全干净，请先提交或 Stash。'); };
const inactive = state => { if (state.ongoing.length || state.status.conflicts) throw new Error('存在冲突或进行中的 Git 操作，请先继续或中止。'); };
const identity = state => { if (!state.identity) throw new Error('缺少 Git 作者身份。'); };
const attached = state => { if (!state.branch) throw new Error('请先切换到本地分支。'); };

async function operationState(cwd, hash) {
  const directory = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim();
  const files = ['MERGE_HEAD', 'MERGE_MSG', 'ORIG_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer/todo', 'sequencer/head', 'sequencer/opts', 'rebase-merge/head-name', 'rebase-merge/onto', 'rebase-merge/orig-head', 'rebase-merge/git-rebase-todo', 'rebase-merge/done', 'rebase-apply/head-name', 'rebase-apply/onto', 'rebase-apply/orig-head', 'rebase-apply/next', 'rebase-apply/last'];
  return hash(JSON.stringify(await Promise.all(files.map(async name => [name, await readFile(path.join(directory, name), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; })]))));
}

function selectedPaths(state, payload, accepts) {
  if (!Array.isArray(payload.paths) || !payload.paths.length || payload.paths.length > 5000 || payload.paths.some(p => typeof p !== 'string' || p.includes('\0'))) throw new Error('请选择明确的文件。');
  const selected = payload.paths.map(name => {
    const file = state.status.files.find(f => f.path === name);
    if (!file || !accepts(file)) throw new Error('文件不符合操作状态，请刷新。');
    return file;
  });
  return [...new Set(selected.flatMap(f => [f.path, f.originalPath].filter(Boolean)))].map(p => `:(literal)${p}`);
}

export async function validateHistoryAction(root, action, payload, { workState, resolveRef, hash }) {
  if (!historyActionNames.includes(action)) throw new Error('不支持的历史操作。');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['worktreePath', ...fields[action]].includes(k))) throw new Error('操作包含未知字段。');
  for (const key of ['includeUntracked', 'keepIndex', 'reinstateIndex', 'noCommit']) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error('操作选项必须为布尔值。');
  const state = await workState(root, payload.worktreePath), cwd = state.path;
  const extra = { operationState: await operationState(cwd, hash) };
  let args;
  if (!['stage-resolved', 'continue', 'abort'].includes(action)) inactive(state);
  if (['merge', 'rebase', 'cherry-pick', 'revert', 'drop', 'stash-branch'].includes(action)) clean(state);
  if (['merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'drop', 'stash-branch'].includes(action)) attached(state);
  if (['merge', 'rebase', 'cherry-pick', 'revert', 'stash-create', 'continue'].includes(action)) identity(state);
  if (['rebase', 'reset', 'drop', 'stash-drop', 'discard', 'clean', 'abort'].includes(action)) confirmed(payload);

  if (['merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'drop'].includes(action)) {
    const ref = (await resolveRef(root, text(payload.ref))).hash;
    extra.target = ref;
    if (action === 'merge') {
      const mode = payload.ffMode ?? 'ff';
      if (!['ff', 'no-ff', 'ff-only'].includes(mode)) throw new Error('合并模式无效。');
      args = ['merge', '--no-edit', `--${mode}`, ref];
    }
    if (action === 'rebase') args = ['rebase', ref];
    if (['cherry-pick', 'revert'].includes(action)) {
      const parents = (await git(cwd, ['show', '-s', '--format=%P', ref])).trim().split(' ').filter(Boolean);
      if (parents.length > 1 && payload.mainline === undefined) throw new Error('合并提交必须明确选择主线父提交。');
      if (payload.mainline !== undefined && (!Number.isInteger(payload.mainline) || payload.mainline < 1 || payload.mainline > parents.length)) throw new Error('主线父提交编号无效。');
      args = [action, '--no-edit', ...(payload.mainline ? ['-m', String(payload.mainline)] : []), ...(payload.noCommit ? ['--no-commit'] : []), ref];
    }
    if (action === 'reset') {
      if (!['soft', 'mixed', 'hard'].includes(payload.mode)) throw new Error('Reset 模式无效。');
      args = ['reset', `--${payload.mode}`, ref];
    }
    if (action === 'drop') {
      if (!state.head) throw new Error('当前分支尚无提交，不能丢弃其他分支的历史。');
      const parents = (await git(cwd, ['show', '-s', '--format=%P', ref])).trim().split(' ').filter(Boolean);
      if (!parents.length) throw new Error('不能丢弃根提交：它没有可作为重放起点的父提交。');
      if (parents.length !== 1) throw new Error('不能直接丢弃合并提交：需要明确保留哪条父历史。');
      const reachable = await git(cwd, ['merge-base', '--is-ancestor', ref, state.head]).then(() => true, error => {
        if (error.cause?.code === 1) return false;
        throw error;
      });
      if (!reachable) throw new Error('所选提交不属于当前分支的可达历史，不能在此分支丢弃。');
      extra.parent = parents[0];
      if (ref === state.head) args = ['reset', '--hard', parents[0]];
      else {
        identity(state);
        const history = await git(cwd, ['rev-list', '--parents', `${ref}..${state.head}`, '--']);
        const replay = history.trim().split('\n').filter(Boolean);
        if (replay.some(line => line.trim().split(' ').length !== 2)) throw new Error('所选提交之后存在合并或非线性历史；丢弃会改变合并关系，请先使用专门的历史整理流程。');
        extra.replayCount = replay.length; extra.replayHistory = hash(history);
        // Keep subsequent empty/patch-equivalent commits and avoid updating other branches
        // when the user's rebase.updateRefs configuration is enabled.
        args = ['rebase', '--no-fork-point', '--no-update-refs', '--reapply-cherry-picks', '--keep-empty', '--empty=keep', '--onto', parents[0], ref];
      }
    }
  }
  if (action === 'stash-create') {
    if (!state.head) throw new Error('首次提交前不能创建 Stash。');
    if (!state.status.staged && !state.status.unstaged && !(payload.includeUntracked && state.status.untracked)) throw new Error('没有符合条件的修改可保存。');
    args = ['stash', 'push', ...(payload.includeUntracked ? ['--include-untracked'] : []), ...(payload.keepIndex ? ['--keep-index'] : []), ...(payload.message !== undefined ? ['-m', text(payload.message)] : [])];
  }
  if (['stash-apply', 'stash-pop', 'stash-drop', 'stash-branch'].includes(action)) {
    if (typeof payload.stash !== 'string' || !/^[a-f0-9]{40,64}$/.test(payload.stash)) throw new Error('请选择 Stash 的完整提交 ID。');
    const raw = await git(cwd, ['stash', 'list', '--format=%H']);
    const stashes = raw.trim().split('\n').filter(Boolean), index = stashes.indexOf(payload.stash);
    if (index < 0) throw new Error('所选 Stash 已不存在，请刷新。');
    extra.stash = payload.stash; extra.stashList = hash(raw);
    const selector = `stash@{${index}}`;
    if (action === 'stash-branch') {
      text(payload.name, 1024);
      if (payload.name.startsWith('-')) throw new Error('分支名无效。');
      await git(cwd, ['check-ref-format', `refs/heads/${payload.name}`]);
      const exists = await git(cwd, ['show-ref', '--verify', `refs/heads/${payload.name}`]).then(() => true, () => false);
      if (exists) throw new Error('同名分支已存在。');
      args = ['stash', 'branch', payload.name, selector];
      extra.branchAbsent = payload.name;
    } else args = ['stash', action.slice(6), ...(payload.reinstateIndex ? ['--index'] : []), selector];
  }
  if (action === 'discard') {
    const scope = payload.scope ?? 'working';
    if (!['working', 'all'].includes(scope)) throw new Error('丢弃范围无效。');
    const paths = selectedPaths(state, payload, f => f.index !== '?' && !f.conflict && (scope === 'all' || f.working !== ' '));
    if (scope === 'all' && !state.head) throw new Error('首次提交前不能从 HEAD 恢复文件。');
    args = ['restore', ...(scope === 'all' ? ['--source=HEAD', '--staged'] : []), '--worktree', '--', ...paths];
  }
  if (action === 'clean') {
    const paths = selectedPaths(state, payload, f => f.index === '?');
    args = ['clean', '-f', '--', ...paths];
  }
  if (action === 'stage-resolved') {
    const paths = selectedPaths(state, payload, f => f.conflict);
    args = ['add', '--', ...paths];
  }
  if (action === 'continue' || action === 'abort') {
    const operation = payload.operation;
    if (!['merge', 'rebase', 'cherry-pick', 'revert'].includes(operation)) throw new Error('进行中的操作类型无效。');
    const matches = operation === 'rebase' ? state.ongoing.some(x => x.startsWith('rebase-')) : state.ongoing.includes({ merge: 'MERGE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' }[operation]);
    if (!matches) throw new Error(`没有进行中的 ${operation} 操作。`);
    if (action === 'continue' && state.status.conflicts) throw new Error('请先解决并暂存全部冲突文件。');
    args = ['-c', 'core.editor=true', operation, `--${action}`];
  }
  return { cwd, args, extra, state };
}
