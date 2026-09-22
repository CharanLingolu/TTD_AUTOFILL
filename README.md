# TTD Autofill Coupon Backend

Coupon-only license backend for TTD Autofill Pro. Razorpay/payment processing is not used.

## Environment variables

```env
MONGODB_URI=your_mongodb_connection_string
PORT=8787
ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID
ADMIN_TOKEN=use-a-long-random-private-admin-token
```

Never commit `.env` or share `ADMIN_TOKEN`.

## Run

```bash
npm install
npm start
```

## Admin coupon generator

Open:

```text
http://localhost:8787/admin/
```

Enter the value of `ADMIN_TOKEN` from your private backend environment. Generate up to 100 coupons at once, choose uses per coupon and optionally set an expiry.

The admin API is protected by `X-Admin-Token` and the token is never stored in the extension.

## Customer activation

The extension calls:

```text
POST /api/coupon/redeem
GET  /api/license/check
```

The backend atomically increments coupon usage and creates an active license for the extension installation ID.
