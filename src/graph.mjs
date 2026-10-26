// A frontier layout: every edge connects row centers to the frontier at row edges.
// Reserving lane slots keeps unrelated branches from jumping when another ends.
export function layoutGraph(commits, worktrees = []) {
  const heads = new Map();
  for (const wt of worktrees) {
    if (wt.status?.total && wt.head && !/^0+$/.test(wt.head)) {
      const group = heads.get(wt.head) || []; group.push(wt); heads.set(wt.head, group);
    }
  }
  const nodes = [];
  for (const wt of worktrees) if (wt.status && !wt.bare && (!wt.head || /^0+$/.test(wt.head))) nodes.push({ id: `worktree:${wt.path}`, parents: [], kind: 'working', worktree: wt });
  for (const commit of commits) {
    for (const wt of heads.get(commit.hash) || []) {
      nodes.push({ id: `worktree:${wt.path}`, parents: [commit.hash], kind: 'working', worktree: wt });
    }
    nodes.push({ ...commit, id: commit.hash, kind: 'commit' });
  }
  let lanes = []; let nextColor = 0; let width = 1;
  const colors = new Map();
  const loaded = new Set(nodes.map(n => n.id));
  const color = id => { if (!colors.has(id)) colors.set(id, nextColor++ % 7); return colors.get(id); };
  const rows = nodes.map(node => {
    let column = lanes.findIndex(l => l?.id === node.id);
    if (column < 0) {
      column = lanes.findIndex(l => !l);
      if (column < 0) column = lanes.length;
      lanes[column] = { id: node.id, color: color(node.id) };
    }
    const before = lanes.map(l => l && { ...l });
    const nodeColor = lanes[column].color;
    lanes[column] = null;
    const outgoing = [];
    node.parents.forEach((parent, index) => {
      if (!loaded.has(parent)) { outgoing.push({ from: column, to: column, color: nodeColor, boundary: true }); return; }
      let target = lanes.findIndex(l => l?.id === parent);
      if (target < 0) {
        target = index === 0 && !lanes[column] ? column : lanes.findIndex(l => !l);
        if (target < 0) target = lanes.length;
        const parentColor = index === 0 ? nodeColor : color(parent);
        lanes[target] = { id: parent, color: parentColor };
        colors.set(parent, parentColor);
      }
      outgoing.push({ from: column, to: target, color: index === 0 ? nodeColor : lanes[target].color });
    });
    const passing = before.flatMap((lane, index) => lane && index !== column ? [{ from: index, to: index, color: lane.color }] : []);
    width = Math.max(width, before.length, lanes.length);
    while (lanes.length && !lanes.at(-1)) lanes.pop();
    return { ...node, column, color: nodeColor, passing, outgoing, incoming: before[column] ? [{ from: column, to: column, color: nodeColor }] : [] };
  });
  // Newly introduced tips have no incoming edge from a preceding row.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const previous = rows[i - 1];
    if (!previous || ![...previous.outgoing, ...previous.passing].some(e => e.to === row.column)) row.incoming = [];
  }
  return { rows, width };
}
