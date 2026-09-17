const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

let token = localStorage.getItem("ledger_token") || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("ledger_token", t);
  else localStorage.removeItem("ledger_token");
}

export function getToken() {
  return token;
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    setToken(null);
    window.location.href = "/login";
    throw new Error(data.error || "Session expired");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // auth
  register: (b) => request("/auth/register", { method: "POST", body: b }),
  login: (b) => request("/auth/login", { method: "POST", body: b }),
  me: () => request("/auth/me"),
  team: () => request("/auth/team"),
  addTeammate: (b) => request("/auth/team", { method: "POST", body: b }),
  updateOrg: (b) => request("/auth/org", { method: "PUT", body: b }),

  // products
  products: () => request("/products"),
  updateProduct: (id, b) => request(`/products/${id}`, { method: "PUT", body: b }),
  createProduct: (b) => request("/products", { method: "POST", body: b }),

  // leads
  searchLeads: (b) => request("/leads/search", { method: "POST", body: b }),
  importLeads: (rows) => request("/leads/import", { method: "POST", body: { rows } }),
  leads: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return request(`/leads?${q}`);
  },
  updateLead: (id, b) => request(`/leads/${id}`, { method: "PATCH", body: b }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),

  // campaigns
  campaigns: () => request("/campaigns"),
  campaign: (id) => request(`/campaigns/${id}`),
  createCampaign: (b) => request("/campaigns", { method: "POST", body: b }),
  updateEmail: (id, b) => request(`/campaigns/emails/${id}`, { method: "PATCH", body: b }),
  approveAll: (id) => request(`/campaigns/${id}/approve-all`, { method: "POST" }),
  sendCampaign: (id) => request(`/campaigns/${id}/send`, { method: "POST" }),

  // competitors
  competitors: () => request("/competitors"),
  researchCompetitors: (b) => request("/competitors/research", { method: "POST", body: b }),
  addCompetitor: (b) => request("/competitors", { method: "POST", body: b }),
  battlecard: (id) => request(`/competitors/${id}/battlecard`, { method: "POST" }),
  deleteCompetitor: (id) => request(`/competitors/${id}`, { method: "DELETE" }),

  // feedback
  logReply: (b) => request("/feedback/replies", { method: "POST", body: b }),
  replies: () => request("/feedback/replies"),
  stats: () => request("/feedback/stats"),
};
