# SiteCheck — Storage Facility Maintenance App

A self-contained web app for storage-facility maintenance check-ins, with a manager
console and a field portal for technicians. Includes a real backend: token-based
logins, hashed PINs, server-enforced facility access, and saved reports.

## What's inside
- **server.js** — Node/Express backend + a simple JSON-file database (`data.json`, created on first run).
- **public/** — the web app the server serves (plain HTML/JS, no build step).
- **package.json** — dependencies and the start script.

## Run it on your computer
1. Install **Node.js** (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

### Demo logins (created automatically on first run)
| Role        | Username  | Password     |
|-------------|-----------|--------------|
| Super admin | `owner`   | owner123     |
| Admin       | `manager` | manager123   |
| Technician  | `marcus`  | marcus123    |
| Technician  | `dana`    | dana123      |

Super admins have full access including the Insurance / Property-Taxes / Utilities
section; admins see everything except that section (enforced on the server, not just
hidden in the UI). Change these immediately: sign in as the owner → **Admins** /
**Staff logins** to edit names, usernames, passwords, and roles, or add/remove accounts.

## How it works
- **Managers** set up facilities and their weekly lists, assign each technician to
  specific facilities with a weekly check-in day, manage admin accounts, and read
  submitted reports.
- **Technicians** sign in and see **only** the facilities assigned to them. Each shows
  their check-in day and the date the form was last updated. They walk the check-in
  (tasks, lockout list, maintenance, vacated, vacant, auction, grounds) and submit.
- Data is stored server-side in `data.json`, so it's shared across devices that reach
  the server, and it persists across restarts. Photos are stored inside submissions.

## Going live (sharing it beyond your computer)
To let your crew use it over the internet, deploy to a host like Render, Railway,
Fly.io, or a small VPS. Two things to set in production:
- **`JWT_SECRET`** — set this environment variable to a long random string. It signs
  login tokens; the default placeholder is for local use only.
- **`PORT`** — most hosts set this automatically; the server reads `process.env.PORT`.

### Notes for scaling up
- The JSON-file database is great for one facility company with modest traffic. If you
  grow, swap `data.json` for a real database (PostgreSQL/SQLite); the API routes in
  `server.js` are the only thing that changes — the frontend stays the same.
- Photos are stored as data inside submissions. At higher volume, move them to object
  storage (e.g. S3) and store URLs instead.
- PINs are hashed with bcrypt. For stronger auth you can later add longer passwords,
  email-based reset, or 2FA.
