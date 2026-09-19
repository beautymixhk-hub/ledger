// One-off password reset tool.
// Usage: node reset-password.js you@example.com "YourNewPassword123"
// Run this from inside the backend folder, with your .env file present
// (it needs DATABASE_URL from there to connect to your real database).

import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error('Usage: node reset-password.js you@example.com "YourNewPassword123"');
  process.exit(1);
}
if (newPassword.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

const hash = await bcrypt.hash(newPassword, 10);
const result = await pool.query(
  `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email`,
  [hash, email]
);

if (result.rowCount === 0) {
  console.error(`No user found with email: ${email}`);
} else {
  console.log(`Password updated for ${result.rows[0].email}. You can log in with the new password now.`);
}

await pool.end();
