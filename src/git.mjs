import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
export async function git(cwd, args, options = {}) {
  try {
    const { stdout } = await execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', cwd, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 24 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }, ...options,
    });
    return stdout;
  } catch (error) {
    throw new Error((error.stderr || error.message).trim(), { cause: error });
  }
}

export async function resolveRepository(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) {
    throw new Error('请提供仓库的绝对路径。');
  }
  const cwd = await realpath(input);
  const bare = (await git(cwd, ['rev-parse', '--is-bare-repository'])).trim() === 'true';
  const root = bare ? cwd : (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  return { root: await realpath(root), bare };
}

export function parseStatus(raw) {
  const records = raw.split('\0');
  const files = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const index = record[0], working = record[1];
    const file = { path: record.slice(3), index, working };
    if ('RC'.includes(index) || 'RC'.includes(working)) file.originalPath = records[++i];
    file.conflict = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(index + working);
    files.push(file);
  }
  return {
    files, total: files.length,
    staged: files.filter(f => f.index !== ' ' && f.index !== '?' && !f.conflict).length,
    unstaged: files.filter(f => f.working !== ' ' && f.working !== '?' && !f.conflict).length,
    untracked: files.filter(f => f.index === '?').length,
    conflicts: files.filter(f => f.conflict).length,
  };
}

export function parseWorktrees(raw) {
  const trees = []; let tree;
  for (const entry of raw.split('\0')) {
    if (!entry) { tree = undefined; continue; }
    const space = entry.indexOf(' ');
    const key = space < 0 ? entry : entry.slice(0, space);
    const value = space < 0 ? true : entry.slice(space + 1);
    if (key === 'worktree') { tree = { path: value }; trees.push(tree); }
    else if (tree) tree[key === 'HEAD' ? 'head' : key] = value;
  }
  return trees;
}

export function parseLog(raw) {
  const fields = raw.split('\0'); const commits = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const hash = fields[i].trim();
    if (!hash) continue;
    commits.push({ hash, parents: fields[i + 1].split(' ').filter(Boolean), author: fields[i + 2],
      email: fields[i + 3], date: fields[i + 4], subject: fields[i + 5] });
  }
  return commits;
}

async function mapLimited(items, count, fn) {
  const output = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; output[i] = await fn(items[i], i); }
  }));
  return output;
}

const logFormat = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00';
export async function snapshot(repositoryPath, { limit = 300, scope = '' } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('提交数量必须在 1–2000 之间。');
  const { root, bare } = await resolveRepository(repositoryPath);
  const [wtRaw, refsRaw, head] = await Promise.all([
    git(root, ['worktree', 'list', '--porcelain', '-z']),
    git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags', 'refs/stash']),
    git(root, ['rev-parse', '--verify', 'HEAD']).then(x => x.trim()).catch(() => null),
  ]);
  const refs = refsRaw.trimEnd().split('\n').filter(Boolean).map(line => {
    const [name, object, peeled, upstream, tracking, symbolic] = line.split('\0');
    return { name, hash: peeled || object, upstream, tracking, symbolic,
      shortName: name.replace(/^refs\/(heads|remotes|tags)\//, ''),
      type: name.startsWith('refs/heads/') ? 'branch' : name.startsWith('refs/remotes/') ? 'remote' : name.startsWith('refs/tags/') ? 'tag' : 'stash' };
  });
  const worktrees = await mapLimited(parseWorktrees(wtRaw), 4, async (wt) => {
    const normalize = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    const current = normalize(wt.path) === normalize(root);
    if (wt.bare) return { ...wt, current, status: null };
    try {
      const status = parseStatus(await git(wt.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
      return { ...wt, current, status };
    } catch (error) { return { ...wt, current, status: null, error: error.message }; }
  });
  // Detached worktree HEADs are not necessarily reachable from --all.
  const heads = [...new Set([head, ...worktrees.filter(w => !w.prunable).map(w => w.head)].filter(h => /^[a-f0-9]{40,64}$/.test(h || '') && !/^0+$/.test(h)))];
  let scopeHash;
  if (scope) {
    const ref = refs.find(r => r.name === scope);
    if (!ref) throw new Error('历史范围引用不存在，请刷新。');
    scopeHash = ref.hash;
  }
  let commits = [];
  if (heads.length || refs.length) {
    commits = parseLog(await git(root, ['log', '--topo-order', '--date-order', `--max-count=${limit + 1}`, `--format=${logFormat}`, ...(scopeHash ? [scopeHash] : ['--all', ...heads]), '--']));
  }
  const hasMore = commits.length > limit;
  const shallowPath = (await git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'shallow'])).trim();
  const shallow = new Set((await readFile(shallowPath, 'utf8').catch(() => '')).trim().split('\n'));
  for (const commit of commits) if (shallow.has(commit.hash)) {
    const raw = await git(root, ['cat-file', '-p', commit.hash]);
    commit.parents = raw.split('\n\n')[0].split('\n').filter(l => l.startsWith('parent ')).map(l => l.slice(7));
    commit.shallowBoundary = true;
  }
  const branch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(x => x.trim()).catch(() => null);
  return { repository: { path: root, name: path.basename(root), branch, head, bare },
    commits: commits.slice(0, limit), refs, worktrees, hasMore, limit, scope, scopeHash, snapshotVersion: Date.now().toString(), refreshedAt: new Date().toISOString() };
}

// Stop collecting large diffs while draining the process; don't fail on huge files.
export async function boundedDiff(cwd, args, maxBytes = 256 * 1024) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', cwd, ...args], {
      windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = []; let size = 0, truncated = false, error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('读取差异超时，请重试。')); }, 20000);
    child.stdout.on('data', buffer => {
      const remaining = Math.max(0, maxBytes - size);
      if (buffer.length > remaining) truncated = true;
      if (remaining) { chunks.push(buffer.subarray(0, remaining)); size += Math.min(buffer.length, remaining); }
    });
    child.stderr.on('data', b => { if (error.length < 4096) error += b.toString(); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(error || '无法读取差异。'));
      else resolve({ patch: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}

export async function commitDetail(repositoryPath, hash) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('无效的提交 ID。');
  const { root } = await resolveRepository(repositoryPath);
  const raw = await git(root, ['show', '-s', `--format=${logFormat}%b`, hash, '--']);
  const commit = parseLog(raw)[0];
  const body = raw.split('\0').slice(6).join('\0').trim();
  // Compare merges against their first parent; show root commits against empty tree.
  const result = await boundedDiff(root, ['show', '--format=', '--first-parent', '--diff-merges=first-parent',
    '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--stat', '--patch', hash, '--']);
  return { commit: { ...commit, body }, ...result };
}

export async function worktreeDetail(repositoryPath, worktreePath) {
  const { root } = await resolveRepository(repositoryPath);
  const worktrees = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain', '-z']));
  const canonical = await realpath(worktreePath);
  const matches = await Promise.all(worktrees.filter(w => !w.bare).map(w => realpath(w.path).catch(() => null)));
  if (!matches.includes(canonical)) throw new Error('所选目录不是该仓库的 Worktree。');
  const status = parseStatus(await git(canonical, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
  const [staged, unstaged] = await Promise.all([
    boundedDiff(canonical, ['diff', '--cached', ...flags, '--']),
    boundedDiff(canonical, ['diff', ...flags, '--']),
  ]);
  return { path: canonical, status, staged, unstaged };
}
