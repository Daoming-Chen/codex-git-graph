export class StaleWorkspaceError extends Error {
  constructor() { super('仓库已切换，已忽略先前请求。'); this.name = 'StaleWorkspaceError'; }
}
export const isStaleWorkspace = error => error instanceof StaleWorkspaceError;

// Epochs, rather than path equality, also reject an A → B → A response.
export function createWorkspaceSession() {
  let epoch = 0, controller = new AbortController();
  return {
    capture() { const current = epoch; return { signal: controller.signal, assert() { if (current !== epoch) throw new StaleWorkspaceError(); }, current: () => current === epoch }; },
    invalidate() { epoch++; controller.abort(); controller = new AbortController(); },
  };
}

export function resetRepositoryState(state) {
  state.detailRequest++; state.diffRequest++; state.refreshRequest++;
  Object.assign(state, { data:null, repositoryPath:null, active:null, selected:null, limit:300, scope:'', rows:[], detailInput:null, detail:null, file:null, matches:[], match:-1, compare:null, compareStart:null, menuRow:null, message:'', pending:false });
  state.checked.clear();
}
