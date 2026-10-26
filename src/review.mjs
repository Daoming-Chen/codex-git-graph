import { realpath, lstat, open, readlink } from 'node:fs/promises';
import path from 'node:path';
import { git, resolveRepository, boundedDiff } from './git.mjs';
import { filesDetail, fileDiff, resolveRef } from './actions.mjs';

const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
const maximum = 256 * 1024;
const inside = (root, target) => { const relative = path.relative(root, target); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const fields = raw => raw.replace(/\n$/, '').split('\0');
// Metadata is returned to both the panel and model. Remote URLs are display
// values only: never send embedded credentials back as editable defaults.
const redactMetadata = value => String(value)
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi, '$1[redacted]@')
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
  .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s&#"']+/gi, '$1[redacted]')
  .replace(/((?:access[_-]?token|private[_-]?token|api[_-]?key|token|password|authorization|secret)\s*[:=]\s*)([^\s&#"']+)/gi, '$1[redacted]');
const metadata = fn => async (...args) => {
  try { return await fn(...args); }
  catch (error) { throw new Error(redactMetadata(error.message)); }
};

export const repositoryInfo = metadata(async repository => {
  const { root } = await resolveRepository(repository);
  const names = (await git(root, ['remote'])).trim().split('\n').filter(Boolean);
  const remotes = await Promise.all(names.map(async name => {
    const fetchUrl = (await git(root, ['remote', 'get-url', '--', name])).trim();
    const pushUrl = (await git(root, ['remote', 'get-url', '--push', '--', name])).trim();
    return { name, fetchUrl: redactMetadata(fetchUrl), pushUrl: redactMetadata(pushUrl), credentialsRedacted: fetchUrl !== redactMetadata(fetchUrl) || pushUrl !== redactMetadata(pushUrl) };
  }));
  const raw = await git(root, ['stash', 'list', '--format=%H%x00%gd%x00%gs%x00%cI%x00']);
  const parts = raw.split('\0'), stashes = [];
  for (let i = 0; i + 3 < parts.length; i += 4) if (parts[i].trim()) stashes.push({ hash: parts[i].trim(), ref: parts[i + 1], message: parts[i + 2], date: parts[i + 3] });
  return { remotes, stashes };
});

export const commitInfo = metadata(async (repository, hash) => {
  const { root } = await resolveRepository(repository);
  const resolved = (await resolveRef(root, hash)).hash;
  const raw = fields(await git(root, ['show', '-s', '--format=%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%G?%x00%GS%x00%GK%x00%B', resolved, '--']));
  const refs = (await git(root, ['for-each-ref', `--contains=${resolved}`, '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'])).trim().split('\n').filter(Boolean);
  const includedInHead = await git(root, ['merge-base', '--is-ancestor', resolved, 'HEAD']).then(() => true, () => false);
  return { hash: raw[0], author: { name: raw[1], email: raw[2], date: raw[3] }, committer: { name: raw[4], email: raw[5], date: raw[6] }, signature: { status: raw[7], signer: raw[8], key: raw[9] }, message: raw[10] || '', includedInHead, branches: refs.filter(r => !r.startsWith('refs/tags/')), tags: refs.filter(r => r.startsWith('refs/tags/')) };
});

export const refInfo = metadata(async (repository, ref) => {
  const { root } = await resolveRepository(repository);
  if (typeof ref !== 'string' || !ref.startsWith('refs/')) throw new Error('请提供完整引用名。');
  await git(root, ['check-ref-format', ref]);
  await git(root, ['show-ref', '--verify', ref]);
  const raw = fields(await git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(taggername)%00%(taggeremail)%00%(taggerdate:iso-strict)%00%(contents)', ref]));
  if (raw[0] !== ref) throw new Error('引用不存在。');
  return { ref, hash: raw[1], annotated: raw[2] === 'tag', tagger: raw[3], email: raw[4]?.replace(/^<|>$/g, ''), date: raw[5], message: raw[6] || '' };
});

function changedNames(raw) {
  const parts = raw.split('\0'), files = [];
  for (let i = 0; i < parts.length && parts[i];) {
    const status = parts[i++], originalPath = /^[RC]/.test(status) ? parts[i++] : undefined;
    const name = parts[i++];
    files.push({ id: `comparison:${name}`, path: name, originalPath, status, group: 'comparison' });
  }
  return files;
}

export async function reviewFiles(repository, input) {
  if (!input.worktreePath || !input.a) return filesDetail(repository, input);
  const current = await filesDetail(repository, { worktreePath: input.worktreePath });
  const a = (await resolveRef(repository, input.a)).hash;
  const raw = await git(current.path, ['diff', ...flags, '--name-status', '-z', a, '--']);
  const files = changedNames(raw);
  // A path deleted from the index and recreated as untracked must be compared
  // against its historical blob, not presented as a second independent file.
  for (const file of current.files.filter(f => f.group === 'untracked')) {
    const trackedChange = files.find(f => f.path === file.path);
    if (trackedChange) { trackedChange.status = 'M'; trackedChange.untrackedReplacement = true; }
    else files.push({ ...file });
  }
  return { ...current, comparison: true, a, b: null, files, untrackedNote: '未跟踪文件按新增文件显示；历史比较不修改暂存区。' };
}

export async function reviewDiff(repository, input) {
  if (!input.worktreePath || !input.a) return fileDiff(repository, input);
  const detail = await reviewFiles(repository, input);
  if (input.version && input.version !== detail.version) throw new Error('文件状态已变化，请刷新后重新查看。');
  const file = detail.files.find(f => f.id === input.fileId);
  if (!file) throw new Error('文件已不在变更清单中，请刷新后重试。');
  if (file.group === 'untracked') return fileDiff(repository, { worktreePath: detail.path, fileId: file.id, version: detail.version });
  if (file.untrackedReplacement) {
    // Git excludes an untracked replacement from `diff <commit>`; give both
    // bounded versions explicitly instead of falsely reporting a deletion.
    const before = await fileContent(repository, { ...input, revision: 'before' });
    const after = await fileContent(repository, { ...input, revision: 'current' });
    const previous = before.text ? before.text.replace(/\n$/, '').split('\n') : [], next = after.text ? after.text.replace(/\n$/, '').split('\n') : [];
    const binary = before.binary || after.binary;
    return { file, binary, truncated: before.truncated || after.truncated, patch: binary ? '' : `--- a/${file.path}\n+++ b/${file.path}\n@@ -${previous.length ? 1 : 0},${previous.length} +${next.length ? 1 : 0},${next.length} @@\n` + previous.map(l => '-' + l).concat(next.map(l => '+' + l)).join('\n') };
  }
  const paths = [...new Set([file.originalPath, file.path].filter(Boolean))].map(p => `:(literal)${p}`);
  const result = await boundedDiff(detail.path, ['diff', ...flags, detail.a, '--', ...paths]);
  return { ...result, file, binary: /Binary files |GIT binary patch/.test(result.patch), submodule: /Subproject commit/.test(result.patch) };
}

async function currentContent(root, name) {
  const full = path.resolve(root, name);
  if (!inside(root, full) || path.isAbsolute(name) || name.includes('\0')) throw new Error('文件路径越界。');
  // A symlink itself is shown as link text; ancestor symlinks may not escape.
  const stat = await lstat(full).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (!stat) return { text: '', missing: true, binary: false, truncated: false };
  const parent = await realpath(path.dirname(full));
  if (!inside(await realpath(root), parent)) throw new Error('文件真实路径越界。');
  if (stat.isDirectory()) return { text: '', submodule: true, binary: false, truncated: false };
  if (stat.isSymbolicLink()) return { text: await readlink(full), symlink: true, binary: false, truncated: false };
  const handle = await open(full, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maximum));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0), bytes = buffer.subarray(0, bytesRead);
    const binary = bytes.subarray(0, 8192).includes(0);
    return { text: binary ? '' : bytes.toString('utf8'), binary, truncated: stat.size > maximum };
  } finally { await handle.close(); }
}

export async function fileContent(repository, input) {
  const revision = input.revision || 'after';
  if (!['current', 'before', 'after'].includes(revision)) throw new Error('文件版本无效。');
  const detail = await reviewFiles(repository, input);
  if (input.version && detail.version !== input.version) throw new Error('文件状态已变化，请刷新后重新查看。');
  const file = detail.files.find(f => f.id === input.fileId);
  if (!file) throw new Error('文件不在变更清单中。');
  const { root, bare } = await resolveRepository(repository);
  const name = revision === 'before' ? file.originalPath || file.path : file.path;
  if (revision === 'current' || (detail.kind === 'worktree' && revision === 'after' && (detail.comparison || file.group !== 'staged'))) {
    if (bare) throw new Error('裸仓库没有当前工作目录文件。');
    return { path: name, revision, ...await currentContent(detail.path || root, name) };
  }
  const indexVersion = detail.kind === 'worktree' && !detail.comparison && ((revision === 'after' && file.group === 'staged') || (revision === 'before' && file.group === 'unstaged'));
  const hash = indexVersion ? '' : revision === 'before' ? detail.a || detail.head : detail.b;
  if ((!hash && !indexVersion) || (revision === 'before' && ['A', '?'].includes(file.status[0]))) return { path: name, revision, text: '', missing: true, binary: false, truncated: false };
  if (revision === 'after' && file.status[0] === 'D') return { path: name, revision, text: '', missing: true, binary: false, truncated: false };
  const result = await boundedDiff(detail.path || root, ['show', `${hash}:${name}`]);
  const binary = result.patch.slice(0, 8192).includes('\0');
  return { path: name, revision, hash, text: binary ? '' : result.patch, binary, truncated: result.truncated };
}
