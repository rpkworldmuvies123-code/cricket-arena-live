import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, firebaseConfigured } from './firebase';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Bell, CalendarDays,
  ChevronRight, CircleHelp, Clock3, CreditCard, Home, LogIn, Menu, MessageCircle,
  RefreshCw, Search, ShieldCheck, Sparkles, Trophy, UserRound, Wallet, X
} from 'lucide-react';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));

export default function App() {
  const [view, setView] = useState('home');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [user, setUser] = useState(null);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [matches, setMatches] = useState([]);
  const [feedState, setFeedState] = useState('loading');
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const recaptchaRef = useRef(null);

  useEffect(() => {
    const token = window.localStorage.getItem('cricketArenaSession');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp || payload.exp * 1000 <= Date.now()) {
        window.localStorage.removeItem('cricketArenaSession');
        return;
      }
      setUser({
        id: payload.sub,
        phoneNumber: payload.phoneNumber,
        getIdToken: async () => window.localStorage.getItem('cricketArenaSession')
      });
    } catch {
      window.localStorage.removeItem('cricketArenaSession');
    }
  }, []);

  useEffect(() => {
    loadMatches();
    const timer = setInterval(loadMatches, 30000);
    return () => clearInterval(timer);
  }, []);

  async function loadMatches() {
    setFeedState('loading');
    try {
      const res = await fetch(API + '/cricket/live', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setMatches([]);
        setFeedState(res.status === 503 ? 'unconfigured' : 'error');
      } else {
        const d = json.data;
        const list = Array.isArray(d) ? d : (d?.data || d?.matches || d?.response || []);
        setMatches(Array.isArray(list) ? list : []);
        setFeedState('ready');
      }
    } catch {
      setMatches([]);
      setFeedState('offline');
    }
  }

  async function loadWallet(tokenOverride) {
    const token = tokenOverride || window.localStorage.getItem('cricketArenaSession') || (auth?.currentUser ? await auth.currentUser.getIdToken() : null);
    if (!token) return;
    try {
      const res = await fetch(API + '/wallet', { headers: { Authorization: 'Bearer ' + token } });
      const json = await res.json();
      if (res.ok) {
        setWallet(json);
        setTransactions(Array.isArray(json.transactions) ? json.transactions : []);
      } else {
        setWallet(null);
        setNotice(json.error || 'Wallet API is unavailable.');
      }
    } catch { setNotice('Could not connect to wallet service.'); }
  }

  async function sendOtp() {
    const mobile = phone.trim().replace(/^\\+91\\s*/, '').replace(/[\\s()-]/g, '');
    if (!/^[6-9]\\d{9}$/.test(mobile)) { setNotice('Enter a valid 10-digit Indian mobile number.'); return; }
    setLoginBusy(true); setNotice('');
    try {
      const res = await fetch(API + '/auth/otp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send OTP.');
      setConfirmation({ mobile });
      setNotice(data.message || 'OTP sent. Check your SMS.');
    } catch (e) { setNotice(e?.message || 'Could not send OTP. Check backend and Fast2SMS setup.'); }
    finally { setLoginBusy(false); }
  }

  async function verifyOtp() {
    const mobile = confirmation?.mobile;
    if (!mobile || !/^\\d{4,10}$/.test(otp.trim())) { setNotice('Enter the OTP received by SMS.'); return; }
    setLoginBusy(true);
    try {
      const res = await fetch(API + '/auth/otp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile, otp: otp.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.token || !data.user) throw new Error(data.error || 'OTP verification failed.');
      window.localStorage.setItem('cricketArenaSession', data.token);
      setUser({ phoneNumber: data.user.phoneNumber, id: data.user.id, getIdToken: async () => data.token });
      setProfile(data.user);
      setConfirmation(null);
      setOtp('');
      setView('profile');
      setNotice('Login successful.');
      await loadWallet(data.token);
    } catch (e) { setNotice(e?.message || 'OTP invalid, expired, or verification failed.'); }
    finally { setLoginBusy(false); }
  }

  async function requestWalletAction(path, label) {
    if (!user) { setView('login'); return; }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      setNotice(data.error || (res.ok ? label : label + ' could not be completed.'));
      if (res.ok) await loadWallet(token);
    } catch { setNotice('Could not reach wallet service.'); }
    finally { setBusy(false); }
  }

  function openMatch(match) { setSelectedMatch(match); setView('match'); }

  const nav = [
    { id: 'home', name: 'Home', icon: Home },
    { id: 'matches', name: 'Live Matches', icon: Activity },
    { id: 'fixtures', name: 'Fixtures', icon: CalendarDays },
    { id: 'wallet', name: 'My Wallet', icon: Wallet },
    { id: 'profile', name: 'My Profile', icon: UserRound }
  ];

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-btn mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu">{mobileMenu ? <X/> : <Menu/>}</button>
      <button className="brand" onClick={() => setView('home')} aria-label="Cricket Arena Live home">
        <span className="brand-mark"><Trophy size={21}/></span>
        <span className="brand-copy"><strong>CRICKET <em>ARENA</em></strong><small>LIVE. EVERY BALL.</small></span>
      </button>
      <div className="top-search"><Search size={17}/><input placeholder="Search teams, tournaments..." onKeyDown={e => e.key === 'Enter' && setView('matches')}/><kbd>⌘ K</kbd></div>
      <div className="top-actions">
        <span className="timezone"><span className="live-dot"/> LIVE CENTER</span>
        <button className="icon-btn notification" onClick={() => setNotice('You are all caught up.')} aria-label="Notifications"><Bell size={19}/></button>
        {user ? <button className="user-chip" onClick={() => setView('profile')}><span className="avatar">{(user.phoneNumber || 'U').slice(-1)}</span><span className="user-chip-label">My Account</span></button> : <button className="sign-in-btn" onClick={() => setView('login')}><LogIn size={16}/> Sign in</button>}
      </div>
    </header>

    <div className="page-grid">
      <aside className={'sidebar ' + (mobileMenu ? 'sidebar-open' : '')}>
        <div className="side-label">MAIN MENU</div>
        <nav>{nav.map(item => <button key={item.id} className={'nav-item ' + (view === item.id || (item.id === 'matches' && view === 'match') ? 'active' : '')} onClick={() => { setView(item.id); setMobileMenu(false); }}>
          <item.icon size={18}/><span>{item.name}</span>{item.id === 'matches' && feedState === 'ready' && matches.length > 0 && <span className="nav-count">{matches.length}</span>}
        </button>)}</nav>
        <div className="sidebar-divider"/>
        <div className="side-label">YOUR ARENA</div>
        <button className="nav-item" onClick={() => setView('matches')}><Trophy size={18}/><span>Tournaments</span></button>
        <button className="nav-item" onClick={() => setView('fixtures')}><Clock3 size={18}/><span>Upcoming games</span></button>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><CircleHelp size={18}/></span><strong>Need help?</strong><p>Find answers to common questions.</p><button onClick={() => setNotice('Support: configure a contact email in your deployment settings.')}>Visit help center <ChevronRight size={14}/></button></div>
          <div className="side-foot"><ShieldCheck size={15}/> Secure account access <span>•</span> v1.0</div>
        </div>
      </aside>

      <main className="main-content">
        <div className="breadcrumb"><span>ARENA</span><ChevronRight size={13}/><strong>{view === 'home' ? 'Overview' : view === 'match' ? 'Match Centre' : nav.find(n => n.id === view)?.name || 'Sign In'}</strong></div>
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
        {view === 'login' ? <LoginPanel phone={phone} setPhone={setPhone} otp={otp} setOtp={setOtp} confirmation={confirmation} sendOtp={sendOtp} verifyOtp={verifyOtp} busy={loginBusy} firebaseConfigured={firebaseConfigured} authUser={user} onSignOut={() => signOut(auth)} recaptchaRef={recaptchaRef}/> :
          view === 'profile' ? <ProfilePanel user={user} profile={profile} setView={setView} onSignOut={async()=>{if(auth) await signOut(auth);setView('home')}} notice={setNotice}/> :
          view === 'wallet' ? <WalletPanel user={user} wallet={wallet} transactions={transactions} busy={busy} onDeposit={()=>requestWalletAction('/wallet/deposit-intent','Deposit request')} onWithdraw={()=>requestWalletAction('/wallet/withdrawal-requests','Withdrawal request')} setView={setView} refresh={()=>loadWallet()}/> :
          view === 'match' ? <MatchPanel match={selectedMatch} back={()=>setView('matches')}/> :
          <Dashboard view={view} matches={matches} feedState={feedState} reload={loadMatches} openMatch={openMatch} setView={setView} user={user}/>}
        <footer className="footer"><span>© 2026 Cricket Arena Live</span><span>Scores and commentary by authorized data providers</span><button onClick={() => setNotice('Live score and commentary features require a configured data provider account.')}>Data & privacy</button></footer>
      </main>
    </div>
    <div id="recaptcha-container"></div>
    <div className="mobile-nav">{nav.slice(0,4).map(n=><button key={n.id} className={view===n.id?'selected':''} onClick={()=>setView(n.id)}><n.icon size={19}/><small>{n.name.replace('My ','')}</small></button>)}</div>
  </div>;
}

function Dashboard({ view, matches, feedState, reload, openMatch, setView, user }) {
  const home = view === 'home';
  const fixtures = view === 'fixtures';
  const shown = matches.filter(m => fixtures ? !/live|in.?progress/i.test(String(m.status || m.state || '')) : true);
  return <div className="dashboard">
    <section className="welcome-row">
      <div><div className="eyebrow"><Sparkles size={14}/> YOUR DAILY CRICKET FIX</div><h1>{home ? <>The game is <span>always on.</span></> : fixtures ? <>Upcoming <span>fixtures.</span></> : <>All the <span>action.</span></>}</h1><p>Every run, every wicket, every moment. Follow it all, live.</p></div>
      <div className="welcome-stat"><div className="stat-icon"><Activity size={19}/></div><div><small>LIVE UPDATES</small><strong>30 sec</strong><span>Auto refresh</span></div></div>
    </section>

    <section className="hero-banner">
      <div className="hero-bg-ball ball-one"></div><div className="hero-bg-ball ball-two"></div>
      <div className="hero-content"><div className="hero-pill"><span className="live-dot"/> THE GAME, IN REAL TIME</div><h2>Feel every<br/><em>moment.</em></h2><p>Live scores, match insights and ball-by-ball commentary — all in one arena.</p><button onClick={()=>setView('matches')}>Explore live matches <ChevronRight size={17}/></button></div>
      <div className="hero-art"><div className="orbit orbit-a"></div><div className="orbit orbit-b"></div><div className="hero-emblem"><Trophy size={73} strokeWidth={1.2}/><span>CA</span></div><div className="art-tag tag-top"><span className="live-dot"/> MATCH DAY</div><div className="art-tag tag-bottom"><Activity size={14}/> BALL BY BALL</div></div>
      <div className="hero-index">01 <span>/</span> 03</div>
    </section>

    <section className="section-head">
      <div><div className="section-kicker"><span className="section-dot"/> MATCH CENTRE</div><h2>{fixtures ? 'Coming up' : 'Live & recent matches'} <span className="muted-count">{matches.length ? String(matches.length).padStart(2,'0') : '—'}</span></h2></div>
      <button className="text-action" onClick={reload}><RefreshCw size={15}/> Refresh scores</button>
    </section>

    {feedState === 'loading' ? <div className="match-grid"><div className="skeleton-match"/><div className="skeleton-match"/><div className="skeleton-match"/></div> :
     feedState !== 'ready' ? <div className="provider-state"><div className="provider-state-icon"><Activity size={23}/></div><h3>{feedState === 'unconfigured' ? 'Connect your live score feed' : feedState === 'offline' ? 'Score service not reachable' : 'Live feed temporarily unavailable'}</h3><p>{feedState === 'unconfigured' ? 'Add an authorized cricket API base URL and key to the backend environment. Real scores and commentary will appear here once connected.' : 'We could not fetch match data from the configured service. Check your API setup and try refreshing.'}</p><button onClick={reload}><RefreshCw size={15}/> Try again</button></div> :
     shown.length ? <div className="match-grid">{shown.map((match,i)=><MatchCard key={match.id || match.matchId || i} match={match} onClick={()=>openMatch(match)}/>)}</div> :
     <div className="empty-state"><Trophy size={24}/><strong>No matches returned by the provider</strong><span>Check back closer to match time.</span></div>}

    <section className="bottom-panels">
      <div className="panel panel-spotlight"><div className="panel-title"><span className="panel-title-icon"><MessageCircle size={16}/></span><div><h3>Commentary corner</h3><p>Stay close to the action</p></div><span className="coming-tag">MATCH FEED</span></div><div className="commentary-empty"><div className="commentary-ball">•</div><div><strong>Every delivery has a story.</strong><p>Select a live match to view ball-by-ball commentary, over summaries and key moments when your provider supplies them.</p><button onClick={()=>setView('matches')}>Open match centre <ChevronRight size={14}/></button></div></div></div>
      <div className="panel panel-wallet"><div className="panel-title"><span className="panel-title-icon"><Wallet size={16}/></span><div><h3>Your wallet</h3><p>Account snapshot</p></div></div><div className="wallet-big"><span>AVAILABLE BALANCE</span><strong>{user ? '••••••' : 'Sign in to view'}</strong><small>{user ? 'Balance is loaded securely from your account' : 'Your account, your control.'}</small></div><button className="wallet-cta" onClick={()=>setView(user?'wallet':'login')}>{user?'Open wallet':'Sign in securely'} <ChevronRight size={16}/></button><p className="wallet-legal">Money movement is unavailable until payment services are configured.</p></div>
    </section>
  </div>;
}

function MatchCard({ match, onClick }) {
  const teams = Array.isArray(match.teams) ? match.teams : [];
  const teamA = match.teamA || match.team1 || teams[0] || {};
  const teamB = match.teamB || match.team2 || teams[1] || {};
  const scoreA = match.scoreA || match.score1 || match.scores?.[0] || {};
  const scoreB = match.scoreB || match.score2 || match.scores?.[1] || {};
  const nameA = typeof teamA === 'string' ? teamA : teamA.name || teamA.teamName || 'Team A';
  const nameB = typeof teamB === 'string' ? teamB : teamB.name || teamB.teamName || 'Team B';
  const sA = typeof scoreA === 'string' ? scoreA : [scoreA.runs ?? scoreA.score, scoreA.wickets != null ? '/' + scoreA.wickets : '', scoreA.overs ? '(' + scoreA.overs + ')' : ''].filter(Boolean).join('');
  const sB = typeof scoreB === 'string' ? scoreB : [scoreB.runs ?? scoreB.score, scoreB.wickets != null ? '/' + scoreB.wickets : '', scoreB.overs ? '(' + scoreB.overs + ')' : ''].filter(Boolean).join('');
  const status = match.status || match.state || match.matchStatus || 'Match status unavailable';
  const tournament = match.series || match.tournament || match.competition || match.matchType || 'CRICKET';
  const isLive = /live|in.?progress|innings/i.test(String(status));
  return <button className="match-card" onClick={onClick}>
    <div className="match-card-top"><span className="tournament-label">{String(tournament).toUpperCase()}</span><span className={isLive?'status-live':'status-upcoming'}>{isLive && <i/>}{String(status).slice(0,29)}</span></div>
    <div className="match-team-row"><span className="team-crest">{nameA.slice(0,3).toUpperCase()}</span><span className="team-name">{nameA}</span><strong className="team-score">{sA || '—'}</strong></div>
    <div className="match-team-row"><span className="team-crest crest-alt">{nameB.slice(0,3).toUpperCase()}</span><span className="team-name">{nameB}</span><strong className="team-score">{sB || '—'}</strong></div>
    <div className="match-card-bottom"><span><Clock3 size={13}/>{match.venue || match.date || match.startTime || 'Match centre'}</span><span className="match-open">Details <ChevronRight size={14}/></span></div>
  </button>;
}

function LoginPanel({ phone, setPhone, otp, setOtp, confirmation, sendOtp, verifyOtp, busy, firebaseConfigured, authUser, onSignOut }) {
  return <section className="account-page"><div className="account-intro"><div className="eyebrow"><ShieldCheck size={14}/> SECURE ACCESS</div><h1>Your arena.<br/><span>Your account.</span></h1><p>Sign in with your mobile number to access your profile and wallet.</p><div className="secure-line"><ShieldCheck size={17}/> Phone verification powered by Firebase Authentication</div></div><div className="form-card"><span className="form-symbol"><LogIn size={21}/></span><h2>{authUser?'You are signed in':'Welcome back'}</h2><p className="form-sub">{authUser?'Your account is ready.':'Enter your mobile number to receive a one-time code.'}</p>{authUser?<><div className="signed-phone">{authUser.phoneNumber}</div><button className="primary-wide" onClick={onSignOut}>Sign out</button></>:<>{!confirmation?<><label htmlFor="phone">Mobile number</label><div className="input-with-prefix"><span>☎</span><input id="phone" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={e=>setPhone(e.target.value)}/></div><button className="primary-wide" disabled={busy||!firebaseConfigured} onClick={sendOtp}>{busy?'Sending OTP…':'Send OTP'} <ChevronRight size={17}/></button></>:<><label htmlFor="otp">6-digit verification code</label><input id="otp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="• • • • • •" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}/><button className="primary-wide" disabled={busy} onClick={verifyOtp}>{busy?'Verifying…':'Verify & sign in'} <ChevronRight size={17}/></button><button className="back-link" onClick={()=>{setOtp('');}}>Change code</button></>}</>}<p className="consent-note">By continuing, you agree to the site's terms and privacy policy. SMS and reCAPTCHA setup must be enabled in Firebase.</p><div className="provider-note">{firebaseConfigured?'Firebase keys detected':'Firebase setup required'} <span className={firebaseConfigured?'green-dot':'amber-dot'}/></div></div></section>;
}

function ProfilePanel({ user, profile, setView, onSignOut, notice }) {
  return <section className="inner-page"><div className="page-heading"><div><div className="eyebrow">ACCOUNT</div><h1>My profile</h1><p>Manage your Cricket Arena account.</p></div></div>{user?<div className="profile-card"><div className="profile-avatar"><UserRound size={27}/></div><div className="profile-main"><h3>{profile?.displayName || 'Cricket Fan'}</h3><p>{user.phoneNumber || profile?.phoneNumber || 'Phone verified'}</p><span className="verified-badge"><ShieldCheck size={13}/> Verified account</span></div><button className="outline-btn" onClick={()=>setView('wallet')}>View wallet <ChevronRight size={15}/></button><div className="profile-divider"/><div className="profile-detail"><span>Account status</span><strong>{profile?.status || 'Active'}</strong></div><div className="profile-detail"><span>Sign-in method</span><strong>Mobile number + OTP</strong></div><div className="profile-detail"><span>Account created</span><strong>{profile?.createdAt?new Date(profile.createdAt).toLocaleDateString():'—'}</strong></div><button className="danger-link" onClick={onSignOut}>Sign out</button></div>:<div className="empty-state account-empty"><UserRound size={28}/><strong>Sign in to view your profile</strong><span>Your verified account details will appear here.</span><button onClick={()=>setView('login')}>Sign in with mobile number <ChevronRight size={15}/></button></div>}</section>;
}

function WalletPanel({ user, wallet, transactions, busy, onDeposit, onWithdraw, setView, refresh }) {
  return <section className="inner-page"><div className="page-heading"><div><div className="eyebrow">ACCOUNT & PAYMENTS</div><h1>My wallet</h1><p>Review your balance and account transaction history.</p></div><button className="outline-btn" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>{user?<><div className="wallet-summary-card"><div className="wallet-summary-top"><span><Wallet size={17}/> AVAILABLE BALANCE</span><span className="balance-lock"><ShieldCheck size={14}/> Secure</span></div><strong>{wallet?money(wallet.balance):'— — —'}</strong><p>{wallet?'Current posted wallet balance':'Wallet API/database must be connected to read your balance.'}</p><div className="wallet-action-row"><button onClick={onDeposit} disabled={busy}><ArrowDownToLine size={17}/> Add funds</button><button onClick={onWithdraw} disabled={busy}><ArrowUpFromLine size={17}/> Withdraw</button></div></div><div className="transactions-head"><div><h2>Recent transactions</h2><p>Most recent posted wallet entries</p></div><span>{transactions.length} records</span></div>{transactions.length?<div className="transaction-list">{transactions.map(tx=><div className="transaction-row" key={tx._id}><span className={'transaction-icon '+tx.type}>{tx.type==='credit'?<ArrowDownToLine size={17}/>:<ArrowUpFromLine size={17}/>}</span><div className="transaction-info"><strong>{tx.description || (tx.type==='credit'?'Wallet credit':'Wallet debit')}</strong><small>{tx.reference} · {new Date(tx.createdAt).toLocaleString()}</small></div><strong className={tx.type==='credit'?'amount-credit':'amount-debit'}>{tx.type==='credit'?'+':'−'}{money(tx.amountPaise/100)}</strong></div>)}</div>:<div className="empty-state"><CreditCard size={23}/><strong>No posted transactions</strong><span>Your transaction history will appear here when the wallet service is enabled.</span></div>}<div className="wallet-warning"><ShieldCheck size={17}/><span>Deposits and withdrawals stay disabled until an approved payment provider, server-side settlement verification, and compliance review are configured.</span></div></>:<div className="empty-state account-empty"><Wallet size={28}/><strong>Sign in to view your wallet</strong><span>Your balance and transaction history are private.</span><button onClick={()=>setView('login')}>Sign in securely <ChevronRight size={15}/></button></div>}</section>;
}

function MatchPanel({ match, back }) {
  if(!match) return <section className="inner-page"><button className="back-link" onClick={back}><ArrowLeft size={15}/> Back to matches</button><div className="empty-state"><Activity size={24}/><strong>Select a match to view details</strong></div></section>;
  const nameA = match.teamA?.name || match.teamA || match.team1?.name || match.team1 || match.teams?.[0]?.name || 'Team A';
  const nameB = match.teamB?.name || match.teamB || match.team2?.name || match.team2 || match.teams?.[1]?.name || 'Team B';
  const scoreA = match.scoreA?.score || match.score1?.score || match.scoreA || match.score1 || '—';
  const scoreB = match.scoreB?.score || match.score2?.score || match.scoreB || match.score2 || '—';
  const status = match.status || match.state || 'Status unavailable';
  return <section className="inner-page"><button className="back-link" onClick={back}><ArrowLeft size={15}/> Back to matches</button><div className="match-detail-hero"><div className="match-detail-label"><span className="live-dot"/>{String(status).toUpperCase()}</div><p>{match.series || match.tournament || match.competition || 'CRICKET MATCH'}</p><div className="detail-scoreboard"><div><span className="detail-crest">{String(nameA).slice(0,3).toUpperCase()}</span><strong>{nameA}</strong><b>{scoreA}</b></div><span className="vs-mark">VS</span><div><span className="detail-crest">{String(nameB).slice(0,3).toUpperCase()}</span><strong>{nameB}</strong><b>{scoreB}</b></div></div><div className="detail-location">{match.venue || match.date || match.startTime || 'Match information provided by data feed'}</div></div><div className="section-head commentary-heading"><div><div className="section-kicker"><span className="section-dot"/> MATCH COVERAGE</div><h2>Ball-by-ball commentary</h2></div></div><div className="empty-state commentary-full"><MessageCircle size={24}/><strong>Commentary will appear here</strong><span>Your cricket data provider must include innings, overs and ball-by-ball commentary in its API response. The current configured adapter returns provider match data as-is.</span></div></section>;
}
