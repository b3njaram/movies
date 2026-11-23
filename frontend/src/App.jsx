import { Localized } from './locale';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setProfileId, getProfileId, BASE } from './api';
import { AppContext } from './context';
import { specFromItem } from './utils';
import Logo from './Logo';
import Login from './Login';
import Profiles from './Profiles';
import Header from './Header';
import Browse, { ListPage } from './Browse';
import Discover from './Discover';
import {defaultTvMode,useTvNavigation} from './tv';
import SearchView from './SearchView';
import TitleModal from './TitleModal';
import Player from './Player';
import Admin from './Admin';
import {LibraryPage,PlaybackSettings} from './Advanced';
import InstallPrompt from './InstallPrompt';
import { useLocale } from './locale';
import { CloseIcon } from './Icons';
import {setQualityPref} from './compat';

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <Logo size="text-6xl sm:text-7xl" className="animate-logoIn" />
    </div>
  );
}

function ProfilePinDialog({target,onUnlock,onCancel}) {
  const {t}=useLocale();
  const [pin,setPin]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await onUnlock(target,pin);}catch(err){setError(err.message);setBusy(false);setPin('');}};
  return <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={t('Unlock profile')}>
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-white/20 bg-[#181818] p-7 shadow-2xl">
      <h2 className="text-2xl font-semibold">{t('Unlock profile')}: {target.name}</h2>
      <p className="mt-2 text-sm text-white/60">{t(target.hasPin?'Enter the profile PIN to continue.':'Enter the account password to switch to this profile.')}</p>
      <input autoFocus required type="password" inputMode={target.hasPin?"numeric":"text"} pattern={target.hasPin?"[0-9]{4,8}":undefined} maxLength={target.hasPin?8:200} autoComplete="off" placeholder={t(target.hasPin?'Profile PIN':'Account password')}
        className="mt-5 w-full rounded bg-white/10 p-3 text-lg tracking-[0.3em] outline-none focus:ring-2 focus:ring-white" value={pin} onChange={e=>setPin(target.hasPin?e.target.value.replace(/\D/g,''):e.target.value)} />
      {error&&<p className="mt-3 text-sm text-rose-300" role="alert">{t(error)}</p>}
      <div className="mt-5 flex gap-3"><button disabled={busy} type="submit" className="btn-white flex-1">{t('Unlock')}</button><button type="button" onClick={onCancel} className="btn-gray flex-1">{t('Cancel')}</button></div>
    </form>
  </div>;
}

export default function App() {
  const { setLang: setLocale, t } = useLocale();
  const [auth, setAuth] = useState({ status: 'loading', username: null, isAdmin: false });
  const [pinTarget,setPinTarget]=useState(null);
  const [tvMode,setTvMode]=useState(defaultTvMode);
  useTvNavigation(tvMode);
  const toggleTvMode=useCallback(()=>setTvMode(v=>{try{localStorage.setItem('sh_tv_mode',v?'0':'1');}catch{}return !v;}),[]);
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [choosing, setChoosing] = useState(true);
  const [manageMode, setManageMode] = useState(false);

  const [page, setPage] = useState('home');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [myList, setMyList] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [status, setStatus] = useState(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [toast, setToast] = useState(null);

  const layers = useRef(0);
  const live = useRef({});
  live.current = { playback, modal };
  const toastTimer = useRef(null);

  const notify = useCallback((text) => {
    setToast({ text, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ------------------------------------------------------------------
  // Session + profiles
  // ------------------------------------------------------------------

  const resetSession = useCallback(() => {
    setProfileId(null);
    setAuth({ status: 'out', username: null, isAdmin: false });
    setProfiles([]);
    setPinTarget(null);
    setProfile(null);
    setChoosing(true);
    setManageMode(false);
    setModal(null);
    setPlayback(null);
    setQuery('');
    setPage('home');
    setMyList([]);
    setStatus(null);
    layers.current = 0;
  }, []);

  const loadProfiles = useCallback(async () => {
    const { profiles: list } = await api('/api/profiles');
    setProfiles(list);
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api('/api/auth/me');
        if (!alive) return;
        const list = await loadProfiles();
        const remembered = list.find((p) => String(p.id) === getProfileId());
        setAuth({ status: 'in', username: me.username, isAdmin: Boolean(me.isAdmin) });
        if (remembered && !remembered.hasPin && !remembered.requiresPassword) {
          try { await api(`/api/profiles/${remembered.id}/activate`,{method:'POST',body:{}}); } catch {setChoosing(true);return;}
          setProfile(remembered);
          setLocale(remembered.uiLang === 'es' ? 'es' : 'en');
          setChoosing(false);
        }
      } catch {
        if (alive) setAuth({ status: 'out', username: null, isAdmin: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadProfiles, setLocale]);

  useEffect(() => {
    window.addEventListener('sh:unauthorized', resetSession);
    return () => window.removeEventListener('sh:unauthorized', resetSession);
  }, [resetSession]);

  const handleLogin = useCallback(
    async (username, isAdmin) => {
      setProfileId(null);
      try {
        await loadProfiles();
        setProfile(null);
        setChoosing(true);
        setAuth({ status: 'in', username, isAdmin: Boolean(isAdmin) });
      } catch {
        setAuth({ status: 'out', username: null, isAdmin: false });
      }
    },
    [loadProfiles]
  );

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    resetSession();
  }, [resetSession]);

  const selectProfile = useCallback(async (p,pin) => {
    if((p.hasPin || p.requiresPassword) && pin === undefined) {setPinTarget(p);return;}
    try {
      await api(`/api/profiles/${p.id}/activate`,{method:'POST',body:p.hasPin?{pin:pin||''}:{accountPassword:pin||''}});
    } catch(e) {
      if(pin === undefined){notify(e.message);return;}
      throw e;
    }
    setPinTarget(null);
    setProfileId(p.id);
    setProfile(p);
    setChoosing(false);
    setManageMode(false);
    setPage('home');
    setQuery('');
    setModal(null);
    setPlayback(null);
    setBannerHidden(false);
    setLocale(p?.uiLang === 'es' ? 'es' : 'en');
    window.scrollTo(0, 0);
  }, [setLocale,notify]);

  const reloadProfiles = useCallback(async ({relock=false}={}) => {
    const list = await loadProfiles();
    if(relock){setProfileId(null);setChoosing(true);setProfile(null);return;}
    setProfile((current) => {
      if (!current) return current;
      const fresh = list.find((p) => p.id === current.id);
      if (!fresh) {
        setProfileId(null);
        setChoosing(true);
        return null;
      }
      return fresh;
    });
  }, [loadProfiles]);

  useEffect(() => { if (profile) setLocale(profile.uiLang === 'es' ? 'es' : 'en'); }, [profile?.uiLang, setLocale]);

  // Per-profile data
  useEffect(() => {
    if (!profile) return;
    api('/api/mylist')
      .then((d) => setMyList(d.items))
      .catch(() => {});
    api('/api/playback/settings').then(d=>setQualityPref(d.settings.quality)).catch(()=>{});
    api('/api/status')
      .then(setStatus)
      .catch(() => {});
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Layers (title modal / player) cooperate with the browser Back button
  // ------------------------------------------------------------------

  const pushLayer = () => {
    window.history.pushState({ sh: true }, '');
    layers.current += 1;
  };

  useEffect(() => {
    const onPop = () => {
      layers.current = Math.max(0, layers.current - 1);
      const { playback: pb, modal: md } = live.current;
      if (pb) {
        setPlayback(null);
        setHistoryVersion((v) => v + 1);
      } else if (md) {
        setModal(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const closeTop = useCallback(() => {
    if (layers.current > 0) window.history.back();
    else {
      setPlayback(null);
      setModal(null);
      setHistoryVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    document.body.style.overflow = playback || modal ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [playback, modal]);

  const openTitle = useCallback((item) => {
    if (!item?.id) return;
    if (!live.current.modal) pushLayer();
    setModal({ type: item.type, id: item.id });
  }, []);

  const play = useCallback((spec) => {
    if (!live.current.playback) pushLayer();
    setPlayback({ spec, key: Date.now() });
  }, []);

  const playTitle = useCallback(
    async (item) => {
      if (!item?.id) return;
      try {
        const base = specFromItem(item);
        if (item.type === 'tv') {
          const t = await api(`/api/title/tv/${item.id}/target`);
          play({ ...base, season: t.season, episode: t.episode, episodeTitle: t.name });
        } else {
          play(base);
        }
      } catch (e) {
        notify(e.message);
      }
    },
    [play, notify]
  );

  const playNext = useCallback((next) => {
    setPlayback((cur) =>
      cur
        ? {
            key: Date.now(),
            spec: {
              ...cur.spec,
              season: next.season,
              episode: next.episode,
              episodeTitle: next.name,
              magnet: undefined,
              source: undefined,
              contentKey: undefined,
              sizeLabel: undefined,
              indexer: undefined,
            },
          }
        : cur
    );
  }, []);

  // Preferred audio language of the current profile ('en' | 'es'). Saved on the server so it follows
  // the profile to every device; it changes how sources are ranked, never what is already playing.
  const setLang = useCallback(
    async (lang) => {
      if (!profile || profile.lang === lang) return;
      const before = profile;
      const after = { ...profile, lang };
      setProfile(after);
      setProfiles((list) => list.map((p) => (p.id === after.id ? after : p)));
      try {
        await api(`/api/profiles/${after.id}`, { method: 'PUT', body: { ...after } });
        notify(lang === 'es' ? 'Preferred audio language: Español' : 'Preferred audio language: English');
      } catch (e) {
        setProfile(before);
        setProfiles((list) => list.map((p) => (p.id === before.id ? before : p)));
        notify(e.message);
      }
    },
    [profile, notify]
  );

  // Download one release to the device that is watching: register it with TorrServer (finds the right
  // file, e.g. the requested episode inside a season pack), then let the browser fetch it as a normal
  // file download. If anything is wrong the user is told before the download starts.
  const download = useCallback(
    async (source, spec = {}) => {
      try {
        notify('Preparing download\u2026');
        const d = await api('/api/stream', { method: 'POST', body: { link: source.link, season: spec.season, episode: spec.episode } });
        const url = `${BASE}/api/download?hash=${d.hash}&index=${d.fileIndex}&name=${encodeURIComponent(d.fileName)}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = d.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        notify(`Downloading ${d.fileName} (${d.fileSize})`);
      } catch (e) {
        notify(e.message);
      }
    },
    [notify]
  );

  // Server-side storage is opt-in; browser downloads remain available.
  const saveToLibrary = useCallback(async (source, spec = {}) => {
    try {
      const data = await api('/api/stream', {method:'POST',body:{link:source.link,season:spec.season,episode:spec.episode,contentKey:spec.contentKey}});
      const key = spec.contentKey || (spec.type==='tv' ? `tv:${spec.tmdbId}:s${spec.season}e${spec.episode}` : spec.type==='movie' ? `movie:${spec.tmdbId}` : data.contentKey);
      await api('/api/downloads/queue',{method:'POST',body:{hash:data.hash,index:data.fileIndex,contentKey:key,
        title:spec.title||data.fileName,mediaType:spec.type||'raw',tmdbId:spec.tmdbId||null,season:spec.season,episode:spec.episode}});
      notify('Added to the server download queue.');
    } catch(e){notify(e.message);}
  },[notify]);

  // ------------------------------------------------------------------
  // My List
  // ------------------------------------------------------------------

  const inList = useCallback((type, id) => myList.some((i) => i.type === type && i.id === id), [myList]);

  const toggleList = useCallback(
    async (item) => {
      const entry = { type: item.type, id: item.id, title: item.title, poster: item.poster, backdrop: item.backdrop, year: item.year };
      const exists = myList.some((i) => i.type === entry.type && i.id === entry.id);
      const previous = myList;
      setMyList(exists ? myList.filter((i) => !(i.type === entry.type && i.id === entry.id)) : [entry, ...myList]);
      try {
        if (exists) await api(`/api/mylist/${entry.type}/${entry.id}`, { method: 'DELETE' });
        else await api('/api/mylist', { method: 'POST', body: entry });
        notify(exists ? 'Removed from My List' : 'Added to My List');
      } catch (e) {
        setMyList(previous);
        notify(e.message);
      }
    },
    [myList, notify]
  );

  const saveProfilePreference = useCallback(async (field, value) => {
    if (!profile || profile[field] === value) return;
    const before = profile;
    const after = {...profile, [field]: value};
    setProfile(after);
    setProfiles(list => list.map(p => p.id === after.id ? after : p));
    if (field === 'uiLang') setLocale(value);
    try {
      await api(`/api/profiles/${after.id}`, {method:'PUT', body: after});
    } catch (e) {
      setProfile(before);
      setProfiles(list => list.map(p => p.id === before.id ? before : p));
      if (field === 'uiLang') setLocale(before.uiLang || 'en');
      notify(e.message);
    }
  }, [profile, notify, setLocale]);

  const setSubLang = useCallback(value => saveProfilePreference('subLang', value), [saveProfilePreference]);
  const setUiLang = useCallback(value => saveProfilePreference('uiLang', value), [saveProfilePreference]);

  const cancelPin=()=>setPinTarget(null);
  const pinDialog=pinTarget && <ProfilePinDialog key={pinTarget.id} target={pinTarget} onUnlock={selectProfile} onCancel={cancelPin}/>;

  const ctx = useMemo(
    () => ({ profile, myList, inList, toggleList, openTitle, play, playTitle, notify, download, saveToLibrary, setLang, setSubLang, setUiLang }),
    [profile, myList, inList, toggleList, openTitle, play, playTitle, notify, download, saveToLibrary, setLang, setSubLang, setUiLang]
  );

  const nav = (id) => {
    setQuery('');
    setPage(id);
    window.scrollTo({ top: 0 });
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'out') return <Login onLogin={handleLogin} />;

  if (choosing || !profile) {
    return (
      <>
      <Profiles
        key={manageMode ? 'manage' : 'choose'}
        profiles={profiles}
        startInManage={manageMode}
        onSelect={selectProfile}
        onReload={reloadProfiles}
        onLogout={logout}
        onDone={
          manageMode
            ? () => {
                setManageMode(false);
                if (profile) setChoosing(false);
              }
            : undefined
        }
      />
      {pinDialog}
      </>
    );
  }

  const problem = status && (!status.prowlarr?.ok ? status.prowlarr.reason : !status.torrserver?.ok ? status.torrserver.reason : null);
  const searching = query.trim().length >= 2;

  return (
    <AppContext.Provider value={ctx}>
      <div className={`min-h-screen bg-nf-black ${tvMode ? 'tv-mode' : ''}`}>
        <Header
          page={page}
          onNav={nav}
          query={query}
          onQuery={setQuery}
          profile={profile}
          isAdmin={auth.isAdmin && profile.maxAge>=18}
          tvMode={tvMode}
          onTvMode={toggleTvMode}
          profiles={profiles}
          onSwitch={selectProfile}
          onManage={() => {
            setManageMode(true);
            setChoosing(true);
          }}
          onLogout={logout}
        />

        {problem && !bannerHidden && (
          <div className="fixed inset-x-0 top-[58px] z-50 flex animate-dropIn items-center justify-center gap-3 bg-[#b9090b] px-4 py-2 text-center text-sm sm:top-[68px]">
            <span>{problem} <Localized text={"Playback and search may not work until this is fixed."} /></span>
            <button onClick={() => setBannerHidden(true)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">
              <CloseIcon size={16} />
            </button>
          </div>
        )}

        <main>
          {page === 'admin' && auth.isAdmin && profile.maxAge>=18 ? (
            <Admin />
          ) : searching ? (
            <SearchView query={query.trim()} />
          ) : page === 'library' ? (
            <LibraryPage />
          ) : page === 'playback' ? (
            <PlaybackSettings />
          ) : page === 'discover' ? (
            <Discover />
          ) : page === 'list' ? (
            <ListPage />
          ) : (
            <Browse page={page} historyVersion={historyVersion} suspended={Boolean(modal || playback)} />
          )}
        </main>

        {modal && <TitleModal target={modal} onClose={closeTop} onOpenOther={(i) => setModal({ type: i.type, id: i.id })} />}
        {playback && <Player key={playback.key} spec={playback.spec} onClose={closeTop} onNext={playNext} />}

        {pinDialog}
        <InstallPrompt />
        {toast && (
          <div key={toast.id} className="fixed bottom-6 left-6 z-[300] max-w-[80vw] animate-fadeInUp rounded bg-white px-5 py-3 text-sm font-medium text-black shadow-2xl">
            {toast.text}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
