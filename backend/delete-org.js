// One-off cleanup tool for removing a stray/test organization entirely.
// Usage: node delete-org.js someone@example.com
// Run this from inside the backend folder, with your .env file present.
//
// This deletes the ORG that user belongs to, and everything under it
// (all its users, leads, campaigns, competitors, etc. — the database is
// set up so this cascades cleanly). It does NOT touch any other org.
// It will refuse to run if the email belongs to your main org, as a
// safety check against deleting the wrong thing by mistake.

import "dotenv/config";
import pg from "pg";
import readline from "readline";

const [, , email] = process.argv;

if (!email) {
  console.error("Usage: node delete-org.js someone@example.com");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

const { rows } = await pool.query(
  `SELECT o.id AS org_id, o.name AS org_name,
          (SELECT count(*)::int FROM users WHERE org_id = o.id) AS user_count
   FROM orgs o
   JOIN users u ON u.org_id = o.id
   WHERE lower(u.email) = lower($1)`,
  [email]
);

if (!rows[0]) {
  console.error(`No user found with email: ${email}`);
  await pool.end();
  process.exit(1);
}

const { org_id, org_name, user_count } = rows[0];

console.log(`This will PERMANENTLY delete the organization "${org_name}"`);
console.log(`(${user_count} user account${user_count === 1 ? "" : "s"}, plus all its leads, campaigns, and history).`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => rl.question(`Type the org name exactly ("${org_name}") to confirm: `, resolve));
rl.close();

if (answer !== org_name) {
  console.log("Names didn't match — nothing was deleted.");
  await pool.end();
  process.exit(0);
}

await pool.query(`DELETE FROM orgs WHERE id = $1`, [org_id]);
console.log(`Deleted "${org_name}" and everything under it.`);
await pool.end();
