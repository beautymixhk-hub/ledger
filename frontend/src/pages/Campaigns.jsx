import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.campaigns().then(setCampaigns).catch((e) => setError(e.message));
  }, []);

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
                <th>Sent</th><th>Failed</th><th>Created by</th><th>Date</th><th></th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
