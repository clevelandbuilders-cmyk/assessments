const Auth = (() => {

  /* ═══════════════════════════════════════════════════════════════════════
     LOCAL AUTH  (Demo Mode — localStorage only)
  ═══════════════════════════════════════════════════════════════════════ */
  if (window.DEMO_MODE) {
    let _user = null;
    let _callbacks = {};

    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

    function init(onSignedIn, onSignedOut) {
      _callbacks = { onSignedIn, onSignedOut };
      const saved = localStorage.getItem('demo_auth_user');
      if (saved) {
        _user = JSON.parse(saved);
        setTimeout(() => onSignedIn(_user), 0);
      } else {
        setTimeout(() => onSignedOut(), 0);
      }
    }

    function demoSignIn(name) {
      const existing = JSON.parse(localStorage.getItem('demo_auth_user') || 'null');
      _user = existing
        ? { ...existing, displayName: name }
        : { uid: uid(), displayName: name, email: name.toLowerCase().replace(/\s+/g, '.') + '@demo.local' };
      localStorage.setItem('demo_auth_user', JSON.stringify(_user));
      // Register this user in the demo user list so they appear in Tag modal
      const users = JSON.parse(localStorage.getItem('demo_users') || '{}');
      users[_user.uid] = { uid: _user.uid, name: _user.displayName, email: _user.email };
      localStorage.setItem('demo_users', JSON.stringify(users));
      _callbacks.onSignedIn?.(_user);
    }

    function signOut() {
      localStorage.removeItem('demo_auth_user');
      _user = null;
      _callbacks.onSignedOut?.();
    }

    return {
      init,
      signOut,
      _demoSignIn: demoSignIn,
      signIn: async () => {},
      signUp: async () => {},
      get currentUser() { return _user; },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FIREBASE AUTH  (Production)
  ═══════════════════════════════════════════════════════════════════════ */
  let _user = null;

  function init(onSignedIn, onSignedOut) {
    firebase.auth().onAuthStateChanged(async user => {
      _user = user;
      if (user) { await onSignedIn(user); _initFCM(user); }
      else onSignedOut();
    });
  }

  async function signIn(email, password) {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  }

  async function signUp(email, password, name) {
    const { user } = await firebase.auth().createUserWithEmailAndPassword(email, password);
    await user.updateProfile({ displayName: name });
    await DB.saveUserProfile(user.uid, { name, email });
    return user;
  }

  async function signOut() { await firebase.auth().signOut(); }

  async function _initFCM(user) {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    try {
      await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      if (await Notification.requestPermission() !== 'granted') return;
      const token = await firebase.messaging().getToken({ vapidKey: firebaseConfig.vapidKey });
      if (token) await DB.saveFCMToken(user.uid, token);
    } catch { /* FCM unavailable — in-app notifications still work */ }
  }

  return {
    init, signIn, signUp, signOut,
    get currentUser() { return _user; },
  };

})();

/* ── Login form wiring (works for both modes) ────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const show = id => { document.getElementById(id).hidden = false; };
  const hide = id => { document.getElementById(id).hidden = true;  };
  const setErr = msg => { document.getElementById('authError').textContent = msg || ''; };

  if (window.DEMO_MODE) {
    /* ── Demo login: just ask for a name ──────────────────────────────── */
    // Rewrite the login card for demo mode
    const card = document.querySelector('.login-card');
    card.innerHTML = `
      <div class="demo-badge">Demo Mode</div>
      <h1 class="login-logo">JobCam</h1>
      <p class="login-sub">Enter your name to start testing — no account needed.<br>All data stays on this device.</p>
      <div class="form-group">
        <label>Your Name</label>
        <input type="text" id="demoName" class="form-input" placeholder="e.g. Jane Smith" autocomplete="name">
      </div>
      <button class="btn btn-primary btn-full" id="demoStartBtn">Start Testing</button>
      <p id="authError" class="auth-error"></p>`;

    document.getElementById('demoStartBtn').addEventListener('click', () => {
      const name = document.getElementById('demoName').value.trim();
      if (!name) { document.getElementById('authError').textContent = 'Please enter your name.'; return; }
      Auth._demoSignIn(name);
    });
    document.getElementById('demoName').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('demoStartBtn').click();
    });
    return;
  }

  /* ── Firebase login ──────────────────────────────────────────────────── */
  document.getElementById('showRegisterBtn').addEventListener('click', () => {
    hide('loginForm'); show('registerForm'); setErr();
  });
  document.getElementById('showLoginBtn').addEventListener('click', () => {
    hide('registerForm'); show('loginForm'); setErr();
  });

  document.getElementById('signInBtn').addEventListener('click', async () => {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { setErr('Email and password are required.'); return; }
    const btn = document.getElementById('signInBtn');
    btn.disabled = true;
    try { await Auth.signIn(email, password); }
    catch (e) { setErr(friendlyError(e.code)); }
    finally { btn.disabled = false; }
  });

  document.getElementById('signUpBtn').addEventListener('click', async () => {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    if (!name)           { setErr('Please enter your name.'); return; }
    if (!email)          { setErr('Please enter your email.'); return; }
    if (password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    const btn = document.getElementById('signUpBtn');
    btn.disabled = true;
    try { await Auth.signUp(email, password, name); }
    catch (e) { setErr(friendlyError(e.code)); }
    finally { btn.disabled = false; }
  });

  ['loginEmail', 'loginPassword'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('signInBtn').click();
    });
  });

  document.getElementById('userBtn').addEventListener('click', e => {
    e.stopPropagation();
    const d = document.getElementById('userDropdown');
    d.hidden = !d.hidden;
  });
  document.addEventListener('click', () => {
    document.getElementById('userDropdown').hidden = true;
  });
  document.getElementById('signOutBtn').addEventListener('click', () => Auth.signOut());
});

function friendlyError(code) {
  const map = {
    'auth/user-not-found':      'No account found with that email.',
    'auth/wrong-password':      'Incorrect password.',
    'auth/invalid-credential':  'Incorrect email or password.',
    'auth/email-already-in-use':'An account already exists with that email.',
    'auth/invalid-email':       'Please enter a valid email address.',
    'auth/weak-password':       'Password must be at least 6 characters.',
    'auth/too-many-requests':   'Too many attempts. Please try again later.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}
