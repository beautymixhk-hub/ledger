import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, getToken, setToken } from "./api.js";

import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Leads from "./pages/Leads.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";
import Competitors from "./pages/Competitors.jsx";
import Replies from "./pages/Replies.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setSession)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="auth-wrap">
        <div style={{ color: "var(--ink-soft)" }}>
          <span className="spinner" /> Loading…
        </div>
      </div>
    );
  }

  if (!session) return <Login onAuth={setSession} />;

  return <Shell session={session} onSessionChange={setSession} />;
}

function Shell({ session, onSessionChange }) {
  const navigate = useNavigate();

  function signOut() {
    setToken(null);
    onSessionChange(null);
    navigate("/login");
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          Ledger<span>.</span>
        </div>
        <NavLink to="/" end className="navlink">Dashboard</NavLink>
        <NavLink to="/leads" className="navlink">Leads</NavLink>
        <NavLink to="/campaigns" className="navlink">Campaigns</NavLink>
        <NavLink to="/replies" className="navlink">Replies</NavLink>
        <NavLink to="/competitors" className="navlink">Competitors</NavLink>
        <NavLink to="/settings" className="navlink">Settings</NavLink>

        <div className="sidebar-foot">
          <div style={{ fontWeight: 500, color: "var(--ink)" }}>{session.user.name}</div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>{session.org.name}</div>
          <button className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/replies" element={<Replies />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/settings" element={<Settings session={session} onUpdate={onSessionChange} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
