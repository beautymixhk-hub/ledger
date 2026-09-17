import jwt from "jsonwebtoken";
import { query } from "../db.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

/** Attaches req.user = {id, org_id, role, name, email}. 401s if the token is bad. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, org_id, email, name, role FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "Account no longer exists" });
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please sign in again" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
