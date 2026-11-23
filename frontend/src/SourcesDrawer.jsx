import { Localized, useLocale } from './locale';
import React from 'react';
import { DownloadIcon, CloseIcon } from './Icons';
import SourcePicker, { LangChip, LangToggle } from './SourcePicker';
import { cx } from './utils';

const SAFE_AUDIO = new Set(['AAC', 'Opus', 'MP3']);

const STATE = {
  playing: { label: '\u25b6 Playing now', tone: 'text-emerald-300', box: 'border-emerald-500/50 bg-emerald-500/10' },
  trying: { label: 'Connecting\u2026', tone: 'text-sky-300', box: 'border-sky-400/40 bg-sky-400/5' },
  failed: { label: '\u2715 Would not play', tone: 'text-red-300', box: 'border-white/10 bg-white/[0.04]' },
  switched: { label: 'Replaced when you chose another source', tone: 'text-white/60', box: 'border-white/10 bg-white/[0.03]' },
};

function AttemptRow({ a, index, onDownload, onDownloadCurrent }) {
  const { t } = useLocale();
  const st = STATE[a.status] || STATE.trying;
  const playing = a.status === 'playing';
  return (
    <div className={cx('rounded-md border p-3', st.box)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-[13px] font-medium leading-snug">{a.title || 'Connecting\u2026'}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#9a9a9a]">
            {a.quality && <span className="rounded bg-white/10 px-1.5 py-px font-bold text-white">{a.quality}</span>}
            <LangChip lang={a.lang} langMatch={a.langMatch} langAssumed={a.langAssumed} />
            {a.audio && <span className={cx('font-bold', SAFE_AUDIO.has(a.audio) ? 'text-emerald-400' : 'text-amber-400')}>{a.audio}</span>}
            {a.size && <span>{a.size}</span>}
            {a.seeders != null && <span className="text-emerald-400">▲ {a.seeders}</span>}
            {a.indexer && <span>{a.indexer}</span>}
          </div>
          <p className={cx('mt-1 text-xs font-bold', st.tone)}>
            {t(st.label)}
            {a.reason ? <span className="font-normal text-white/60"> — {a.reason}</span> : null}
          </p>
        </div>
      </div>
      <button
        onClick={() => (playing ? onDownloadCurrent() : onDownload({ link: a.link, title: a.title }))}
        className={cx(
          'mt-2 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold transition-colors',
          playing ? 'bg-white text-black hover:bg-white/80' : 'border border-white/40 hover:border-white hover:bg-white/10'
        )}
      >
        <DownloadIcon size={14} /> {t(playing ? 'Download this file' : 'Download')}
      </button>
    </div>
  );
}

// A side panel, not a modal: the video keeps playing (and keeps its shortcuts) while it is open.
export default function SourcesDrawer({ spec, attempts, preloaded, statusOf, onClose, onPick, onPickFix, onDownload, onDownloadCurrent }) {
  return (
    <aside
      role="complementary"
      aria-label="Sources"
      className="absolute inset-y-0 right-0 z-30 flex w-full animate-slideLeft flex-col border-l border-white/10 bg-black/90 shadow-2xl backdrop-blur sm:w-[440px]"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h3 className="text-lg font-bold"><Localized text={"Sources"} /></h3>
        <button onClick={onClose} aria-label="Close sources" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15">
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="thin-scroll flex-1 space-y-5 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <LangToggle />

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50"><Localized text={"This viewing"} /></h4>
          {attempts.length === 0 ? (
            <p className="text-sm text-[#b3b3b3]"><Localized text={"Nothing has been tried yet."} /></p>
          ) : (
            <div className="space-y-2">
              {attempts.map((a, i) => (
                <AttemptRow key={a.link} a={a} index={i} onDownload={onDownload} onDownloadCurrent={onDownloadCurrent} />
              ))}
            </div>
          )}
        </section>

        {spec.type !== 'raw' && (
          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50"><Localized text={"All sources"} /></h4>
            <SourcePicker
              spec={spec}
              preloaded={preloaded}
              statusOf={statusOf}
              showLang={false}
              compact
              onPick={onPick}
              onPickFix={onPickFix}
              onDownload={onDownload}
              className="!bg-transparent !p-0"
            />
          </section>
        )}
      </div>
    </aside>
  );
}
