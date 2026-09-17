import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!stats) return <div className="empty"><span className="spinner" /> Loading…</div>;

  const leadTotal = stats.leads.reduce((a, r) => a + r.n, 0);
  const byStatus = Object.fromEntries(stats.leads.map((r) => [r.status, r.n]));
  const e = stats.engagement;

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="lede">Where your pipeline stands right now.</p>

      <div className="stat-grid">
        <Stat n={leadTotal} k="Total leads" sub={`${byStatus.new || 0} not yet contacted`} />
        <Stat n={e.sent} k="Emails sent" sub={`${stats.emails?.failed || 0} failed`} />
        <Stat n={`${e.openRate}%`} k="Open rate" sub={`${e.opened} unique opens`} />
        <Stat n={`${e.replyRate}%`} k="Reply rate" sub={`${e.replies} replies logged`} />
        <Stat n={byStatus.interested || 0} k="Interested" sub="Flagged by AI from replies" />
        <Stat n={byStatus.unsubscribed || 0} k="Unsubscribed" sub="Permanently suppressed" />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Pipeline</h3>
          {stats.leads.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No leads yet.</div>}
          {stats.leads
            .sort((a, b) => b.n - a.n)
            .map((r) => (
              <div key={r.status} className="spread" style={{ padding: "6px 0", fontSize: 13 }}>
                <span className={`pill ${r.status}`}>{r.status.replace("_", " ")}</span>
                <b>{r.n}</b>
              </div>
            ))}
          <Link to="/leads" className="btn ghost sm" style={{ marginTop: 12, display: "inline-block", textDecoration: "none" }}>
            Go to leads
          </Link>
        </div>

        <div>
          <div className="panel">
            <h3>Reply breakdown</h3>
            {stats.replies.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                No replies logged yet. When a prospect writes back, paste their message into the Replies tab and
                Claude will classify it.
              </div>
            ) : (
              stats.replies.map((r) => (
                <div key={r.sentiment} className="spread" style={{ padding: "6px 0", fontSize: 13 }}>
                  <span className={`pill ${r.sentiment}`}>{r.sentiment.replace("_", " ")}</span>
                  <b>{r.n}</b>
                </div>
              ))
            )}
          </div>

          <div className="panel">
            <h3>AI usage — last 30 days</h3>
            <div className="row" style={{ gap: 26 }}>
              <div>
                <div className="mono" style={{ fontSize: 19 }}>{(stats.aiUsage30d?.input_tokens || 0).toLocaleString()}</div>
                <div className="label">Input tokens</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 19 }}>{(stats.aiUsage30d?.output_tokens || 0).toLocaleString()}</div>
                <div className="label">Output tokens</div>
              </div>
            </div>
            <div className="hint">
              Billed by Anthropic at their published per-token rates. Web search calls during lead and competitor
              research are the biggest driver.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ n, k, sub }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="k">{k}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
