TTD Autofill - Fixed Backend
============================

This package includes the fixed backend and admin dashboard.

IMPORTANT:
1. Keep your existing .env file in the backend folder. Do NOT replace it with .env.example.
2. The backend expects MONGODB_URI in .env.
3. Admin token is controlled by your existing environment configuration.

Folder structure:
backend/
  admin/
    index.html
    admin.css
    admin.js
  scripts/
    seed-coupon.js
  src/
    db.js
    server.js
  .env.example
  package.json
  package-lock.json

Run:
  npm install
  npm run dev

Backend:
  http://localhost:8787

Admin dashboard:
  http://localhost:8787/admin/

Health check:
  http://localhost:8787/health

The fixed backend includes:
- Admin dashboard served from /admin/
- Coupon expiry returned with license data
- Disabled/deleted/expired coupons revoke issued licenses
- License checks synchronize against the current coupon state
- Delete coupon API
- Enable/disable coupon API
- Modern responsive admin UI with search/filter/live remaining-time UI
- No-cache license responses for immediate state visibility
- Server-authoritative expiry and remaining-time metadata
