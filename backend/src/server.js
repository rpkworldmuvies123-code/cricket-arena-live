import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
const origins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.error('Firebase service account JSON invalid:', e.message);
  }
}

const sessionSecret = process.env.JWT_SECRET || '';
const authMode = () => process.env.AUTH_MODE === 'fast2sms' && otpConfigured() && sessionSecret.length >= 32 ? 'fast2sms' : admin.apps.length ? 'firebase' : 'not-configured';

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, default: undefined, sparse: true, index: true },
  phoneNumber: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, default: 'Cricket Fan', maxlength: 60 },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

const ledgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['pending', 'posted', 'rejected'], required: true },
  reference: { type: String, required: true, unique: true },
  description: { type: String, maxlength: 160 },
  createdAt: { type: Date, default: Date.now }
});
const Ledger = mongoose.models.Ledger || mongoose.model('Ledger', ledgerSchema);

// Fast2SMS hosted OTP flow; API key stays on the server.
const otpSendLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many OTP requests. Wait 10 minutes and try again.' } });
const otpVerifyLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many verification attempts. Wait 10 minutes and try again.' } });
const otpConfigured = () => Boolean(process.env.FAST2SMS_API_KEY && process.env.FAST2SMS_OTP_ID);

async function fast2sms(path, payload) {
  const response = await fetch('https://www.fast2sms.com/dev/otp/' + path, {
    method: 'POST',
    headers: { Authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.return === false) {
    const error = new Error(data.message || data.error || 'Fast2SMS request failed');
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return data;
}

function makeSession(user) {
  if (sessionSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  return jwt.sign(
    { sub: String(user._id), phoneNumber: user.phoneNumber, role: 'user' },
    sessionSecret,
    { expiresIn: '2h', issuer: 'cricket-arena-live', audience: 'cricket-arena-live-web', jwtid: randomBytes(16).toString('hex') }
  );
}

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'cricket-arena-live-api',
  database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  auth: authMode(),
  otp: otpConfigured() ? 'fast2sms-configured' : 'not-configured',
  cricketFeed: process.env.CRICKET_API_BASE_URL && process.env.CRICKET_API_KEY ? 'configured' : 'not-configured'
}));

app.post('/api/auth/otp/send', otpSendLimiter, async (req, res) => {
  if (!otpConfigured()) return res.status(503).json({ error: 'Fast2SMS not configured. Set FAST2SMS_API_KEY and FAST2SMS_OTP_ID in backend environment.' });
  const mobile = String(req.body.mobile || '').replace(/^\+91/, '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
  try {
    const result = await fast2sms('send', { otp_id: process.env.FAST2SMS_OTP_ID, mobile, otp_expiry: 5, otp_length: 6 });
    res.json({ ok: true, message: 'OTP request sent. Check your SMS.', requestId: result.request_id || null });
  } catch (e) {
    console.error('Fast2SMS send failed:', e.message);
    res.status(e.status || 502).json({ error: e.status === 400 ? e.message : 'Could not send OTP. Check Fast2SMS account and template configuration.' });
  }
});

app.post('/api/auth/otp/verify', otpVerifyLimiter, async (req, res) => {
  if (!otpConfigured()) return res.status(503).json({ error: 'Fast2SMS not configured. Set FAST2SMS_API_KEY and FAST2SMS_OTP_ID in backend environment.' });
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable.' });
  const mobile = String(req.body.mobile || '').replace(/^\+91/, '').replace(/\D/g, '');
  const otp = String(req.body.otp || '').trim();
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
  if (!/^\d{4,10}$/.test(otp)) return res.status(400).json({ error: 'Enter the OTP received by SMS.' });
  if (authMode() !== 'fast2sms') return res.status(503).json({ error: 'Set AUTH_MODE=fast2sms and JWT_SECRET (at least 32 characters) to enable Fast2SMS session login.' });
  try {
    await fast2sms('verify', { mobile, otp });
    const phoneNumber = '+91' + mobile;
    let user = await User.findOne({ phoneNumber });
    if (!user) user = await User.create({ phoneNumber });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended.' });
    const token = makeSession(user);
    res.json({
      ok: true, verified: true, token, tokenType: 'Bearer', expiresIn: 7200,
      user: { id: String(user._id), phoneNumber: user.phoneNumber, displayName: user.displayName, status: user.status }
    });
  } catch (e) {
    console.error('Fast2SMS verify/login failed:', e.message);
    if (e.code === 11000) return res.status(409).json({ error: 'Account creation conflict. Please retry login.' });
    res.status(e.status || 500).json({ error: e.status === 400 ? 'OTP invalid, expired, or already used.' : 'Could not complete login. Check server configuration and try again.' });
  }
});

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication token is missing.' });
  const token = header.slice(7);
  try {
    if (admin.apps.length && authMode() === 'firebase') {
      req.auth = await admin.auth().verifyIdToken(token);
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable.' });
      let user = await User.findOne({ phoneNumber: req.auth.phone_number || '' });
      if (!user && req.auth.phone_number) user = await User.create({ phoneNumber: req.auth.phone_number, firebaseUid: req.auth.uid });
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      req.user = user;
    } else {
      if (sessionSecret.length < 32) return res.status(503).json({ error: 'Server authentication is not configured.' });
      const claims = jwt.verify(token, sessionSecret, { issuer: 'cricket-arena-live', audience: 'cricket-arena-live-web' });
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable.' });
      req.user = await User.findById(claims.sub);
      if (!req.user) return res.status(401).json({ error: 'Account not found.' });
      req.auth = claims;
    }
    if (req.user.status !== 'active') return res.status(403).json({ error: 'Account suspended.' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

function requireAdmin(req, res, next) {
  const allow = (process.env.ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const principal = req.auth?.uid || req.auth?.sub;
  const phone = req.user?.phoneNumber;
  if (!principal || !(allow.includes(principal) || (phone && allow.includes(phone)))) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

app.get('/api/cricket/live', async (_req, res) => {
  const base = process.env.CRICKET_API_BASE_URL;
  const key = process.env.CRICKET_API_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Live score provider is not configured. Add a licensed provider endpoint and API key in server environment.' });
  try {
    const response = await fetch(new URL('/v1/live', base), { headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Cricket provider request failed', providerStatus: response.status });
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ source: 'configured-provider', fetchedAt: new Date().toISOString(), data: await response.json() });
  } catch { res.status(502).json({ error: 'Unable to fetch live cricket scores right now.' }); }
});

app.get('/api/cricket/matches/:id', async (req, res) => {
  const base = process.env.CRICKET_API_BASE_URL;
  const key = process.env.CRICKET_API_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Live score provider is not configured.' });
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid match id.' });
  try {
    const response = await fetch(new URL(`/v1/matches/${encodeURIComponent(req.params.id)}`, base), { headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Cricket provider request failed', providerStatus: response.status });
    res.set('Cache-Control', 'public, max-age=10');
    res.json({ source: 'configured-provider', fetchedAt: new Date().toISOString(), data: await response.json() });
  } catch { res.status(502).json({ error: 'Unable to fetch match details right now.' }); }
});

app.get('/api/profile', requireAuth, async (req, res) => {
  res.json({ id: req.user.id, phoneNumber: req.user.phoneNumber, displayName: req.user.displayName, status: req.user.status, createdAt: req.user.createdAt });
});
app.patch('/api/profile', requireAuth, async (req, res) => {
  const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  if (displayName.length < 2 || displayName.length > 60) return res.status(400).json({ error: 'Display name must be 2–60 characters.' });
  req.user.displayName = displayName;
  await req.user.save();
  res.json({ displayName: req.user.displayName });
});

app.get('/api/wallet', requireAuth, async (req, res) => {
  const rows = await Ledger.find({ userId: req.user._id, status: 'posted' }).sort({ createdAt: -1 }).limit(50).lean();
  const balancePaise = rows.reduce((sum, row) => sum + (row.type === 'credit' ? row.amountPaise : -row.amountPaise), 0);
  res.json({ currency: 'INR', balancePaise, balance: (balancePaise / 100).toFixed(2), transactions: rows });
});
app.post('/api/wallet/deposit-intent', requireAuth, (_req, res) => res.status(501).json({
  error: 'Deposits are disabled until an approved payment provider and verified server-side settlement webhooks are configured.'
}));
app.post('/api/wallet/withdrawal-requests', requireAuth, (_req, res) => res.status(501).json({
  error: 'Withdrawals are disabled until payout provider integration, identity checks, fraud controls, and compliance review are complete.'
}));

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  const [users, pendingLedger] = await Promise.all([User.countDocuments(), Ledger.countDocuments({ status: 'pending' })]);
  res.json({ users, pendingWalletEntries: pendingLedger, cricketFeedConfigured: Boolean(process.env.CRICKET_API_BASE_URL && process.env.CRICKET_API_KEY) });
});
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || '1', 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '25', 10) || 25));
  const users = await User.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-__v').lean();
  res.json({ page, limit, users });
});
app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !['active', 'suspended'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid request.' });
  const user = await User.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).select('phoneNumber displayName status');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Internal server error.' }); });

const port = Number(process.env.PORT || 5000);
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI).then(() => app.listen(port, () => console.log(`Cricket Arena API listening on ${port}`))).catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
} else app.listen(port, () => console.log(`API listening on ${port}; configure MONGODB_URI for persistent data`));
