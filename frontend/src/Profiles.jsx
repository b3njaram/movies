import { Localized } from './locale';
import React, { useState } from 'react';
import { api } from './api';
import Avatar, { AVATAR_COLORS } from './Avatar';
import { PencilIcon, PlusIcon } from './Icons';
import Logo from './Logo';
import { useLocale } from './locale';

function ProfileTile({ profile, manage, index, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-[84px] flex-col items-center gap-3 animate-fadeInUp sm:w-[120px] md:w-[150px] lg:w-[170px]"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md border-2 border-transparent transition-all duration-200 group-hover:scale-105 group-hover:border-white">
        <Avatar index={profile.avatar} kids={profile.kids} size={200} className="h-full w-full" rounded="" />
        {manage && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 animate-fadeIn">
            <PencilIcon size={44} className="text-white" />
          </div>
        )}
      </div>
      <span className="max-w-full truncate text-sm text-[#808080] transition-colors group-hover:text-white sm:text-lg">
        {profile.name}
      </span>
    </button>
  );
}

function Editor({ profile, canDelete, onSaved, onCancel, onDeleted }) {
  const { t, lang: locale } = useLocale();
  const isNew = !profile.id;
  const [name, setName] = useState(profile.name || '');
  const [avatar, setAvatar] = useState(profile.avatar ?? 0);
  const [kids, setKids] = useState(Boolean(profile.kids));
  const [lang, setLangState] = useState(profile.lang === 'es' ? 'es' : 'en');
  const [subLang, setSubLangState] = useState(['en','es'].includes(profile.subLang) ? profile.subLang : 'off');
  const [uiLang, setUiLangState] = useState(profile.uiLang === 'es' ? 'es' : locale);
  const [maxAge,setMaxAge]=useState(profile.maxAge ?? (profile.kids?10:18));
  const [pinAction,setPinAction]=useState('keep');
  const [newPin,setNewPin]=useState('');
  const [accountPassword,setAccountPassword]=useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { name, avatar, kids, lang, subLang, uiLang, maxAge: kids?Math.min(maxAge,13):maxAge, accountPassword };
      if(pinAction==='set')body.newPin=newPin;
      if(pinAction==='remove')body.newPin='';
      if (isNew) await api('/api/profiles', { method: 'POST', body });
      else await api(`/api/profiles/${profile.id}`, { method: 'PUT', body });
      await onSaved({relock:pinAction!=='keep'});
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${t('Delete the profile and its watch history?')} (${profile.name})`)) return;
    setBusy(true);
    try {
      await api(`/api/profiles/${profile.id}`, { method: 'DELETE', body:{accountPassword} });
      await onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[640px] px-6 animate-fadeIn">
      <h1 className="text-4xl font-medium sm:text-6xl">{isNew ? t('Add Profile') : t('Edit Profile')}</h1>
      <p className="mt-2 text-lg text-[#808080]">{isNew ? t('Add a profile for another person watching.') : ''}</p>
      <hr className="my-6 border-[#333]" />

      <div className="flex flex-col gap-6 sm:flex-row">
        <Avatar index={avatar} kids={kids} size={120} className="shrink-0" />
        <div className="flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder={t("Name")}
            autoFocus
            className="h-11 w-full bg-[#666] px-3 text-lg text-white outline-none placeholder:text-white/60 focus:bg-[#777]"
          />
          <div className="mt-5 flex flex-wrap gap-2">
            {AVATAR_COLORS.map((c, i) => (
              <button
                key={c}
                onClick={() => setAvatar(i)}
                aria-label={`Avatar ${i + 1}`}
                className={`h-9 w-9 rounded transition-transform hover:scale-110 ${avatar === i ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-6">
            <p className="mb-2 text-lg">{t("Preferred audio language")}</p>
            <div className="flex w-fit overflow-hidden rounded border border-[#808080]">
              {[
                ['en', 'English'],
                ['es', 'Español'],
              ].map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => setLangState(code)}
                  aria-pressed={lang === code}
                  className={`px-5 py-2 text-base transition-colors ${lang === code ? 'bg-white font-medium text-black' : 'text-[#b3b3b3] hover:bg-white/10'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-[#808080]">{t("Releases in this language are listed and played first.")}</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-white/80">{t('Preferred subtitles')}
              <select value={subLang} onChange={e => setSubLangState(e.target.value)}
                className="mt-2 block w-full rounded border border-white/30 bg-[#222] p-2 text-white">
                <option value="off">{t('Off')}</option><option value="en">{t('English')}</option><option value="es">{t('Español')}</option>
              </select>
            </label>
            <label className="text-sm text-white/80">{t('Interface language')}
              <select value={uiLang} onChange={e => setUiLangState(e.target.value)}
                className="mt-2 block w-full rounded border border-white/30 bg-[#222] p-2 text-white">
                <option value="en">{t('English')}</option><option value="es">{t('Español')}</option>
              </select>
            </label>
          </div>
          <label className="mt-6 flex cursor-pointer select-none items-center gap-3 text-lg">
            <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} className="h-5 w-5 accent-white" />
            {t("Kids profile")}
            <span className="text-sm text-[#808080]">{t("(only family-friendly titles)")}</span>
          </label>
          <div className="mt-6 rounded border border-white/15 bg-white/5 p-4">
            <label className="block text-sm font-semibold">{t('Maximum content age')}
              <select value={kids?Math.min(maxAge,13):maxAge} onChange={e=>setMaxAge(Number(e.target.value))} className="mt-2 w-full rounded bg-[#242424] p-2 text-white">
                {[[0,'All ages'],[7,'7+'],[10,'10+'],[13,'13+'],...(kids?[]:[[16,'16+'],[18,'Unrestricted']])].map(([age,label])=><option key={age} value={age}>{t(label)}</option>)}
              </select>
            </label>
            {!isNew&&<div className="mt-4">
              <p className="mb-2 text-sm font-semibold">{t('Profile PIN')} {profile.hasPin?'🔒':''}</p>
              <select value={pinAction} onChange={e=>setPinAction(e.target.value)} className="w-full rounded bg-[#242424] p-2">
                <option value="keep">{t('Keep current PIN')}</option><option value="set">{t('Set or change PIN')}</option><option value="remove">{t('Remove PIN')}</option>
              </select>
              {pinAction==='set'&&<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" maxLength={8}
                placeholder={t('New 4–8 digit PIN')} value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,''))}
                className="mt-2 w-full rounded bg-[#333] p-3"/>}
            </div>}
            <label className="mt-4 block text-xs text-white/65">{t('Account password (required for sensitive changes)')}
              <input type="password" autoComplete="current-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)}
                className="mt-2 block w-full rounded bg-[#333] p-3 text-base text-white" placeholder={t('Account password')}/>
            </label>
            <p className="mt-3 text-xs text-amber-100/70">{t('Protect adult profiles with PINs to prevent switching around age limits.')}</p>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-[#e87c03]">{t(error)}</p>}
      <hr className="my-6 border-[#333]" />

      <div className="flex flex-wrap gap-4">
        <button
          onClick={save}
          disabled={busy || !name.trim()}
          className="bg-white px-6 py-2 text-lg font-medium uppercase tracking-wider text-black transition-colors hover:bg-nf-red hover:text-white disabled:opacity-50"
        >
          {t("Save")}
        </button>
        <button
          onClick={onCancel}
          className="border border-[#808080] px-6 py-2 text-lg uppercase tracking-wider text-[#808080] transition-colors hover:border-white hover:text-white"
        >
          {t("Cancel")}
        </button>
        {!isNew && canDelete && (
          <button
            onClick={remove}
            disabled={busy}
            className="border border-[#808080] px-6 py-2 text-lg uppercase tracking-wider text-[#808080] transition-colors hover:border-white hover:text-white"
          >
            {t("Delete Profile")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Profiles({ profiles, onSelect, onReload, onLogout, startInManage = false, onDone }) {
  const { t, lang: locale } = useLocale();
  const [manage, setManage] = useState(startInManage);
  const [editing, setEditing] = useState(null);

  const reload = async (options = {}) => {
    await onReload(options);
    setEditing(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-nf-black">
      <header className="px-6 py-6 sm:px-14">
        <Logo size="text-4xl sm:text-5xl" />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center pb-24">
        {editing ? (
          <Editor
            key={editing.id || 'new'}
            profile={editing}
            canDelete={profiles.length > 1}
            onSaved={reload}
            onDeleted={reload}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <h1 className="animate-fadeIn text-3xl font-medium sm:text-[3.5vw] sm:leading-none">
              {manage ? t('Manage Profiles:') : t("Who's watching?")}
            </h1>

            <div className="mt-8 flex flex-wrap items-start justify-center gap-3 px-4 sm:gap-6">
              {profiles.map((p, i) => (
                <ProfileTile key={p.id} profile={p} index={i} manage={manage} onClick={() => (manage ? setEditing(p) : onSelect(p))} />
              ))}

              <button
                onClick={() => setEditing({ name: '', avatar: profiles.length % 8, kids: false, lang: 'en', subLang: 'off', uiLang: locale })}
                className="group flex w-[84px] flex-col items-center gap-3 animate-fadeInUp sm:w-[120px] md:w-[150px] lg:w-[170px]"
                style={{ animationDelay: `${Math.min(profiles.length, 8) * 70}ms` }}
              >
                <div className="flex aspect-square w-full items-center justify-center rounded-md transition-all duration-200 group-hover:bg-white">
                  <PlusIcon size={72} className="text-[#808080] transition-colors group-hover:text-black" />
                </div>
                <span className="text-sm text-[#808080] transition-colors group-hover:text-white sm:text-lg">{t("Add Profile")}</span>
              </button>
            </div>

            <div className="mt-14 flex gap-4">
              {manage ? (
                <button
                  onClick={() => (onDone ? onDone() : setManage(false))}
                  className="bg-white px-6 py-2 text-lg font-medium uppercase tracking-wider text-black transition-colors hover:bg-nf-red hover:text-white"
                >
                  {t("Done")}
                </button>
              ) : (
                <button
                  onClick={() => setManage(true)}
                  className="border border-[#808080] px-6 py-2 text-base uppercase tracking-wider text-[#808080] transition-colors hover:border-white hover:text-white sm:text-lg"
                >
                  {t("Manage Profiles")}
                </button>
              )}
              {!manage && onLogout && (
                <button
                  onClick={onLogout}
                  className="border border-transparent px-4 py-2 text-base uppercase tracking-wider text-[#808080] transition-colors hover:text-white sm:text-lg"
                >
                  <Localized text={"Sign out"} /></button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
