import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { api } from "../api.js";

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({ q: "", status: "", hasEmail: false, minScore: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const navigate = useNavigate();

  // search form
  const [icp, setIcp] = useState("Pelvic-floor physical therapy clinics and postpartum recovery centers");
  const [location, setLocation] = useState("United States");
  const [count, setCount] = useState(10);

  // campaign form
  const [showCampaign, setShowCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [tone, setTone] = useState("Professional & concise");
  const [useCompetitors, setUseCompetitors] = useState(false);

  const fileRef = useRef(null);

  async function load() {
    try {
      const data = await api.leads({
        q: filters.q,
        status: filters.status,
        hasEmail: filters.hasEmail ? "true" : "",
        minScore: filters.minScore,
      });
      setLeads(data.leads);
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [filters]);

  async function runSearch() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.searchLeads({ icp, location, count: Number(count) });
      setMsg({
        type: "good",
        text: `Found ${res.found}, added ${res.added} new${res.duplicates ? `, ${res.duplicates} already in your list` : ""}.`,
      });
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setBusy(true);
        try {
          const res = await api.importLeads(results.data);
          setMsg({ type: "good", text: `Imported ${res.added} of ${res.found} rows.` });
          load();
        } catch (err) {
          setMsg({ type: "bad", text: err.message });
        } finally {
          setBusy(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      },
    });
  }

  async function createCampaign() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.createCampaign({
        name: campaignName || `Outreach ${new Date().toLocaleDateString()}`,
        leadIds: [...selected],
        tone,
        useCompetitorContext: useCompetitors,
      });
      navigate(`/campaigns/${res.campaign.id}`);
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
      setBusy(false);
    }
  }

  const eligible = leads.filter((l) => l.email && !l.suppressed);
  const selectedEligible = [...selected].filter((id) => eligible.some((l) => l.id === id));

  function toggle(id) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected((p) => {
      const all = eligible.length > 0 && eligible.every((l) => p.has(l.id));
      const n = new Set(p);
      eligible.forEach((l) => (all ? n.delete(l.id) : n.add(l.id)));
      return n;
    });
  }

  async function deleteOne(lead) {
    if (!window.confirm(
      `Delete "${lead.name}"? This can't be undone, and if this lead was already part of a campaign, its email history will be deleted too.`
    )) return;
    try {
      await api.deleteLead(lead.id);
      setSelected((p) => {
        const n = new Set(p);
        n.delete(lead.id);
        return n;
      });
      await load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(
      `Delete ${ids.length} selected lead${ids.length === 1 ? "" : "s"}? This can't be undone, and any email history already sent to them will be deleted too.`
    )) return;
    try {
      for (const id of ids) await api.deleteLead(id);
      setSelected(new Set());
      await load();
      setMsg({ type: "good", text: `${ids.length} lead${ids.length === 1 ? "" : "s"} deleted.` });
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  return (
    <>
      <h1 className="page-title">Leads</h1>
      <p className="lede">
        Search the public web for businesses that fit your product, or import a list you already have.
      </p>

      {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        {/* sidebar */}
        <div>
          <div className="panel">
            <h3>Find new leads</h3>
            <div className="note" style={{ marginBottom: 12 }}>
              Searches for businesses only, never private individuals, and only returns companies it found real
              evidence for. Verify an address on the company's own site before emailing.
            </div>
            <div className="field">
              <label className="label">Type of customer</label>
              <textarea className="textarea" rows={3} value={icp} onChange={(e) => setIcp(e.target.value)} />
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label">Location</label>
                <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div className="field" style={{ width: 76, marginBottom: 0 }}>
                <label className="label">Count</label>
                <select className="select" value={count} onChange={(e) => setCount(e.target.value)}>
                  {[5, 10, 15, 20, 25].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <button className="btn plum" style={{ width: "100%", marginTop: 12 }} onClick={runSearch} disabled={busy}>
              {busy ? <><span className="spinner" /> Searching…</> : "Search the web"}
            </button>
            <label className="btn ghost" style={{ width: "100%", marginTop: 8, display: "block", textAlign: "center" }}>
              <input type="file" accept=".csv" ref={fileRef} onChange={onFile} style={{ display: "none" }} />
              Import CSV instead
            </label>
          </div>

          <div className="panel">
            <h3>Filter</h3>
            <div className="field">
              <label className="label">Search</label>
              <input className="input" placeholder="name, category, location…" value={filters.q}
                     onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Status</label>
              <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All</option>
                {["new","queued","contacted","replied","interested","not_interested","bounced","unsubscribed"].map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Minimum fit score</label>
              <select className="select" value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}>
                <option value="">Any</option>
                <option value="50">50+</option>
                <option value="70">70+</option>
                <option value="85">85+</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={filters.hasEmail}
                     onChange={(e) => setFilters({ ...filters, hasEmail: e.target.checked })} />
              Only leads with an email
            </label>
          </div>
        </div>

        {/* main */}
        <div>
          <div className="spread" style={{ marginBottom: 10 }}>
            <label className="check">
              <input type="checkbox" checked={eligible.length > 0 && eligible.every((l) => selected.has(l.id))} onChange={toggleAll} />
              Select all contactable ({eligible.length})
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn plum" disabled={!selectedEligible.length} onClick={() => setShowCampaign(true)}>
                Draft campaign ({selectedEligible.length})
              </button>
              <button className="btn ghost" disabled={!selected.size} onClick={deleteSelected}>
                Delete selected ({selected.size})
              </button>
            </div>
          </div>

          {showCampaign && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <h3>New campaign</h3>
              <div className="field">
                <label className="label">Campaign name</label>
                <input className="input" value={campaignName} placeholder="e.g. West coast clinics — March"
                       onChange={(e) => setCampaignName(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Tone</label>
                <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option>Professional & concise</option>
                  <option>Warm & consultative</option>
                  <option>Direct & confident</option>
                </select>
              </div>
              <label className="check">
                <input type="checkbox" checked={useCompetitors} onChange={(e) => setUseCompetitors(e.target.checked)} />
                Use competitor research to sharpen positioning
              </label>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn plum" onClick={createCampaign} disabled={busy}>
                  {busy ? <><span className="spinner" /> Drafting {selectedEligible.length} emails…</> : "Draft emails"}
                </button>
                <button className="btn ghost" onClick={() => setShowCampaign(false)} disabled={busy}>Cancel</button>
              </div>
              <div className="hint">Nothing is sent yet — you'll review every draft on the next screen.</div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th><th>Fit</th><th>Name</th><th>Category</th><th>Location</th>
                  <th>Email</th><th>Website</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className={selected.has(l.id) ? "selected" : ""}>
                    <td>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)}
                             disabled={!l.email || l.suppressed} />
                    </td>
                    <td className="mono">{l.fit_score ?? "—"}</td>
                    <td title={l.description}>{l.name}</td>
                    <td>{l.category || "—"}</td>
                    <td>{l.location || "—"}</td>
                    <td title={l.email}>{l.email || <span style={{ color: "var(--ink-soft)" }}>none found</span>}</td>
                    <td>
                      {l.website ? (
                        <a href={l.website} target="_blank" rel="noreferrer">
                          {l.website.replace(/^https?:\/\//, "").slice(0, 24)}
                        </a>
                      ) : "—"}
                    </td>
                    <td>
                      <span className={`pill ${l.status}`}>{l.status.replace("_", " ")}</span>
                      {l.suppressed && <span className="pill unsubscribed" style={{ marginLeft: 4 }}>opted out</span>}
                    </td>
                    <td>
                      <button className="btn ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() => deleteOne(l)} title="Delete this lead">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {leads.length === 0 && <div className="empty">No leads match. Run a search to get started.</div>}
        </div>
      </div>
    </>
  );
}
