import { Localized, useLocale } from './locale';
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { useApp } from './context';
import Card from './Card';
import { SourceRow, SkippedNote } from './SourcePicker';

export default function SearchView({ query }) {
  const { t } = useLocale();
  const { profile, openTitle, playTitle, play, download } = useApp();
  const [catalog, setCatalog] = useState({ loading: true, results: [], configured: true });
  const [raw, setRaw] = useState(null); // null = not requested yet

  useEffect(() => {
    let alive = true;
    setRaw(null);
    setCatalog((c) => ({ ...c, loading: true }));
    api(`/api/search?q=${encodeURIComponent(query)}`)
      .then((d) => alive && setCatalog({ loading: false, results: d.results, configured: d.configured, error: '' }))
      .catch((e) => alive && setCatalog({ loading: false, results: [], configured: true, error: e.message }));
    return () => {
      alive = false;
    };
  }, [query]);

  const searchRaw = () => {
    setRaw({ loading: true, results: [], error: '' });
    api(`/api/sources?q=${encodeURIComponent(query)}`)
      .then((d) => setRaw({ loading: false, results: d.results, skipped: d.skipped || [], error: '' }))
      .catch((e) => setRaw({ loading: false, results: [], error: e.message }));
  };

  // Without a catalog the only thing to search is the indexers themselves.
  useEffect(() => {
    if (!catalog.loading && !catalog.configured && !profile.kids && raw === null) searchRaw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.loading, catalog.configured]);

  const rawSpec = (source) => ({ type: 'raw', title: source.title, magnet: source.link, sizeLabel: source.size, indexer: source.indexer });
  const playRaw = (source) => play(rawSpec(source));
  const playRawFixed = (source) => play({ ...rawSpec(source), audioFix: true });

  return (
    <div className="min-h-screen px-[4%] pb-24 pt-28 animate-fadeIn">
      {catalog.configured && (
        <>
          {catalog.loading ? (
            <div className="grid grid-cols-3 gap-x-2 gap-y-10 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skeleton aspect-[2/3] rounded-[5px]" />
              ))}
            </div>
          ) : catalog.error ? (
            <p className="text-lg text-[#e87c03]">{t(catalog.error)}</p>
          ) : catalog.results.length > 0 ? (
            <>
              <h2 className="mb-6 text-lg text-[#e5e5e5]">
                <Localized text={"Titles related to"} suffix=" " /><span className="font-bold text-white">&ldquo;{query}&rdquo;</span>
              </h2>
              <div className="grid grid-cols-3 gap-x-2 gap-y-10 sm:grid-cols-4 lg:grid-cols-6">
                {catalog.results.map((item) => (
                  <Card key={`${item.type}-${item.id}`} item={item} fluid onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
                ))}
              </div>
            </>
          ) : (
            <div className="mt-16 text-center text-[#b3b3b3]">
              <p className="text-lg">
                <Localized text={"Your search for"} suffix=" " /><span className="font-bold text-white">&ldquo;{query}&rdquo;</span> <Localized text={"did not have any matches."} /></p>
              <p className="mt-2 text-sm"><Localized text={"Suggestions: try different keywords, or a movie or TV show title."} /></p>
            </div>
          )}
        </>
      )}

      {!profile.kids && (
        <section className="mt-14 max-w-[900px]">
          {raw === null ? (
            catalog.configured && (
              <button onClick={searchRaw} className="text-sm text-[#b3b3b3] underline-offset-4 transition-colors hover:text-white hover:underline">
                <Localized text={"Can't find it? Search your indexers directly for “"} />{query}&rdquo;
              </button>
            )
          ) : (
            <>
              <h2 className="mb-3 text-xl font-bold"><Localized text={"From your indexers"} /></h2>
              <div className="rounded-md bg-[#1f1f1f] p-2">
                {raw.loading && (
                  <div className="flex items-center gap-3 px-3 py-6 text-sm text-[#b3b3b3]">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-nf-red" />
                    <Localized text={"Searching your indexers…"} /></div>
                )}
                {raw.error && <p className="px-3 py-4 text-sm text-[#e87c03]">{t(raw.error)}</p>}
                {!raw.loading && !raw.error && raw.results.length === 0 && (
                  <p className="px-3 py-4 text-sm text-[#b3b3b3]"><Localized text={"Nothing found on your indexers."} /></p>
                )}
                <div className="thin-scroll max-h-[520px] overflow-y-auto">
                  {raw.results.map((s) => (
                    <SourceRow key={s.id} source={s} onPick={playRaw} onPickFix={playRawFixed} onDownload={(src) => download(src)} />
                  ))}
                </div>
                <SkippedNote skipped={raw.skipped} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
