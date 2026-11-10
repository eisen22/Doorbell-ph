// =====================================================================
// firestore.js — TALKING TO FIREBASE FROM THE CLOUDFLARE WORKER
// ---------------------------------------------------------------------
// The Worker cannot use the Firebase website library, so it uses Firebase's plain web
// addresses (REST):
//   1. signIn():  signs in with an email + password (a Doorbell "gate" account) and gets a
//                 token. Firestore checks firestore.rules for this account, like for any user.
//   2. get(), list(), query(), commit(): read and write documents.
// Firestore sends values with their type ({ stringValue: 'x' }); fromValue/toValue convert
// between that and normal JavaScript values.
// =====================================================================

/** Firestore's typed value -> plain JavaScript. */
export function fromValue(v) {
  if (!v || 'nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
export function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = fromValue(v);
  return out;
}

/** Plain JavaScript -> Firestore's typed value. `undefined` fields are left out. */
export function toValue(x) {
  if (x === null) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.filter((y) => y !== undefined).map(toValue) } };
  if (typeof x === 'object') return { mapValue: { fields: toFields(x) } };
  return { nullValue: null };
}
export function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
  return out;
}

export class Firestore {
  constructor(env, fetchFn = fetch) {
    this.env = env;
    this.fetch = fetchFn;
    this.root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
    this.token = null;
    this.tokenUntil = 0;
  }

  // Signs in with the Worker's Doorbell account (a gate account made in Settings & SMS).
  async signIn() {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const res = await this.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.env.FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.env.GATE_EMAIL, password: this.env.GATE_PASSWORD, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Sign-in failed: ${json.error?.message ?? res.status}. Check GATE_EMAIL and GATE_PASSWORD.`);
    this.token = json.idToken;
    this.tokenUntil = Date.now() + (Number(json.expiresIn) - 120) * 1000; // renew 2 minutes early
    return this.token;
  }

  async call(url, init = {}) {
    const token = await this.signIn();
    const res = await this.fetch(url, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Firestore ${res.status}: ${json.error?.message ?? 'error'}`);
      err.status = json.error?.status;
      throw err;
    }
    return json;
  }

  /** One document as { id, data, updateTime }, or null. */
  async get(path) {
    try {
      const d = await this.call(`${this.base}/${path}`);
      return { id: d.name.split('/').pop(), data: fromFields(d.fields), updateTime: d.updateTime };
    } catch (e) {
      if (e.status === 'NOT_FOUND') return null;
      throw e;
    }
  }

  /** Several documents at once: paths like 'confirmations/abc'. Returns a Map path -> data (missing ones left out). */
  async getMany(paths) {
    const out = new Map();
    if (!paths.length) return out;
    const rows = await this.call(`${this.base}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: paths.map((p) => `${this.root}/${p}`) }) });
    for (const r of rows) if (r.found) out.set(r.found.name.split('/documents/')[1], fromFields(r.found.fields));
    return out;
  }

  /** Runs a query: collection + optional where filters [field, op, value] (op: EQUAL, IN, GREATER_THAN_OR_EQUAL...). */
  async query(collection, where = [], limit) {
    const filters = where.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } }));
    const structuredQuery = { from: [{ collectionId: collection }] };
    if (filters.length === 1) structuredQuery.where = filters[0];
    if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    if (limit) structuredQuery.limit = limit;
    const rows = await this.call(`${this.base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
    return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), data: fromFields(r.document.fields), updateTime: r.document.updateTime }));
  }

  /**
   * Writes several documents in one go (all or nothing). Each write:
   *   { path, data }                      -> replace the document
   *   { path, patch, ifUpdateTime }       -> change only these fields; with ifUpdateTime it fails if
   *                                          someone changed the document in between (used to claim a text)
   */
  async commit(writes) {
    for (let i = 0; i < writes.length; i += 450) {
      const body = {
        writes: writes.slice(i, i + 450).map((w) => {
          const name = `${this.root}/${w.path}`;
          if (w.patch) {
            const out = { update: { name, fields: toFields(w.patch) }, updateMask: { fieldPaths: Object.keys(w.patch) } };
            if (w.ifUpdateTime) out.currentDocument = { updateTime: w.ifUpdateTime };
            return out;
          }
          return { update: { name, fields: toFields(w.data) } };
        }),
      };
      await this.call(`${this.base}:commit`, { method: 'POST', body: JSON.stringify(body) });
    }
  }
}
