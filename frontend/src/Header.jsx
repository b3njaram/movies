import React, { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';
import { ChevronDown, CloseIcon, PencilIcon, SearchIcon } from './Icons';
import { cx } from './utils';
import { useLocale } from './locale';
import { useApp } from './context';

export const NAV = [
  ['home', 'Home'],
  ['tv', 'TV Shows'],
  ['movies', 'Movies'],
  ['new', 'New & Popular'],
  ['list', 'My List'],
  ['discover', 'Discover'],
  ['library', 'Library'],
  ['offline', 'Offline'],
  ['community', 'Community'],
  ['playback', 'Settings'],
];

export default function Header({ page, onNav, onOpenTitle, query, onQuery, profile, isAdmin = false, tvMode = false, onTvMode, profiles, onSwitch, onManage, onLogout, canSearch = true }) {
  const { t } = useLocale();
  const { setUiLang } = useApp();
  const navItems = isAdmin ? [...NAV, ['admin', 'Admin']] : NAV;
  const [scrolled, setScrolled] = useState(false);
  const [text, setText] = useState(query || '');
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [menu, setMenu] = useState(null); // 'profile' | 'browse' | null
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const prevQuery = useRef(query);
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 10);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    const close = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // Debounce what the user types before it reaches the page.
  useEffect(() => {
    const t = setTimeout(() => onQueryRef.current(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  // If the page clears the query (e.g. a nav click), collapse the search box.
  useEffect(() => {
    if (query === '' && prevQuery.current !== '') {
      setText('');
      setSearchOpen(false);
    }
    prevQuery.current = query;
  }, [query]);

  const clearSearch = () => {
    setText('');
    setSearchOpen(false);
    onQueryRef.current('');
  };

  const activeLabel = navItems.find(([id]) => id === page)?.[1] || 'Browse';

  return (
    <header
      ref={rootRef}
      className={cx(
        'fixed inset-x-0 top-0 z-[60] transition-colors duration-500',
        scrolled ? 'bg-nf-black' : 'bg-gradient-to-b from-black/80 via-black/30 to-transparent'
      )}
    >
      <div className="flex h-[58px] items-center px-[4%] sm:h-[68px]">
        <button onClick={() => onNav('home')} aria-label={t("Home")} className="mr-4 shrink-0 sm:mr-8">
          <Logo size="text-[28px] sm:text-[34px]" />
        </button>

        {/* desktop nav */}
        <nav className="hidden items-center gap-3 lg:gap-5 lg:flex">
          {navItems.map(([id, label]) => (
            <button
              key={id}
              onClick={() => onNav(id)}
              className={cx(
                'text-sm transition-colors hover:text-[#b3b3b3]',
                page === id && !query ? 'font-bold text-white' : 'text-[#e5e5e5]'
              )}
            >
              {t(label)}
            </button>
          ))}
        </nav>

        {/* mobile nav */}
        <div className="relative lg:hidden">
          <button onClick={() => setMenu(menu === 'browse' ? null : 'browse')} className="flex items-center gap-1 text-sm font-bold">
            {t(activeLabel)}
            <ChevronDown size={16} className={cx('transition-transform', menu === 'browse' && 'rotate-180')} />
          </button>
          {menu === 'browse' && (
            <div className="absolute left-0 top-9 w-44 animate-dropIn border-t-2 border-white bg-black/95 py-2">
              {navItems.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setMenu(null);
                    onNav(id);
                  }}
                  className={cx('block w-full px-4 py-2.5 text-left text-sm hover:bg-white/10', page === id ? 'font-bold' : 'text-[#b3b3b3]')}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-5">
          {canSearch && (
            <div
              className={cx(
                'flex items-center border transition-all duration-300',
                searchOpen ? 'w-[min(45vw,190px)] border-white bg-black/80 sm:w-[260px]' : 'w-8 border-transparent bg-transparent'
              )}
            >
              <button onClick={() => setSearchOpen(true)} aria-label={t("Search")} className="flex h-8 w-8 shrink-0 items-center justify-center">
                <SearchIcon size={22} />
              </button>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
                onBlur={() => !text && setSearchOpen(false)}
                placeholder={t("Titles, people, genres")}
                className={cx('min-w-0 flex-1 bg-transparent pr-1 text-sm text-white outline-none placeholder:text-[#8c8c8c]', !searchOpen && 'hidden')}
              />
              {searchOpen && text && (
                <button onClick={clearSearch} aria-label={t("Clear search")} className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <CloseIcon size={16} />
                </button>
              )}
            </div>
          )}

          <NotificationBell key={profile.id} onNavigate={onNav} onOpenTitle={onOpenTitle} />
          <button className="shrink-0 rounded border border-white/30 px-2 py-1 text-xs font-bold text-white/85 hover:bg-white/10"
            aria-label={t('Change language')} title={t('Change language')}
            onClick={() => setUiLang(profile.uiLang === 'es' ? 'en' : 'es')}>
            {profile.uiLang === 'es' ? 'EN' : 'ES'}
          </button>
          <div className="relative" onMouseEnter={() => window.matchMedia('(hover:hover)').matches && setMenu('profile')} onMouseLeave={() => menu === 'profile' && setMenu(null)}>
            <button
              onClick={() =>
                // On a mouse the menu opens on hover, so a click must not close it again; on touch it toggles.
                window.matchMedia('(hover:hover)').matches ? setMenu('profile') : setMenu(menu === 'profile' ? null : 'profile')
              }
              className="flex items-center gap-2"
              aria-label={t("Profile menu")}
            >
              <Avatar index={profile.avatar} kids={profile.kids} size={32} rounded="rounded" />
              <ChevronDown size={16} className={cx('hidden transition-transform duration-200 sm:block', menu === 'profile' && 'rotate-180')} />
            </button>
            {menu === 'profile' && (
              <div className="absolute right-0 top-8 w-56 animate-dropIn pt-3">
                <div className="border-t-2 border-white bg-black/95 py-2 shadow-2xl">
                  {profiles
                    .filter((p) => p.id !== profile.id)
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setMenu(null);
                          onSwitch(p);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[#e5e5e5] hover:underline"
                      >
                        <Avatar index={p.avatar} kids={p.kids} size={30} rounded="rounded" />
                        {p.name}
                      </button>
                    ))}
                  <button
                    onClick={() => {
                      setMenu(null);
                      onManage();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[#e5e5e5] hover:underline"
                  >
                    <PencilIcon size={22} className="ml-1" />
                    {t("Manage Profiles")}
                  </button>
                  <button onClick={()=>{setMenu(null);onTvMode?.();}} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-white/15" aria-pressed={tvMode}>
                    {t('TV remote mode')}: {tvMode?t('On'):t('Off')}
                  </button>
                  <div className="my-2 border-t border-white/20" />
                  <button onClick={onLogout} className="block w-full px-4 py-2 text-center text-sm text-[#e5e5e5] hover:underline">
                    {t("Sign out of StreamHub")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
