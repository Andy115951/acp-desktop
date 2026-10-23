import { Store } from "@tauri-apps/plugin-store";
import { PREFS_KEY_LAST_CWD, sessionPrefsKey } from "../lib/sessionPrefs";
import { editSession, invalidateSession, readSessionCatalog, rememberSession, sessionCatalogKey, type SessionCatalog } from "../lib/sessionCatalog";
import { WORKSPACE_HISTORY_KEY, readWorkspaceHistory, visitWorkspace, type WorkspaceHistory } from "../lib/workspaceHistory";

let storePromise: Promise<Store> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Serialize read/modify/write, including migration, so rapid statuses cannot lose entries. */
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}

async function store(): Promise<Store> {
  storePromise ??= Store.load("prefs.json").catch((error) => { storePromise = undefined; throw error; });
  return storePromise;
}

async function read(agentId: string): Promise<{ prefs: Store; catalog: SessionCatalog }> {
  const prefs = await store();
  const key = sessionCatalogKey(agentId);
  const value = await prefs.get<unknown>(key);
  const catalog = readSessionCatalog(value, value == null ? await prefs.get<unknown>(sessionPrefsKey(agentId)) : undefined);
  if (value == null) {
    await prefs.set(key, catalog);
    await prefs.save();
  }
  return { prefs, catalog };
}

export function loadSessionCatalog(agentId: string): Promise<SessionCatalog> {
  return serialized(async () => (await read(agentId)).catalog);
}

export function saveKnownSession(agentId: string, cwd: string, sessionId: string): Promise<SessionCatalog> {
  return serialized(async () => {
    const { prefs, catalog } = await read(agentId);
    const next = rememberSession(catalog, cwd, sessionId, Date.now());
    await prefs.set(sessionCatalogKey(agentId), next);
    await prefs.save();
    return next;
  });
}

export function markSessionUnavailable(agentId: string, cwd: string, sessionId: string): Promise<SessionCatalog> {
  return serialized(async () => {
    const { prefs, catalog } = await read(agentId);
    const next = invalidateSession(catalog, cwd, sessionId);
    await prefs.set(sessionCatalogKey(agentId), next);
    await prefs.save();
    return next;
  });
}

export function editKnownSession(agentId: string, cwd: string, sessionId: string,
  change: { title: string } | { archivedAt: number | null }): Promise<SessionCatalog> {
  return serialized(async () => {
    const { prefs, catalog } = await read(agentId);
    const key = sessionCatalogKey(agentId);
    const next = editSession(catalog, cwd, sessionId, change);
    try { await prefs.set(key, next); await prefs.save(); }
    catch (error) {
      // Keep a failed explicit edit out of the shared in-memory store too.
      await prefs.set(key, catalog).catch(() => undefined);
      throw error;
    }
    return next;
  });
}

export function loadWorkspaceHistory(): Promise<WorkspaceHistory> {
  return serialized(async () => {
    const prefs = await store();
    return readWorkspaceHistory(await prefs.get<unknown>(WORKSPACE_HISTORY_KEY), await prefs.get<unknown>(PREFS_KEY_LAST_CWD));
  });
}

export function saveWorkspaceVisit(cwd: string): Promise<WorkspaceHistory> {
  return serialized(async () => {
    const prefs = await store();
    const oldValue = await prefs.get<unknown>(WORKSPACE_HISTORY_KEY);
    const lastCwd = await prefs.get<unknown>(PREFS_KEY_LAST_CWD);
    const history = visitWorkspace(readWorkspaceHistory(oldValue, lastCwd), cwd, Date.now());
    try {
      await prefs.set(WORKSPACE_HISTORY_KEY, history);
      await prefs.set(PREFS_KEY_LAST_CWD, cwd);
      await prefs.save();
    }
    catch (error) {
      await prefs.set(WORKSPACE_HISTORY_KEY, oldValue ?? null).catch(() => undefined);
      await prefs.set(PREFS_KEY_LAST_CWD, lastCwd ?? null).catch(() => undefined);
      throw error;
    }
    return history;
  });
}
