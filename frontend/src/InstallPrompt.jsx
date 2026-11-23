import React, { useEffect, useState } from 'react';
import { useLocale } from './locale';

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [hidden, setHidden] = useState(false);
  const { t } = useLocale();
  useEffect(() => {
    const on = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (!prompt || hidden) return null;
  return <aside className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-[150] mx-auto max-w-sm rounded-xl border border-white/20 bg-[#222] p-4 text-white shadow-2xl" role="dialog" aria-label={t('Install StreamHub')}>
    <p className="font-bold">{t('Install StreamHub')}</p>
    <p className="mt-1 text-sm text-white/70">{t('Install this app for quick access. Video still requires your server and connection.')}</p>
    <div className="mt-3 flex gap-2"><button className="rounded bg-white px-4 py-2 text-sm font-bold text-black" onClick={async()=>{ await prompt.prompt(); setPrompt(null); }}>{t('Install')}</button>
      <button className="rounded border border-white/30 px-4 py-2 text-sm" onClick={()=>setHidden(true)}>{t('Not now')}</button></div>
  </aside>;
}
