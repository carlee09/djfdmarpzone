// Supabase REST API 클라이언트

export class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.headers = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };
  }

  async from(table) {
    return new SupabaseQuery(this.url, this.headers, table);
  }

  async insert(table, data) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...this.headers, 'Prefer': 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase insert error: ${await res.text()}`);
    return res.json();
  }

  async update(table, data, filters) {
    const params = new URLSearchParams(filters);
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: { ...this.headers, 'Prefer': 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase update error: ${await res.text()}`);
    return res.json();
  }

  async select(table, filters = {}, columns = '*') {
    const params = new URLSearchParams({ select: columns, ...filters });
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Supabase select error: ${await res.text()}`);
    return res.json();
  }
}

export function createClient(env) {
  return new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}
