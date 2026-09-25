// Neon-backed replacement for the app's former Firebase layer (src/firebase.ts).
//
// Auth: Neon Auth (Google sign-in). Data: the server's /api/data routes, which store
// each collection in Postgres scoped to the signed-in user (see server-data.ts).
//
// The exports deliberately mirror the slice of the Firebase API the app uses, with
// the same call signatures, so components only needed their import path changed.
// Snapshot listeners refresh after any write this tab makes to the same collection.

import { createAuthClient } from '@neondatabase/neon-js/auth';

export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL);

// --- Auth -------------------------------------------------------------------

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

type AuthListener = (user: User | null) => void;
const authListeners = new Set<AuthListener>();

// Stand-ins for Firebase's auth instance and provider objects.
export const auth: { currentUser: User | null } = { currentUser: null };
export const googleProvider = { providerId: 'google' } as const;

function setCurrentUser(u: any) {
  auth.currentUser = u
    ? { uid: u.id, email: u.email ?? null, displayName: u.name ?? null, photoURL: u.image ?? null, emailVerified: !!u.emailVerified }
    : null;
  return auth.currentUser;
}

async function currentSession() {
  const { data } = await authClient.getSession();
  return data?.session && data?.user ? data : null;
}

export function onAuthStateChanged(_auth: typeof auth, listener: AuthListener) {
  authListeners.add(listener);
  currentSession()
    .then((s) => listener(setCurrentUser(s?.user)))
    .catch((err) => {
      console.error('Failed to load session:', err);
      listener(setCurrentUser(null));
    });
  return () => { authListeners.delete(listener); };
}

// Redirects to Google; the session is picked up by onAuthStateChanged on return.
export async function signInWithPopup(_auth: typeof auth, _provider: typeof googleProvider) {
  const { error } = await authClient.signIn.social({
    provider: 'google',
    callbackURL: window.location.origin,
  });
  if (error) throw new Error(error.message || 'Google sign-in failed');
}

export async function signOut(_auth: typeof auth) {
  await authClient.signOut();
  setCurrentUser(null);
  virtualDocs.clear();
  authListeners.forEach((l) => l(null));
}

// --- Errors -----------------------------------------------------------------

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const info = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId: auth.currentUser?.uid ?? null,
  };
  console.error('Data API error: ', JSON.stringify(info));
  throw new Error(JSON.stringify(info));
}

// --- Data -------------------------------------------------------------------

type Filter = { field: string; value: unknown };
export interface CollectionRef { kind: 'collection'; name: string }
export interface DocRef { kind: 'doc'; name: string; id: string }
export interface QueryRef { kind: 'query'; name: string; filters: Filter[] }

export interface DocSnapshot {
  id: string;
  ref: DocRef;
  exists(): boolean;
  data(): any;
}
export interface QuerySnapshot {
  docs: DocSnapshot[];
  empty: boolean;
  size: number;
}

// Mimics Firestore's Timestamp for server-maintained fields, so `x.updatedAt.toDate()`
// keeps working. Serialises back to an ISO string.
export class Timestamp {
  constructor(private readonly iso: string) {}
  toDate() { return new Date(this.iso); }
  toMillis() { return this.toDate().getTime(); }
  get seconds() { return Math.floor(this.toMillis() / 1000); }
  toJSON() { return this.iso; }
  toString() { return this.iso; }
}
const TIMESTAMP_FIELDS = ['updatedAt', 'createdAt'];

function hydrate(data: any) {
  if (!data) return data;
  for (const f of TIMESTAMP_FIELDS) {
    if (typeof data[f] === 'string') data[f] = new Timestamp(data[f]);
  }
  return data;
}

// Kept so call sites read the same as before; there is only one database.
export const db = null;

export function collection(_db: unknown, name: string): CollectionRef {
  return { kind: 'collection', name };
}

export function doc(_db: unknown, name: string, id: string): DocRef {
  return { kind: 'doc', name, id };
}

export function where(field: string, _op: '==', value: unknown): Filter {
  return { field, value };
}

export function query(ref: CollectionRef, ...filters: Filter[]): QueryRef {
  return { kind: 'query', name: ref.name, filters };
}

// The server stamps updated/created times itself.
export function serverTimestamp() {
  return undefined;
}

// JSON request to this app's server with the signed-in user's token attached.
export async function authedFetch(method: string, url: string, body?: unknown) {
  const session = await currentSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.session.token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `${method} ${url} failed (${res.status} ${res.statusText})`);
  }
  return res.status === 204 ? null : res.json();
}

const api = (method: string, path: string, body?: unknown) => authedFetch(method, `/api/data/${path}`, body);

// --- Virtual (read-only) documents --------------------------------------------
// Documents supplied by another source rather than the database - the Trading Bot
// tab's positions and trades. They show up in getDocs/getDoc/onSnapshot results like
// stored documents (filters apply), but any write to them is refused.

export const VIRTUAL_ID_PREFIX = 'bot:';
const isVirtualId = (id: unknown) => typeof id === 'string' && id.startsWith(VIRTUAL_ID_PREFIX);
const virtualDocs = new Map<string, { id: string; data: any }[]>();

export function setVirtualDocs(name: string, docs: { id: string; data: any }[]) {
  virtualDocs.set(name, docs);
  notifyChanged(name);
}

function assertWritable(ref: DocRef | CollectionRef, data?: any) {
  if ((ref.kind === 'doc' && isVirtualId(ref.id)) || isVirtualId(data?.holdingId) || data?.portfolioType === 'bot') {
    throw new Error('Trading Bot positions are managed by the bot and are read-only here. Use Close Position to sell.');
  }
}

function snapshotOf(name: string, id: string, data: any): DocSnapshot {
  const hydrated = hydrate(data);
  return { id, ref: doc(null, name, id), exists: () => hydrated != null, data: () => hydrated ?? undefined };
}

export async function getDocs(ref: QueryRef | CollectionRef): Promise<QuerySnapshot> {
  // Every query is already scoped to the signed-in user server-side.
  const filters = (ref.kind === 'query' ? ref.filters : []).filter((f) => f.field !== 'userId');
  let rows: { id: string; data: any }[] = [];
  // A filter on a virtual id can only match virtual documents.
  if (!filters.some((f) => isVirtualId(f.value))) {
    const params = new URLSearchParams();
    for (const f of filters) params.set(f.field, String(f.value));
    const qs = params.toString();
    rows = await api('GET', `${ref.name}${qs ? `?${qs}` : ''}`);
  }
  const virtual = (virtualDocs.get(ref.name) ?? []).filter((d) => filters.every((f) => d.data[f.field] === f.value));
  const docs = [...rows, ...virtual].map((r) => snapshotOf(ref.name, r.id, { ...r.data }));
  return { docs, empty: docs.length === 0, size: docs.length };
}

export async function getDoc(ref: DocRef): Promise<DocSnapshot> {
  if (isVirtualId(ref.id)) {
    const hit = virtualDocs.get(ref.name)?.find((d) => d.id === ref.id);
    return snapshotOf(ref.name, ref.id, hit ? { ...hit.data } : null);
  }
  const row = await api('GET', `${ref.name}/${encodeURIComponent(ref.id)}`);
  return snapshotOf(ref.name, ref.id, row?.data ?? null);
}

// There is no client cache, so this is the same as getDoc.
export const getDocFromServer = getDoc;

const changeListeners = new Map<string, Set<() => void>>();
let batchDepth = 0;
const pendingChanges = new Set<string>();

function notifyChanged(name: string) {
  if (batchDepth > 0) {
    pendingChanges.add(name);
    return;
  }
  changeListeners.get(name)?.forEach((l) => l());
}

// Holds back snapshot refreshes until `fn` finishes, so listeners never observe a
// half-written multi-step change (e.g. a holding whose transactions aren't saved yet).
export async function withBatchedUpdates<T>(fn: () => Promise<T>): Promise<T> {
  batchDepth++;
  try {
    return await fn();
  } finally {
    if (--batchDepth === 0) {
      const names = [...pendingChanges];
      pendingChanges.clear();
      names.forEach(notifyChanged);
    }
  }
}

export async function addDoc(ref: CollectionRef, data: object): Promise<DocRef> {
  assertWritable(ref, data);
  const row = await api('POST', ref.name, data);
  notifyChanged(ref.name);
  return doc(null, ref.name, row.id);
}

// Inserts many documents in one request and one database transaction.
export async function addDocs(ref: CollectionRef, items: object[]): Promise<DocRef[]> {
  if (items.length === 0) return [];
  items.forEach((item) => assertWritable(ref, item));
  const rows: { id: string }[] = await api('POST', ref.name, items);
  notifyChanged(ref.name);
  return rows.map((r) => doc(null, ref.name, r.id));
}

export async function setDoc(ref: DocRef, data: object, options?: { merge?: boolean }) {
  assertWritable(ref, data);
  await api('PUT', `${ref.name}/${encodeURIComponent(ref.id)}${options?.merge ? '?merge=1' : ''}`, data);
  notifyChanged(ref.name);
}

export async function updateDoc(ref: DocRef, data: object) {
  assertWritable(ref, data);
  await api('PATCH', `${ref.name}/${encodeURIComponent(ref.id)}`, data);
  notifyChanged(ref.name);
}

export async function deleteDoc(ref: DocRef) {
  assertWritable(ref);
  await api('DELETE', `${ref.name}/${encodeURIComponent(ref.id)}`);
  notifyChanged(ref.name);
}

export function onSnapshot(ref: DocRef, next: (snap: DocSnapshot) => void, error?: (err: unknown) => void): () => void;
export function onSnapshot(ref: QueryRef | CollectionRef, next: (snap: QuerySnapshot) => void, error?: (err: unknown) => void): () => void;
export function onSnapshot(ref: DocRef | QueryRef | CollectionRef, next: (snap: any) => void, error?: (err: unknown) => void) {
  let active = true;
  let pending: Promise<void> | null = null;
  let stale = false;

  // Coalesce bursts of writes (e.g. an import adding many rows) into sequential refetches.
  const refresh = () => {
    if (pending) { stale = true; return; }
    pending = (ref.kind === 'doc' ? getDoc(ref) : getDocs(ref))
      .then((snap) => { if (active) next(snap); })
      .catch((err) => { if (active) (error ?? console.error)(err); })
      .finally(() => {
        pending = null;
        if (stale && active) { stale = false; refresh(); }
      });
  };

  if (!changeListeners.has(ref.name)) changeListeners.set(ref.name, new Set());
  changeListeners.get(ref.name)!.add(refresh);
  refresh();

  return () => {
    active = false;
    changeListeners.get(ref.name)?.delete(refresh);
  };
}
