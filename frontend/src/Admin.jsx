import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useLocale } from './locale';

// Administration is only rendered for an authenticated admin. The backend
// rechecks permissions on every request; no secret is kept in the browser.
export default function Admin() {
  const { t } = useLocale();
  const [users, setUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({username:'',password:''});
  const [reset, setReset] = useState({id:null,password:''});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const [u,o] = await Promise.all([api('/api/admin/users'), api('/api/admin/overview')]);
    setUsers(u.users || []); setOverview(o);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  const perform = async (fn, message) => {
    setError(''); setNotice(''); setBusy(true);
    try { await fn(); await refresh(); setNotice(t(message)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const create = async (e) => {
    e.preventDefault();
    await perform(async () => {
      await api('/api/admin/users', {method:'POST',body:form});
      setForm({username:'',password:''});
    }, 'Account created.');
  };
  const change = async (id, action, password) => {
    if (action === 'disable' && !window.confirm(t('Are you sure?'))) return;
    await perform(async () => {
      await api(`/api/admin/users/${id}`, {method:'PATCH',body:{action,password}});
      setReset({id:null,password:''});
    }, action === 'reset-password' ? 'Password updated; previous sessions were signed out.' : action === 'disable' ? 'Account disabled; previous sessions were signed out.' : 'Account enabled.');
  };
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-24 text-white sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold sm:text-4xl">{t('Dashboard')}</h1>
          <p className="mt-2 text-sm text-white/55">{t('Your session remains private; this area is for administrators only.')}</p></div>
        <button className="rounded border border-white/30 px-4 py-2 hover:bg-white/10" onClick={() => perform(refresh, 'Refresh')} disabled={busy}>{t('Refresh')}</button>
      </div>
      {error && <div role="alert" className="mt-5 rounded bg-red-900/60 p-3">{t(error)}</div>}
      {notice && <div role="status" className="mt-5 rounded bg-emerald-900/50 p-3">{notice}</div>}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[[t('Users'),overview?.users],[t('Profiles'),overview?.profiles],[t('Viewing history'),overview?.progressItems],[t('Recently active torrents'),overview?.recentTorrents]].map(([title,value])=>(
          <div key={title} className="rounded-lg border border-white/10 bg-[#222] p-4"><p className="text-xs text-white/60">{title}</p><p className="mt-2 text-3xl font-bold tabular-nums">{value ?? '—'}</p></div>
        ))}
      </section>
      <section className="mt-6 rounded-lg border border-white/10 bg-[#1b1b1b] p-4 sm:p-6">
        <h2 className="text-lg font-semibold">{t('Server status')}</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {['prowlarr','torrserver'].map(s => <span className="rounded bg-white/10 px-3 py-2" key={s}>{s === 'prowlarr' ? 'Prowlarr' : 'TorrServer'}: <strong className={overview?.[s]?.ok ? 'text-green-400' : 'text-amber-400'}>{overview?.[s]?.ok ? t('Connected') : t('Unavailable')}</strong></span>)}
        </div>
        <p className="mt-3 text-xs text-white/45">{overview?.prowlarr?.reason || overview?.torrserver?.reason || ''}</p>
      </section>
      <section className="mt-6 rounded-lg border border-white/10 bg-[#1b1b1b] p-4 sm:p-6">
        <h2 className="mb-4 text-xl font-bold">{t('Create account')}</h2>
        <form onSubmit={create} className="flex flex-wrap gap-3">
          <input aria-label={t('Username')} className="min-w-0 flex-1 rounded bg-[#333] p-3 outline-offset-2" autoComplete="off" placeholder={t('Username')} minLength={3} maxLength={40} required value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}/>
          <input aria-label={t('Password')} className="min-w-0 flex-1 rounded bg-[#333] p-3 outline-offset-2" autoComplete="new-password" type="password" minLength={8} required value={form.password} placeholder={t('Password')} onChange={e=>setForm(f=>({...f,password:e.target.value}))}/>
          <button disabled={busy} className="rounded bg-white px-5 py-3 font-bold text-black disabled:opacity-50" type="submit">{t('Create user')}</button>
        </form>
      </section>
      <section className="mt-6 rounded-lg border border-white/10 bg-[#1b1b1b] p-4 sm:p-6">
        <h2 className="mb-4 text-xl font-bold">{t('Manage accounts')}</h2>
        <div className="space-y-3">
          {users.map(u => <div key={u.id} className="rounded border border-white/10 bg-[#222] p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="break-all font-semibold">{u.username} {u.isAdmin && <span className="ml-2 rounded bg-red-800/60 px-2 py-0.5 text-xs">{t('Administrator')}</span>}</p>
                <p className="mt-1 text-xs text-white/50">{u.profiles} {t('Profiles')} · {u.historyItems} {t('Viewing history')} · {u.disabled ? t('Disabled') : t('Active')}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button disabled={busy} className="rounded border border-white/40 px-3 py-2 hover:bg-white/10" onClick={()=>setReset({id:reset.id===u.id?null:u.id,password:''})}>{t('Reset password')}</button>
                {!u.isAdmin && <button disabled={busy} className="rounded border border-white/40 px-3 py-2 hover:bg-white/10" onClick={()=>change(u.id,u.disabled?'enable':'disable')}>{u.disabled?t('Enable'):t('Disable')}</button>}
              </div>
            </div>
            {reset.id === u.id && <form className="mt-3 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();change(u.id,'reset-password',reset.password);}}>
              <input type="password" autoComplete="new-password" aria-label={t('New password')} placeholder={t('New password')} minLength={8} required value={reset.password} onChange={e=>setReset(r=>({...r,password:e.target.value}))} className="min-w-0 flex-1 rounded bg-[#333] p-2" />
              <button className="rounded bg-white px-4 py-2 font-bold text-black" disabled={busy}>{t('Save')}</button>
              <button className="rounded border border-white/30 px-4 py-2" type="button" onClick={()=>setReset({id:null,password:''})}>{t('Cancel')}</button>
            </form>}
          </div>)}
        </div>
      </section>
    </div>
  );
}
