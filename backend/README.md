# Backend setup

Requirements: Node.js 20+, MongoDB Atlas, Firebase project (Phone Authentication enabled), and a cricket score/commentary provider account.

1. Copy `.env.example` to `.env` and set secret values.
2. Run `npm install` then `npm run dev`.
3. Health check: `GET /api/health`.

The API verifies Firebase ID tokens server-side when `FIREBASE_SERVICE_ACCOUNT_JSON` is configured. Live match endpoint returns an explicit configuration error until a supported provider is set up. Deposits and withdrawals are disabled by default; do not enable money movement without a payment integration, webhook verification, reconciliation, anti-fraud controls, and required legal review.

Render: root directory `backend`, build `npm install`, start `npm start`. Set env vars in Render dashboard; never commit `.env`.
