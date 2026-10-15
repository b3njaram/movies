import React, { useState } from 'react';
import { api } from './api';
import Logo from './Logo';

function Field({ id, label, type = 'text', value, onChange, autoFocus, autoComplete }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder=" "
        className="peer h-[50px] w-full rounded bg-[#333] px-4 pb-1 pt-5 text-base text-white outline-none transition-colors focus:bg-[#454545]"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-[15px] text-base text-[#8c8c8c] transition-all duration-150 peer-focus:top-[7px] peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-[7px] peer-[:not(:placeholder-shown)]:text-xs"
      >
        {label}
      </label>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { username, password, remember } });
      onLogin(data.username);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      {/* backdrop: layered glows + vignette, like the sign-in hero */}
      <div
        className="absolute inset-0 hidden sm:block"
        style={{
          background:
            'radial-gradient(900px 500px at 15% 10%, rgba(229,9,20,.28), transparent 60%),' +
            'radial-gradient(800px 600px at 90% 85%, rgba(90,40,160,.30), transparent 60%),' +
            'linear-gradient(180deg, #1b1b1b 0%, #0d0d0d 100%)',
        }}
      />
      <div className="absolute inset-0 hidden bg-black/50 sm:block" />
      <div className="absolute inset-x-0 top-0 hidden h-40 bg-gradient-to-b from-black/80 to-transparent sm:block" />

      <header className="relative z-10 px-6 py-6 sm:px-14">
        <Logo size="text-4xl sm:text-5xl" className="animate-logoIn" />
      </header>

      <main className="relative z-10 flex justify-center px-4 pb-16 sm:pt-2">
        <form
          onSubmit={submit}
          className="w-full max-w-[450px] animate-fadeInUp rounded-md px-4 pb-10 pt-6 sm:bg-black/75 sm:px-[68px] sm:pb-14 sm:pt-12"
        >
          <h1 className="mb-7 text-[32px] font-bold leading-none">Sign In</h1>

          {error && (
            <div role="alert" className="mb-4 rounded bg-[#e87c03] px-5 py-4 text-sm leading-snug text-white animate-dropIn">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <Field id="username" label="Username" value={username} onChange={setUsername} autoFocus autoComplete="username" />
            <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="mt-6 flex h-12 w-full items-center justify-center rounded bg-nf-red text-base font-bold transition-colors hover:bg-nf-redDark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : 'Sign In'}
          </button>

          <label className="mt-4 flex cursor-pointer select-none items-center gap-2 text-[13px] text-[#b3b3b3]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-[#b3b3b3]"
            />
            Remember me
          </label>

          <p className="mt-14 text-[13px] leading-snug text-[#8c8c8c]">
            Accounts are created by the server administrator. Ask them if you need access.
          </p>
        </form>
      </main>
    </div>
  );
}
