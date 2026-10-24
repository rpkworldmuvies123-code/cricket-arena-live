# Frontend

React + Vite mobile-first cricket site.

1. Copy `.env.example` to `.env` and configure the backend URL and Firebase web config.
2. In Firebase Console, enable Phone provider, configure authorized domains, and set up reCAPTCHA as required by Firebase Web Phone Auth.
3. Run `npm install`, `npm run dev`; production build: `npm run build`.
4. For Vercel choose `frontend` as Root Directory, build command `npm run build`, output folder `dist`.

Live scores and commentary display provider responses only. If API/Firebase/provider keys are absent, the interface tells you the integration is not configured instead of displaying fake live results.
