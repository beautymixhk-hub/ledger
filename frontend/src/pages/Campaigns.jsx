import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState("");

  function load() {
    api.campaigns().then(setCampaigns).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function deleteCampaign(c) {
    const warning = c.sent > 0
      ? `Delete "${c.name}"? It has ${c.sent} sent email${c.sent === 1 ? "" : "s"} — that sending history will be permanently deleted too. This can't be undone.`
      : `Delete "${c.name}"? This can't be undone.`;
    if (!window.confirm(warning)) return;
    try {
      await api.deleteCampaign(c.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1 className="page-title">Campaigns</h1>
      <p className="lede">Every batch of outreach, with what was sent and what came back.</p>

      {error && <div className="note bad">{error}</div>}

      {campaigns.length === 0 ? (
        <div className="panel empty">
          No campaigns yet. Go to <Link to="/leads" style={{ color: "var(--plum)" }}>Leads</Link>, select some
          businesses, and draft your first batch.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th><th>Status</th><th>Drafted</th><th>Approved</th>
                <th>Sent</th><th>Failed</th><th>Created by</th><th>Date</th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><span className={`pill ${c.status}`}>{c.status}</span></td>
                  <td className="mono">{c.total}</td>
                  <td className="mono">{c.approved}</td>
                  <td className="mono">{c.sent}</td>
                  <td className="mono">{c.failed || 0}</td>
                  <td>{c.created_by_name || "—"}</td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td><Link to={`/campaigns/${c.id}`} style={{ color: "var(--plum)" }}>Open</Link></td>
                  <td>
                    <button className="btn ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                            disabled={c.status === "sending"} onClick={() => deleteCampaign(c)}
                            title={c.status === "sending" ? "Wait for the send to finish first" : "Delete this campaign"}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
