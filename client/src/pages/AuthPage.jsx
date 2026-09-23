import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const email = form.email.trim();
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: form.password,
          // Picked up by the handle_new_user() trigger to create the profile.
          options: { data: { name: form.name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation is on for this project.
          setNotice(`Check ${email} for a confirmation link, then log in.`);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: form.password });
        if (error) throw error;
      }
      // The auth store picks up the new session and GuestOnly redirects.
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="brand">Watch Together</h1>
        <p className="muted">Movie night in the forest, from anywhere.</p>

        {isSignup && (
          <label>
            Name
            <input value={form.name} onChange={update('name')} maxLength={40} required autoComplete="nickname" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            minLength={isSignup ? 8 : undefined}
            required
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
          {isSignup && <span className="hint">At least 8 characters</span>}
        </label>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
        </button>
        <p className="muted small">
          {isSignup ? (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
