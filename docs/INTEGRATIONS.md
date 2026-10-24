# Production integration checklist

## 1. Phone authentication
- Fast2SMS SMS OTP flow is wired to backend `POST /api/auth/otp/send` and `POST /api/auth/otp/verify`.
- Set backend `FAST2SMS_API_KEY`, `FAST2SMS_OTP_ID`, `AUTH_MODE=fast2sms`, and `JWT_SECRET` (random, at least 32 characters). Never place the API key in frontend variables or GitHub.
- The login form calls the backend and stores the short-lived issued bearer token in browser local storage. For higher-risk production accounts, prefer secure HttpOnly cookies and add session revocation/rotation.
- Confirm the Fast2SMS OTP template ID is active and your account is authorized to send OTPs. Test India (+91) delivery, quotas, abuse protection, and account deletion.
- Configure MongoDB Atlas and the exact frontend origin in `FRONTEND_URL`; profile/wallet routes require database access.

## 2. Cricket live scores and commentary
- Select a cricket data vendor that expressly permits live score and commentary display on your website.
- Map that vendor's actual endpoint/response to the frontend's `teamA`, `teamB`, `scoreA`, `scoreB`, `status`, `series`, `venue`, and match id fields, or adapt `frontend/src/App.jsx` for its documented schema.
- Set `CRICKET_API_BASE_URL` and `CRICKET_API_KEY` in the backend runtime environment. Current backend adapter requests `/v1/live` and `/v1/matches/:id`; change these paths to match the provider documentation.
- Do not scrape a website or redistribute licensed commentary without permission.

## 3. Wallet
- Wallet reads come from the authenticated API and server-side ledger, not browser state.
- Deposits/withdrawals return disabled status by design until payment services are implemented.
- Before enabling: integrate approved provider; create server-side payment orders; validate signed webhooks and idempotency; reconcile provider settlements; implement ledger transactions and atomic balance checks; add payout verification, audit logs, refund handling and alerts; obtain qualified review for relevant laws, tax, KYC/AML, and gaming rules.
- Never add an endpoint that trusts a `balance` value from the client. Do not enable betting or wagering based on this starter alone.

## 4. Deployment
- Backend on Render: root `backend`, build `npm install`, start `npm start`. Add `MONGODB_URI`, `FRONTEND_URL`, Firebase service account JSON, and cricket API credentials as environment secrets.
- Frontend on Vercel: root `frontend`, build `npm run build`, output `dist`. Add Firebase web config and `VITE_API_BASE_URL`.
- Configure CORS with the precise deployed website origin. Use separate development and production Firebase/MongoDB projects.
- Add monitoring, backups, uptime checks, rate limiting and an incident-response plan before public production use.
