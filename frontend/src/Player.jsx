import { Localized } from './locale';
import {shiftTextTrack} from './subtitle-timing';
import {castMedia} from './chromecast';
import {saveOffline} from './Offline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, BASE, getProfileId, sendBeaconJson } from './api';
import { useApp } from './context';
import {
  BackIcon,
  ChevronDown,
  DownloadIcon,
  ExitFullscreenIcon,
  Forward10,
  FullscreenIcon,
  ListIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  Rewind10,
  SpeedIcon,
  VolumeIcon,
  WarningIcon,
} from './Icons';
import SourcesDrawer from './SourcesDrawer';
import { LangChip } from './SourcePicker';
import { contentKeyOf, cx, fmtSpeed, fmtTime } from './utils';
import { getRankedSources, rememberSuccessfulSource } from './compat';
import { useLocale } from './locale';
import { nearestInDirection } from './tv-spatial';
import {localDeviceId,localDeviceName} from './device';
import {decideStall} from './stall-recovery';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Automatic source fallback: how many candidates one search pass will try to connect to, how many
// sources may fail in total before giving up, and how long a connected source may stay silent.
const MAX_AUTO_SOURCES = 6;
const MAX_FALLBACKS = 8;
const STARTUP_TIMEOUT_MS = Number(import.meta.env.VITE_STARTUP_TIMEOUT_MS) || 45000;

function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem('sh_volume'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

// "Always use the audio fix when a file needs it" — remembered once the viewer turns it on.
const autoFixPref = () => {
  try {
    return localStorage.getItem('sh_audiofix') === '1';
  } catch {
    return false;
  }
};
const setAutoFixPref = (on) => {
  try {
    localStorage.setItem('sh_audiofix', on ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const LANG_ALIAS = { fre: 'fra', ger: 'deu', chi: 'zho', dut: 'nld', gre: 'ell', cze: 'ces', rum: 'ron', per: 'fas' };
function langName(code) {
  if (!code || code === 'und') return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(LANG_ALIAS[code] || code);
    if (name && name !== code) return name;
  } catch {
    /* fall through */
  }
  return code.toUpperCase();
}

function trackLabel(t) {
  const ch = t.channels === 6 ? ' 5.1' : t.channels === 8 ? ' 7.1' : t.channels > 2 ? ` ${t.channels}ch` : '';
  const name = langName(t.lang) || `Track ${t.ord + 1}`;
  return `${name}${t.title ? ` \u2013 ${t.title}` : ''} \u00b7 ${String(t.codec).toUpperCase()}${ch}`;
}

export default function Player({ spec, onClose, onNext }) {
  const { notify, download, profile, setSubLang } = useApp();
  const { t } = useLocale();

  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const barRef = useRef(null);
  const idleTimer = useRef(null);
  const scrubRef = useRef(null);
  const resumeAtRef = useRef(0);
  const resumedRef = useRef(false);
  const seekingRef = useRef(false);
  const canReport = useRef(false);
  const metaRef = useRef({});
  const streamRef = useRef(null);
  const lastPos = useRef({ t: 0, d: 0 });
  const menuOpenRef = useRef(false);
  const fixExplicitRef = useRef(Boolean(spec.audioFix));
  const hintDismissedRef = useRef(false);
  const fixOnRef = useRef(false);
  const convertRef = useRef(false);
  const baseRef = useRef(0);
  const durRef = useRef(0);
  const failedRef = useRef(new Set()); // source links that connected but would not play
  const currentLinkRef = useRef(null); // the source currently being played
  const playedRef = useRef(false); // has this source produced picture yet?
  const lastAdvanceRef = useRef(Date.now());
  const lastAbsRef = useRef(0);
  const softRetryRef = useRef(0);
  const forcedRef = useRef(null);

  const [phase, setPhase] = useState('resolving'); // resolving | ready | error
  const [message, setMessage] = useState('Finding the best source…');
  const [errorText, setErrorText] = useState('');
  const [stream, setStream] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [forced, setForced] = useState(spec.source || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // log of the sources this viewing has tried and what happened to each
  const [attempts, setAttempts] = useState([]);
  const attemptsRef = useRef([]);
  const [searched, setSearched] = useState(null); // the player's own source search, reused by the drawer
  const [nowPlaying, setNowPlaying] = useState(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateMenu, setRateMenu] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [stats, setStats] = useState(null);
  const [nextEp, setNextEp] = useState(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [scrub, setScrub] = useState(null);
  const [hoverPct, setHoverPct] = useState(null);
  const [previewAt,setPreviewAt]=useState(null);
  const [previewError,setPreviewError]=useState(false);
  const [skipMarkers,setSkipMarkers]=useState({introStart:null,introEnd:null,creditsStart:null});
  const [skipMenu,setSkipMenu]=useState(false);
  const [draftIntroStart,setDraftIntroStart]=useState(null);
  const [canCast,setCanCast]=useState(false);

  // audio fix
  const [fixOn, setFixOn] = useState(false);
  const [convertOn,setConvertOn]=useState(false);
  const [convertOffset,setConvertOffset]=useState(0);
  const [convertHeight,setConvertHeight]=useState(720);
  const [saveBusy,setSaveBusy]=useState(false);
  const [partyCode,setPartyCode]=useState(spec.partyCode||null);
  const [partyHost,setPartyHost]=useState(Boolean(spec.partyHost));
  const [partyViewers,setPartyViewers]=useState(1);
  const [partyChatOpen,setPartyChatOpen]=useState(false);
  const [partyMessages,setPartyMessages]=useState([]);
  const [partyDraft,setPartyDraft]=useState('');
  const [partySending,setPartySending]=useState(false);


  const [fixOffset, setFixOffset] = useState(0);
  const [fixTrack, setFixTrack] = useState(0);
  const [fixInfo, setFixInfo] = useState(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [audioMenu, setAudioMenu] = useState(false);
  const [noAudioHint, setNoAudioHint] = useState(false);
  const [subtitleFiles, setSubtitleFiles] = useState([]);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [localSubtitle, setLocalSubtitle] = useState(null);
  const subtitleInput = useRef(null);
  const subtitleUrl = useRef(null);
  const subtitleOriginalTimes = useRef(new WeakMap());
  const [subtitleOffset,setSubtitleOffset] = useState(0);
  const [subtitleSize,setSubtitleSize] = useState(100);
  const [savingOffline,setSavingOffline] = useState(false);

  const contentKey = contentKeyOf(spec);
  const supportsMarkers=/^(movie:\d+|tv:\d+:s\d+e\d+)$/.test(contentKey);
  menuOpenRef.current = rateMenu || pickerOpen || audioMenu || subMenuOpen || skipMenu;
  forcedRef.current = forced;

  const markAttempt = useCallback((link, patch = {}, { fill = false } = {}) => {
    const list = attemptsRef.current;
    let a = list.find((x) => x.link === link);
    if (!a) {
      a = { link, status: 'trying' };
      list.push(a);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (fill && a[k] !== undefined && a[k] !== null && a[k] !== '') continue;
      a[k] = v;
    }
    setAttempts(list.map((x) => ({ ...x })));
  }, []);

  // In audio-fix mode the <video> only knows the time since its own (re)start, so the real position
  // is the stream's start offset plus the video's currentTime. Everything below goes through these.
  fixOnRef.current = fixOn;
  convertRef.current = convertOn;
  baseRef.current = fixOn ? fixOffset : convertOn ? convertOffset : 0;
  durRef.current = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const videoSrc = stream
    ? convertOn
      ? `${BASE}/api/video/convert?${stream.localId ? `libraryId=${stream.localId}` : `hash=${stream.hash}&index=${stream.fileIndex}`}&t=${Math.floor(convertOffset)}&height=${convertHeight}`
    : fixOn
      ? `${BASE}/api/audiofix/stream?hash=${stream.hash}&index=${stream.fileIndex}&t=${Math.floor(fixOffset)}&a=${fixTrack}`
      : stream.streamUrl
    : null;

  // Per-profile manual intro/credits markers. They are not inferred from film
  // metadata, so nothing is skipped unexpectedly or across different episodes.
  useEffect(()=>{
    if(!supportsMarkers)return;
    let alive=true;
    setDraftIntroStart(null);
    api(`/api/skip-markers?contentKey=${encodeURIComponent(contentKey)}`)
      .then(d=>alive&&setSkipMarkers(d.markers)).catch(()=>{});
    return()=>{alive=false;};
  },[contentKey,supportsMarkers,profile?.id]);
  const writeMarkers=useCallback(async values=>{
    try {
      const d=await api('/api/skip-markers',{method:'PUT',body:{contentKey,markers:values}});
      setSkipMarkers(d.markers);
      notify(t('Skip markers saved.'));
    } catch(e){notify(e.message);}
  },[contentKey,notify,t]);
  useEffect(()=>{
    const v=videoRef.current;
    setCanCast(Boolean(v?.remote?.prompt || v?.webkitShowPlaybackTargetPicker));
    if(v)v.setAttribute('x-webkit-airplay','allow');
  },[videoSrc]);
  const castSavedToChromecast=useCallback(async()=>{
    if(!stream?.localId&&!stream?.localMediaId)return notify('Save this video to the server before casting to Chromecast.');
    try{
      const kind=stream.localId?'library':'media',id=stream.localId||stream.localMediaId;
      const response=await api('/api/cast/session',{method:'POST',body:{kind,id}});
      const url=new URL(response.path,window.location.origin).href;
      await castMedia({url,title:spec.title,mime:response.mime,position:videoRef.current?.currentTime||0});
      notify('Chromecast playback started.');
    }catch(e){notify(e.message);}
  },[stream?.localId,stream?.localMediaId,spec.title,notify]);
  const saveToPhone=useCallback(async()=>{
    if(!stream||savingOffline)return;
    const src=stream.localId?`${BASE}/api/library/stream/${stream.localId}`:
      stream.localMediaId?`${BASE}/api/local-media/stream/${stream.localMediaId}`:
      stream.hash?`${BASE}/api/download?hash=${encodeURIComponent(stream.hash)}&index=${stream.fileIndex}&name=${encodeURIComponent(stream.fileName||'video.mp4')}`:null;
    if(!src)return notify('This source cannot be downloaded offline.');
    setSavingOffline(true);notify('Saving video for offline playback…');
    try{
      await saveOffline(src,{title:spec.title,poster:spec.poster,profileId:profile.id,profileName:profile.name},
        ({downloaded,total})=>{ /* Keep active video playing during device download. */ });
      notify('Saved! Open Offline Downloads to play without internet.');
    }catch(e){notify(e.message);}finally{setSavingOffline(false);}
  },[stream,savingOffline,spec.title,spec.poster,profile?.id,profile?.name,notify]);
  useEffect(()=>{
    const el=videoRef.current;if(!el)return;
    const apply=()=>{for(const track of Array.from(el.textTracks||[]))shiftTextTrack(track,subtitleOffset,subtitleOriginalTimes.current);};
    const nodes=Array.from(el.querySelectorAll('track'));
    nodes.forEach(n=>n.addEventListener('load',apply));apply();
    const timer=setInterval(apply,2500);
    return()=>{clearInterval(timer);nodes.forEach(n=>n.removeEventListener('load',apply));};
  },[subtitleOffset,videoSrc,subtitleFiles,localSubtitle]);
  const castToDevice=useCallback(async()=>{
    const v=videoRef.current;
    try {
      if(v?.remote?.prompt)await v.remote.prompt();
      else if(v?.webkitShowPlaybackTargetPicker)v.webkitShowPlaybackTargetPicker();
      else notify(t('Casting is not supported by this browser.'));
    }catch(e){notify(e?.message||t('No compatible receiver was found.'));}
  },[notify,t]);
  useEffect(()=>{
    if(!('mediaSession' in navigator))return;
    try{navigator.mediaSession.metadata=new MediaMetadata({title:spec.title||'StreamHub',artist:'StreamHub'});}catch{}
  },[spec.title]);
  useEffect(()=>{
    if(hoverPct===null||!stream?.hash||!durRef.current){setPreviewAt(null);return;}
    const at=Math.floor((hoverPct*durRef.current)/30)*30;
    const timer=setTimeout(()=>{setPreviewError(false);setPreviewAt(at);},220);
    return()=>clearTimeout(timer);
  },[hoverPct,stream?.hash,duration]);

  // ---------------------------------------------------------------------
  // Progress reporting
  // ---------------------------------------------------------------------

  const reportNow = useCallback((beacon = false) => {
    const { t, d } = lastPos.current;
    if (!canReport.current || !(d > 0) || !metaRef.current.contentKey) return;
    const body = {
      ...metaRef.current,
      positionSeconds: t,
      durationSeconds: d,
      hash: streamRef.current?.hash,
      profileId: getProfileId(),
    };
    if (beacon) sendBeaconJson('/api/progress', body);
    else api('/api/progress', { method: 'POST', body }).catch(() => {});
    // Cross-device presence is scoped to the active profile and expires after 5 minutes.
    const presence={deviceId:localDeviceId(),deviceName:localDeviceName(),contentKey:metaRef.current.contentKey,
      mediaType:metaRef.current.mediaType,tmdbId:metaRef.current.tmdbId,season:metaRef.current.season,
      episode:metaRef.current.episode,title:metaRef.current.title,positionSeconds:t,durationSeconds:d,profileId:getProfileId()};
    if(beacon)sendBeaconJson('/api/playback/presence',presence);
    else api('/api/playback/presence',{method:'POST',body:presence}).catch(()=>{});
  }, []);

  // Download the very file that is playing (it is already registered, so this starts at once).
  const downloadCurrent = useCallback(() => {
    const st = streamRef.current;
    if (!st) return;
    const a = document.createElement('a');
    a.href = `${BASE}/api/download?hash=${st.hash}&index=${st.fileIndex}&name=${encodeURIComponent(st.fileName)}`;
    a.download = st.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    notify(`Downloading ${st.fileName} (${st.fileSize})`);
  }, [notify]);

  const saveCurrentToServer=useCallback(async()=>{
    const data=streamRef.current;
    if(!data?.hash||!data?.fileIndex)return;
    setSaveBusy(true);
    try{
      await api('/api/downloads/queue',{method:'POST',body:{hash:data.hash,index:data.fileIndex,
        contentKey:data.contentKey,mediaType:spec.type,tmdbId:spec.tmdbId||null,season:spec.season,episode:spec.episode,title:spec.title||data.fileName}});
      notify(t('Added to the server download queue.'));
    }catch(e){notify(e.message);}finally{setSaveBusy(false);}
  },[spec,notify,t]);

  // Another device can explicitly take over this active viewing session.
  useEffect(()=>{
    if(phase!=='ready')return;
    const check=()=>api(`/api/playback/commands?deviceId=${encodeURIComponent(localDeviceId())}`)
      .then(d=>{if(d.targetDevice){videoRef.current?.pause();reportNow();notify(t('Playback moved to another device.'));onClose();}})
      .catch(()=>{});
    const timer=setInterval(check,6000);
    return()=>clearInterval(timer);
  },[phase,reportNow,notify,t,onClose]);

  useEffect(() => {
    if (!nowPlaying) return undefined;
    const t = setTimeout(() => setNowPlaying(null), 7000);
    return () => clearTimeout(t);
  }, [nowPlaying]);

  const finish = useCallback(() => {
    reportNow();
    onClose();
  }, [reportNow, onClose]);

  useEffect(() => {
    const onHide = () => reportNow(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      reportNow();
    };
  }, [reportNow]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => reportNow(), 10000);
    return () => clearInterval(t);
  }, [playing, reportNow]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${spec.title} \u2013 StreamHub`;
    return () => {
      document.title = prev;
    };
  }, [spec.title]);

  // ---------------------------------------------------------------------
  // Find a source and register it with TorrServer
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    canReport.current = false;
    resumedRef.current = false;
    seekingRef.current = false;
    playedRef.current = false;
    lastAdvanceRef.current = Date.now();
    lastAbsRef.current = 0;
    softRetryRef.current = 0;
    currentLinkRef.current = null;
    for (const a of attemptsRef.current) if (a.status === 'playing') a.status = 'switched';
    setAttempts(attemptsRef.current.map((x) => ({ ...x })));

    (async () => {
      setPhase('resolving');
      setStream(null);
      streamRef.current = null;
      setErrorText('');
      setBuffering(true);
      setPickerOpen(false);
      setFixOn(false);
      setConvertOn(false);
      setConvertOffset(0);
      setFixOffset(0);
      setNoAudioHint(false);
      const failures = failedRef.current.size;
      setMessage(
        failures
          ? `That source would not play \u2014 trying another (${failures + 1})\u2026`
          : forced
            ? 'Connecting to peers…'
            : spec.magnet
              ? 'Resuming…'
              : 'Finding the best source…'
      );

      resumeAtRef.current = 0;
      if (!spec.startOver && contentKey) {
        try {
          const p = await api(`/api/progress/get?contentKey=${encodeURIComponent(contentKey)}`);
          if (cancelled) return;
          resumeAtRef.current = Math.max(Number(spec.resumeAt)||0,p.positionSeconds||0);
        } catch {
          /* start from the beginning */
        }
      }

      if(spec.localMediaId){
        const data={localMediaId:spec.localMediaId,streamUrl:`${BASE}/api/local-media/stream/${encodeURIComponent(spec.localMediaId)}`,
          contentKey,fileName:spec.title||'Local video',magnet:null,fileIndex:null,hash:null};
        metaRef.current={contentKey,mediaType:'raw',tmdbId:null,season:spec.season,episode:spec.episode,
          title:spec.title,subtitle:null,year:null,poster:null,backdrop:null,
          magnet:null,sizeLabel:null,indexer:'Local media'};
        streamRef.current=data;setStream(data);setSubtitleFiles([]);setPhase('ready');setMessage('Buffering local video…');
        return;
      }

      if(spec.localId){
        const data={localId:spec.localId,streamUrl:`${BASE}/api/library/stream/${encodeURIComponent(spec.localId)}`,
          contentKey,fileName:spec.fileName||'Saved video',magnet:null,fileIndex:null,hash:null};
        metaRef.current={contentKey,mediaType:spec.type,tmdbId:spec.tmdbId,season:spec.season,episode:spec.episode,
          title:spec.title,subtitle:spec.episodeTitle||null,year:spec.year,poster:spec.poster,backdrop:spec.backdrop,
          magnet:null,sizeLabel:null,indexer:'Local library'};
        streamRef.current=data;
        setStream(data);setSubtitleFiles([]);setPhase('ready');setMessage('Buffering saved video…');
        return;
      }

      let lastError = null;
      const connect = async (list) => {
        for (let i = 0; i < list.length; i++) {
          if (cancelled) return null;
          if (i > 0) setMessage('That source did not respond \u2014 trying another\u2026');
          const cand = list[i];
          const c = cand.src || {};
          markAttempt(cand.link, {
            status: 'trying',
            reason: '',
            title: cand.saved ? 'Source from your last viewing' : c.title,
            quality: c.quality,
            audio: c.audio,
            lang: c.lang,
            langMatch: c.langMatch,
            langAssumed: c.langAssumed,
            size: c.size || (cand.saved ? spec.sizeLabel : undefined),
            seeders: c.seeders,
            indexer: c.indexer,
          });
          try {
            const data = await api('/api/stream', {
              method: 'POST',
              body: { link: cand.link, season: spec.season, episode: spec.episode, contentKey },
              signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
            });
            if (cancelled) return null;
            const rel = data.release || {};
            if (cand.saved) markAttempt(cand.link, { title: data.torrentName }); // replace the placeholder
            markAttempt(
              cand.link,
              { title: data.torrentName, quality: rel.quality, audio: rel.audio, lang: rel.lang, langAssumed: rel.langAssumed, size: data.fileSize },
              { fill: true }
            );
            return { data, src: cand.src, link: cand.link };
          } catch (e) {
            lastError = e;
            markAttempt(cand.link, { status: 'failed', reason: String(e.message || '').replace(/\s+/g, ' ').slice(0, 110) });
            if (e.code === 'AUTH') return null;
          }
        }
        return null;
      };

      const first = [];
      if (forced) first.push({ link: forced.link, src: forced });
      else if (spec.magnet && !failedRef.current.has(spec.magnet)) first.push({ link: spec.magnet, src: { indexer: spec.indexer }, saved: true });

      let result = await connect(first);

      if (!result && !cancelled && !forced && spec.type !== 'raw') {
        setMessage('Finding the best source…');
        try {
          const params = new URLSearchParams({ type: spec.type, title: spec.title });
          if (spec.year) params.set('year', spec.year);
          if (spec.tmdbId) params.set('tmdbId', spec.tmdbId);
          if (spec.season != null) {
            params.set('season', spec.season);
            params.set('episode', spec.episode);
          }
          const found = await api(`/api/sources?${params}`);
          const results = getRankedSources(found.results, contentKey);
          if (!cancelled) setSearched({ results: found.results, skipped: found.skipped || [], lang: found.lang });
          const list = results
            .filter((r) => r.seeders > 0 && r.link !== spec.magnet && !failedRef.current.has(r.link))
            .slice(0, MAX_AUTO_SOURCES)
            .map((r) => ({ link: r.link, src: r }));
          if (!list.length && !lastError) {
            const n = failedRef.current.size;
            lastError = new Error(
              n
                ? `I tried ${n} source${n > 1 ? 's' : ''} and none of them would play. Open Sources to pick one yourself, or try again later.`
                : 'No sources were found for this title on your indexers.'
            );
          }
          if (list.length) {
            setMessage('Connecting to peers…');
            result = await connect(list);
          }
        } catch (e) {
          lastError = e;
        }
      }

      if (cancelled) return;
      if (!result) {
        setPhase('error');
        setErrorText(lastError?.message || 'Playback could not be started.');
        return;
      }

      const { data, src } = result;
      currentLinkRef.current = result.link;
      if (!contentKey) {
        try {
          const p = await api(`/api/progress/get?contentKey=${encodeURIComponent(data.contentKey)}`);
          if (cancelled) return;
          resumeAtRef.current = p.positionSeconds || 0;
        } catch {
          /* ignore */
        }
      }

      // Audio fix: only probed when it was asked for, or when the viewer chose "use it whenever needed".
      let info = null;
      let useFix = false;
      const explicit = fixExplicitRef.current;
      // A release already marked AAC/Opus/MP3 should play directly even when
      // auto-fix is enabled; avoid an expensive ffprobe on every safe source.
      const advertisedAudio = src?.audio || data.release?.audio;
      const safeAdvertisedAudio = ['AAC', 'Opus', 'MP3'].includes(advertisedAudio);
      if (explicit || (autoFixPref() && !safeAdvertisedAudio)) {
        try {
          setMessage('Preparing audio fix…');
          info = await api(`/api/audiofix/probe?hash=${data.hash}&index=${data.fileIndex}`);
          if (cancelled) return;
          useFix = info.canFix && (explicit || info.needsFix);
          if (explicit && !info.canFix) notify(info.reason);
        } catch (e) {
          if (cancelled) return;
          if (explicit) notify(`Audio fix unavailable: ${e.message}`);
        }
      }

      metaRef.current = {
        contentKey: data.contentKey,
        mediaType: spec.type,
        tmdbId: spec.tmdbId,
        season: spec.season,
        episode: spec.episode,
        title: spec.title,
        subtitle: spec.type === 'tv' ? spec.episodeTitle || null : null,
        year: spec.year,
        poster: spec.poster,
        backdrop: spec.backdrop,
        magnet: data.magnet,
        sizeLabel: data.fileSize,
        indexer: src?.indexer || spec.indexer || null,
      };
      streamRef.current = data;
      setFixInfo(info);
      setFixTrack(info?.defaultTrack ?? 0);
      if (useFix) {
        // the stream itself starts at the resume point, so no in-video seek is needed
        resumedRef.current = true;
        setFixOffset(Math.floor(resumeAtRef.current));
        if (info.duration) setDuration(info.duration);
      }
      fixOnRef.current = useFix;
      setFixOn(useFix);
      setSubtitleFiles([]);
      setLocalSubtitle(null);
      setStream(data);
      setMessage('Buffering…');
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, forced]);

  // Apply the current profile's caption choice to loaded text tracks. Browsers
  // do not consistently honor a changing <track default> after the first load.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const apply = () => {
      const files = video.textTracks;
      const want = profile?.subLang;
      let chosen = false;
      for (let i = 0; i < files.length; i++) {
        const track = files[i];
        const match = want !== 'off' && (localSubtitle ? i === files.length - 1 : (track.language === want && !chosen));
        track.mode = match ? 'showing' : 'disabled';
        if (match) chosen = true;
      }
    };
    apply();
    video.addEventListener('loadedmetadata', apply);
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [subtitleFiles, localSubtitle, profile?.subLang, videoSrc]);

  // Sidecar subtitles for torrents; embedded text tracks for local and saved files.
  useEffect(() => {
    let endpoint=null;
    if(stream?.localMediaId)endpoint=`/api/subtitles/embedded/media/${encodeURIComponent(stream.localMediaId)}`;
    else if(stream?.localId)endpoint=`/api/subtitles/embedded/library/${encodeURIComponent(stream.localId)}`;
    else if(stream?.hash && stream?.fileIndex)endpoint=`/api/subtitles?hash=${stream.hash}&index=${stream.fileIndex}`;
    if(!endpoint)return undefined;
    let alive=true;
    api(endpoint).then(d=>{if(alive)setSubtitleFiles((d.subtitles||[]).map(f=>({
      ...f,embedded:Boolean(stream?.localMediaId||stream?.localId)})));})
      .catch(()=>{if(alive)setSubtitleFiles([]);});
    return ()=>{alive=false;};
  }, [stream?.hash,stream?.fileIndex,stream?.localMediaId,stream?.localId]);

  useEffect(() => () => { if (subtitleUrl.current) URL.revokeObjectURL(subtitleUrl.current); }, []);
  const loadCustomSubtitle = (file) => {
    if (!file || !/\.(vtt|srt)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      notify('Please choose an SRT/VTT file under 5 MB.'); return;
    }
    file.text().then(text => {
      const vtt = /^WEBVTT/.test(text.trimStart()) ? text : `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')}`;
      if (subtitleUrl.current) URL.revokeObjectURL(subtitleUrl.current);
      subtitleUrl.current = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      setLocalSubtitle({name: file.name, url: subtitleUrl.current});
      if (profile?.subLang === 'off') setSubLang('en');
      setSubMenuOpen(false);
    }).catch(() => notify('Could not read subtitle file.'));
  };

  // The current source connected but cannot be watched (decode error, or no picture ever arrived).
  // Unless the viewer picked it themselves, remember that and move on to the next-best source.
  const failCurrent = useCallback(
    (reason) => {
      const link = currentLinkRef.current;
      if (!link || playedRef.current || forcedRef.current || fixOnRef.current) return false;
      if (failedRef.current.size >= MAX_FALLBACKS) return false;
      failedRef.current.add(link);
      markAttempt(link, { status: 'failed', reason });
      setAttempt((n) => n + 1);
      return true;
    },
    [markAttempt]
  );

  useEffect(() => {
    if (phase !== 'ready' || !videoSrc) return undefined;
    const t = setTimeout(() => {
      if (!playedRef.current) failCurrent('No picture arrived within 45 seconds');
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, videoSrc, failCurrent]);

  // Self-healing: retry a silent stream once before switching automatic sources.
  // Preserve the exact viewing timestamp; manual choices never silently switch.
  useEffect(() => {
    if (phase !== 'ready' || !videoSrc) return undefined;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.readyState || !canReport.current) return;
      const now = Date.now();
      const outcome = decideStall({now,lastProgress:lastAdvanceRef.current,softAt:softRetryRef.current,
        paused:v.paused,seeking:v.seeking,forced:!!forcedRef.current,local:!!streamRef.current?.localId,
        failures:failedRef.current.size,maxFailures:MAX_FALLBACKS});
      if (outcome === 'none') return;
      const at=baseRef.current+v.currentTime;
      resumeAtRef.current=at;
      lastPos.current={t:at,d:durRef.current};
      if (outcome === 'retry') {
        softRetryRef.current=now;
        setBuffering(true);
        setMessage('Playback stalled — reconnecting…');
        if (fixOnRef.current || convertRef.current) {
          if(convertRef.current) setConvertOffset(Math.floor(at));
          else setFixOffset(Math.floor(at));
        } else {
          resumedRef.current=false;
          v.load();
        }
      } else if (outcome === 'switch' && currentLinkRef.current) {
        failedRef.current.add(currentLinkRef.current);
        markAttempt(currentLinkRef.current,{status:'failed',reason:'Playback stalled after reconnect'});
        reportNow();
        setAttempt(n=>n+1);
      } else if (outcome === 'notify') {
        setPhase('error');
        setErrorText('Playback stalled. Retry this source or choose another in Sources.');
      }
    },4000);
    return()=>clearInterval(id);
  },[phase,videoSrc,markAttempt,reportNow]);

  // Peer / speed readout (also tells the server this stream is still in use).
  useEffect(() => {
    if (phase !== 'ready' || !stream?.hash) return undefined;
    let alive = true;
    const poll = () =>
      api(`/api/stats/${stream.hash}`)
        .then((s) => alive && setStats(s))
        .catch(() => {});
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [phase, stream?.hash]);

  // What comes after this episode?
  useEffect(() => {
    setNextEp(null);
    setNextDismissed(false);
    setCountdown(null);
    if (phase !== 'ready' || spec.type !== 'tv' || !spec.tmdbId) return undefined;
    let alive = true;
    api(`/api/title/tv/${spec.tmdbId}/next?season=${spec.season}&episode=${spec.episode}`)
      .then((d) => alive && setNextEp(d.next))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phase, spec.type, spec.tmdbId, spec.season, spec.episode]);

  // Room chat is read only after joining; the server authorizes each request.
  useEffect(()=>{
    if(!partyCode)return undefined;
    let alive=true;
    const poll=()=>api(`/api/community/parties/${partyCode}/chat`)
      .then(d=>{if(alive)setPartyMessages(d.messages||[]);}).catch(()=>{});
    poll();const timer=setInterval(poll,3500);
    return ()=>{alive=false;clearInterval(timer);};
  },[partyCode]);
  const sendPartyMessage=async event=>{
    event.preventDefault();
    const message=partyDraft.trim();if(!message||partySending||!partyCode)return;
    setPartySending(true);
    try {await api(`/api/community/parties/${partyCode}/chat`,{method:'POST',body:{message}});
      setPartyDraft('');
      const d=await api(`/api/community/parties/${partyCode}/chat`);
      setPartyMessages(d.messages||[]);
    } catch(e){notify(e.message);}finally{setPartySending(false);}
  };

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------

  const poke = useCallback(() => {
    setShowControls(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !menuOpenRef.current) {
        setShowControls(false);
        setRateMenu(false);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const evs = ['mousemove', 'pointerdown', 'touchstart'];
    evs.forEach((e) => el.addEventListener(e, poke, { passive: true }));
    return () => {
      evs.forEach((e) => el.removeEventListener(e, poke));
      clearTimeout(idleTimer.current);
    };
  }, [poke]);

  useEffect(() => {
    if (playing) poke();
    else setShowControls(true);
  }, [playing, poke]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Jump to an absolute position (seconds). In audio-fix mode a jump outside what has already been
  // received restarts the converted stream at that point.
  const seekTo = useCallback((target) => {
    const v = videoRef.current;
    if (!v) return;
    const total = durRef.current || Infinity;
    const t = Math.max(0, Math.min(total - 1, target));
    if (!fixOnRef.current && !convertRef.current) {
      v.currentTime = t;
      return;
    }
    const rel = t - baseRef.current;
    const b = v.buffered;
    let inBuffer = false;
    for (let i = 0; i < b.length; i++) if (rel >= b.start(i) - 0.1 && rel <= b.end(i) - 1) inBuffer = true;
    if (inBuffer) {
      v.currentTime = rel;
    } else {
      setBuffering(true);
      setTime(t);
      lastPos.current = { t, d: durRef.current };
      if(convertRef.current)setConvertOffset(Math.floor(t));
      else setFixOffset(Math.floor(t));
    }
  }, []);

  // Watch parties synchronize time and pause/play state, not media URLs or
  // authentication. Every participant resolves and streams their own source.
  useEffect(()=>{
    if(!partyCode||phase!=='ready')return undefined;
    let active=true;
    const pulse=async()=>{
      const v=videoRef.current;
      if(!v||!active)return;
      try{
        if(partyHost){
          const d=await api(`/api/community/parties/${partyCode}`,{method:'PUT',body:{
            positionSeconds:Math.max(0,baseRef.current+v.currentTime),playing:!v.paused&&!v.ended}});
          if(active)setPartyViewers(d.party.viewers);
        }else{
          const d=await api(`/api/community/parties/${partyCode}`);
          const room=d.party;
          if(!active)return;
          setPartyViewers(room.viewers);
          const fresh=Date.now()-room.updatedAt<30000;
          const position=room.positionSeconds+(room.playing&&fresh?Math.max(0,(Date.now()-room.updatedAt)/1000):0);
          if(fresh){
            const actual=baseRef.current+v.currentTime;
            if(Math.abs(actual-position)>4 && !v.seeking)seekTo(position);
            if(room.playing&&v.paused&&!v.ended)v.play().catch(()=>{});
            if(!room.playing&&!v.paused)v.pause();
          }
        }
      }catch(e){if(active&&[403,404].includes(e.status)){setPartyCode(null);notify(t('Watch party ended or expired.'));}}
    };
    pulse();const id=setInterval(pulse,3000);
    return()=>{active=false;clearInterval(id);};
  },[partyCode,partyHost,phase,seekTo,notify,t]);

  useEffect(()=>()=>{
    if(partyCode)api(`/api/community/parties/${partyCode}`,{method:'DELETE'}).catch(()=>{});
  },[partyCode]);

  const seekBy = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v) return;
      seekTo(baseRef.current + v.currentTime + delta);
    },
    [seekTo]
  );

  const applyVolume = useCallback((val) => {
    const x = Math.min(1, Math.max(0, val));
    setVolume(x);
    setMuted(x === 0);
    try {
      localStorage.setItem('sh_volume', String(x));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (m && volume === 0) setVolume(0.6);
      return !m;
    });
  }, [volume]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted, videoSrc]);

  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else videoRef.current?.webkitEnterFullscreen?.(); // iOS Safari
  }, []);

  useEffect(() => {
    const on = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // ---------------------------------------------------------------------
  // Audio fix controls
  // ---------------------------------------------------------------------

  const currentAbs = () => {
    const v = videoRef.current;
    return v ? baseRef.current + v.currentTime : lastPos.current.t;
  };

  const toggleFix = useCallback(async () => {
    const s = streamRef.current;
    if (fixBusy || !s || convertRef.current || s.localId) return;
    const at = currentAbs();

    if (fixOnRef.current) {
      // back to the original file, continuing from the same moment
      fixExplicitRef.current = false;
      setAutoFixPref(false);
      resumeAtRef.current = at;
      resumedRef.current = false;
      seekingRef.current = false;
      setBuffering(true);
      setFixOn(false);
      setConvertOn(false);
      setConvertOffset(0);
      setFixOffset(0);
      return;
    }

    setFixBusy(true);
    try {
      const info = fixInfo || (await api(`/api/audiofix/probe?hash=${s.hash}&index=${s.fileIndex}`));
      setFixInfo(info);
      if (!info.canFix) {
        notify(info.reason);
        return;
      }
      fixExplicitRef.current = true;
      setAutoFixPref(true);
      setNoAudioHint(false);
      setFixTrack(info.defaultTrack ?? 0);
      if (info.duration) setDuration(info.duration);
      setBuffering(true);
      setFixOffset(Math.floor(at));
      setFixOn(true);
    } catch (e) {
      notify(`Audio fix unavailable: ${e.message}`);
    } finally {
      setFixBusy(false);
    }
  }, [fixBusy, fixInfo, notify]);

  const toggleConvert=useCallback(()=>{
    const s=streamRef.current;
    if(!s)return;
    const at=currentAbs();
    if(convertRef.current){
      resumeAtRef.current=at;resumedRef.current=false;
      setConvertOn(false);setConvertOffset(0);
    } else {
      setFixOn(false);setFixOffset(0);
      setNoAudioHint(false);
      setConvertOffset(Math.floor(at));
      resumedRef.current=true;
      setConvertOn(true);setPhase('ready');
    }
    setBuffering(true);
  },[]);

  const changeTrack = (ord) => {
    setAudioMenu(false);
    if (ord === fixTrack) return;
    const at = currentAbs();
    setBuffering(true);
    setFixOffset(Math.floor(at));
    setFixTrack(ord);
  };

  // Best-effort "this file has no playable sound" detection (Firefox / Chromium expose it).
  useEffect(() => {
    if (fixOn || !playing || noAudioHint || hintDismissedRef.current) return undefined;
    let n = 0;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      n += 1;
      const firefoxSilent = v.mozHasAudio === false && v.currentTime > 1.5;
      const chromeSilent =
        typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && !v.muted && v.volume > 0 && v.currentTime > 3;
      if (firefoxSilent || chromeSilent) {
        setNoAudioHint(true);
        clearInterval(t);
      } else if (n > 8) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [fixOn, playing, noAudioHint, videoSrc]);

  useEffect(() => {
    const onKey = (e) => {
      const tvMode=Boolean(document.querySelector('.tv-mode'));
      if(e.target?.matches?.('input,textarea,select'))return;
      if(tvMode && e.key.startsWith('Arrow')){
        const root=wrapRef.current;
        const candidates=[...(root?.querySelectorAll('button:not([disabled])')||[])].filter(el=>{
          const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&getComputedStyle(el).opacity!=='0';
        });
        const active=document.activeElement;
        if(!root?.contains(active) || !candidates.includes(active)){
          if(e.key==='ArrowDown' && candidates.length){e.preventDefault();poke();(candidates.find(el=>el.getAttribute('aria-label')==='Pause') || candidates.at(-1))?.focus();return;}
        }else{
          const dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];
          const others=candidates.filter(el=>el!==active);
          const next=nearestInDirection(active.getBoundingClientRect(),others.map(el=>el.getBoundingClientRect()),dir);
          if(next>=0){e.preventDefault();poke();others[next].focus();return;}
        }
      }
      if(tvMode && (e.key==='Enter' || e.key==='OK') && !e.target?.closest?.('button,[role="button"]')){e.preventDefault();toggle();return;}
      if (pickerOpen && e.key === 'Escape') {
        setPickerOpen(false);
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          applyVolume(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          applyVolume(volume - 0.1);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFs();
          break;
        case 'Backspace':
        case 'BrowserBack':
          finish();break;
        case 'Escape':
          if (skipMenu) setSkipMenu(false);
          else if (audioMenu) setAudioMenu(false);
          else if (!document.fullscreenElement) finish();
          break;
        default:
          return;
      }
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, audioMenu, skipMenu, toggle, seekBy, applyVolume, volume, toggleMute, toggleFs, finish, poke]);

  // ---------------------------------------------------------------------
  // <video> events
  // ---------------------------------------------------------------------

  const onLoadedMetadata = (e) => {
    const v = e.currentTarget;
    if (!fixOnRef.current && !convertRef.current) setDuration(v.duration);
    const r = resumeAtRef.current;
    if (!resumedRef.current && !fixOnRef.current && !convertRef.current && r > 10 && Number.isFinite(v.duration) && r < v.duration - 15) {
      seekingRef.current = true;
      v.currentTime = r;
    }
    resumedRef.current = true;
    v.playbackRate = rate;
    v.play().catch(() => setBuffering(false));
  };

  const onTimeUpdate = (e) => {
    const v = e.currentTarget;
    const base = baseRef.current;
    const abs = base + v.currentTime;
    if (abs > lastAbsRef.current + 0.2 || abs < lastAbsRef.current - 1) {
      lastAdvanceRef.current = Date.now();
      if (abs > lastAbsRef.current + 0.2) softRetryRef.current = 0;
    }
    lastAbsRef.current = abs;
    setTime(abs);
    const d = (fixOnRef.current || convertRef.current) ? durRef.current : Number.isFinite(v.duration) ? v.duration : 0;
    lastPos.current = { t: abs, d };
    const b = v.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.5 && b.end(i) > end) end = b.end(i);
    }
    setBufferedEnd(base + end);
  };

  const onEnded = () => {
    const { t, d } = lastPos.current;
    if ((fixOnRef.current || convertRef.current) && d && t < d - 45) {
      setPhase('error');
      setErrorText('The converted stream stopped early. Try again.');
      return;
    }
    lastPos.current = { t: d, d };
    reportNow();
    if (nextEp) setCountdown(8);
    else setTimeout(() => onClose(), 700);
  };

  const onVideoError = () => {
    if (failCurrent('Your browser could not decode this file')) return; // moved on to the next source
    const code = videoRef.current?.error?.code;
    if (currentLinkRef.current && !playedRef.current) markAttempt(currentLinkRef.current, { status: 'failed', reason: 'Your browser could not decode this file' });
    setPhase('error');
    setErrorText(
      code === 3 || code === 4
        ? 'Your browser could not play this file \u2014 its video or audio format (for example HEVC video) is not supported. Try the audio fix, or choose another source.'
        : 'The stream was interrupted. Try again, or pick another source.'
    );
  };

  // ---------------------------------------------------------------------
  // Next episode
  // ---------------------------------------------------------------------

  const goNext = useCallback(() => {
    if (!nextEp) return;
    reportNow();
    onNext(nextEp);
  }, [nextEp, onNext, reportNow]);

  useEffect(() => {
    if (countdown === null) return undefined;
    const t = setTimeout(() => {
      if (countdown <= 1) goNext();
      else setCountdown(countdown - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown, goNext]);

  // ---------------------------------------------------------------------
  // Seek bar
  // ---------------------------------------------------------------------

  const pctFromEvent = (e) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const onBarDown = (e) => {
    if (!durRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pctFromEvent(e);
    scrubRef.current = p;
    setScrub(p);
  };
  const onBarMove = (e) => {
    const p = pctFromEvent(e);
    setHoverPct(p);
    if (scrubRef.current !== null) {
      scrubRef.current = p;
      setScrub(p);
    }
  };
  const onBarUp = () => {
    if (scrubRef.current === null) return;
    if (durRef.current) seekTo(scrubRef.current * durRef.current);
    scrubRef.current = null;
    setScrub(null);
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const safeDuration = durRef.current;
  const shownTime = scrub !== null ? scrub * safeDuration : time;
  const pct = safeDuration ? (shownTime / safeDuration) * 100 : 0;
  const bufPct = safeDuration ? (bufferedEnd / safeDuration) * 100 : 0;
  const remaining = safeDuration ? Math.max(0, safeDuration - shownTime) : 0;

  const controlsVisible = showControls || phase !== 'ready' || !playing;
  const hideCursor = phase === 'ready' && playing && !showControls;
  const nearEnd = nextEp && safeDuration > 0 && safeDuration - time <= 25 && !nextDismissed;
  const showNextCard = phase === 'ready' && !pickerOpen && (countdown !== null || nearEnd);
  const tracks = fixInfo?.tracks || [];
  const activeTrack = tracks.find((t) => t.ord === fixTrack) || tracks[0];

  const playingAttempt = attempts.find((a) => a.status === 'playing');
  const nowAttempt = nowPlaying ? attempts.find((a) => a.link === nowPlaying) : null;
  const failedCount = attempts.filter((a) => a.status === 'failed').length;
  const statusOf = (src) => {
    const a = attempts.find((x) => x.link === src.link);
    return a ? { status: a.status, reason: a.reason } : null;
  };

  const heading =
    spec.type === 'tv' ? (
      <>
        <span className="font-bold">{spec.title}</span>
        <span className="ml-3 text-white/80">
          S{spec.season}:E{spec.episode}
          {spec.episodeTitle ? ` \u201c${spec.episodeTitle}\u201d` : ''}
        </span>
      </>
    ) : (
      <span className="font-bold">{spec.title}</span>
    );

  const iconBtn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-150 hover:scale-110 sm:h-11 sm:w-11 [&>svg]:max-h-7 [&>svg]:max-w-7';
  const topBtn = 'flex items-center gap-2 rounded px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/15';

  return (
    <div
      ref={wrapRef}
      className="sh-player fixed inset-0 z-[200] select-none overflow-hidden bg-black text-white"
      style={{ cursor: hideCursor ? 'none' : 'default' }}
    >
        <style>{`.sh-player video::cue { font-size: ${subtitleSize}% !important; }`}</style>
      {partyCode && <div className="absolute left-1/2 top-16 z-[80] flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-lg bg-black/80 px-4 py-2 text-xs shadow-lg sm:text-sm">
        <span>{t('Watch party')}: <strong className="select-text tracking-widest">{partyCode}</strong></span>
        <span>{partyViewers} {t('viewers')}</span>
        <button className="rounded border border-white/40 px-2 py-1 hover:bg-white/15" onClick={()=>navigator.clipboard?.writeText(partyCode).catch(()=>{})}>{t('Copy code')}</button>
        <button className="rounded border border-white/40 px-2 py-1 hover:bg-white/15" onClick={()=>setPartyChatOpen(v=>!v)}>{t('Chat')}</button>
        <button className="rounded border border-white/40 px-2 py-1 hover:bg-white/15" onClick={()=>{
          api(`/api/community/parties/${partyCode}`,{method:'DELETE'}).catch(()=>{});setPartyCode(null);
        }}>{t(partyHost?'End party':'Leave party')}</button>
      </div>}
      {partyCode && partyChatOpen && <aside className="absolute right-3 top-32 z-[90] flex h-[min(55vh,400px)] w-[min(88vw,340px)] flex-col rounded-lg border border-white/20 bg-black/90 p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between"><strong>{t('Watch party chat')}</strong><button className="px-2" aria-label={t('Close')} onClick={()=>setPartyChatOpen(false)}>✕</button></div>
        <div role="log" aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
          {partyMessages.map(msg=><p key={msg.id} className="break-words"><strong className="text-sky-300">{msg.sender}: </strong>{msg.message}</p>)}
        </div>
        <form onSubmit={sendPartyMessage} className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded bg-white/15 px-2 py-2 text-white" maxLength={300} value={partyDraft} onChange={e=>setPartyDraft(e.target.value)} placeholder={t('Message')}/>
          <button className="rounded bg-white px-3 font-semibold text-black" type="submit" disabled={partySending||!partyDraft.trim()}>{t('Send')}</button></form>
      </aside>}
      {videoSrc && phase === 'ready' && (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          autoPlay
          playsInline
          disablePictureInPicture={false}
          className="absolute inset-0 h-full w-full bg-black object-contain"
          onClick={() => (showControls ? toggle() : poke())}
          onDoubleClick={toggleFs}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={(e) => {
            if (!fixOnRef.current && !convertRef.current) setDuration(e.currentTarget.duration);
          }}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPlaying={() => {
            lastAdvanceRef.current=Date.now();
            if (!playedRef.current && currentLinkRef.current) {
              markAttempt(currentLinkRef.current, { status: 'playing', reason: '' });
              setNowPlaying(currentLinkRef.current);
            }
            if (!playedRef.current) rememberSuccessfulSource(contentKey, attemptsRef.current.find(a => a.link === currentLinkRef.current)?.title);
            playedRef.current = true;
            setPlaying(true);
            setBuffering(false);
            if (!seekingRef.current) canReport.current = true;
          }}
          onPause={() => {
            setPlaying(false);
            reportNow();
          }}
          onSeeking={() => setBuffering(true)}
          onSeeked={() => {
            seekingRef.current = false;
            setBuffering(false);
            if (!videoRef.current?.paused) canReport.current = true;
          }}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onEnded={onEnded}
          onError={onVideoError}
        >
          {subtitleFiles.map((f) => (
            <track key={`${stream.localMediaId||stream.localId||stream.hash}:${f.index}`} kind="subtitles"
              label={`${f.lang.toUpperCase()} · ${f.title||f.name||f.codec||'Subtitles'}`} srcLang={f.lang === 'und' ? 'en' : f.lang}
              src={f.embedded ? `${BASE}/api/subtitles/embedded/${stream.localMediaId?'media':'library'}/${stream.localMediaId||stream.localId}?track=${f.index}`
                : `${BASE}/api/subtitles/file?hash=${stream.hash}&index=${f.index}&videoIndex=${stream.fileIndex}`}
              default={profile?.subLang !== 'off' && f.lang === profile?.subLang && subtitleFiles.find(x => x.lang === profile.subLang)?.index === f.index} />
          ))}
          {localSubtitle && <track key={localSubtitle.url} kind="subtitles" label={localSubtitle.name} srcLang="en" src={localSubtitle.url} default />}
        </video>
      )}

      {/* loading / buffering */}
      {(phase === 'resolving' || (phase === 'ready' && buffering)) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 animate-fadeIn">
          <div className="nf-spinner" />
          {phase === 'resolving' && (
            <>
              <p className="max-w-[80%] text-center text-lg text-white/80">{t(message)}</p>
              {attempts.length > 0 && (
                <ul className="w-[min(92vw,560px)] space-y-1.5" aria-label="Sources being tried">
                  {attempts.slice(-5).map((a) => (
                    <li key={a.link} className="flex items-start gap-2 rounded bg-white/[0.06] px-3 py-2 text-left text-xs">
                      <span
                        className={cx(
                          'mt-px w-4 shrink-0 text-center font-bold',
                          a.status === 'failed' ? 'text-red-300' : a.status === 'playing' ? 'text-emerald-300' : 'text-sky-300'
                        )}
                      >
                        {a.status === 'failed' ? '✕' : a.status === 'playing' ? '▶' : '…'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-white/90">{a.title || 'Connecting…'}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-white/50">
                          {a.quality && <span>{a.quality}</span>}
                          <LangChip lang={a.lang} langMatch={a.langMatch} langAssumed={a.langAssumed} />
                          {a.audio && <span>{a.audio}</span>}
                          {a.size && <span>{a.size}</span>}
                          {a.reason && <span className="text-red-300/80">{a.reason}</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {phase === 'ready' && stats && (
            <p className="text-sm text-white/60">
              {fmtSpeed(stats.downloadSpeed)} &middot; {stats.activePeers} <Localized text={"peers connected"} /></p>
          )}
        </div>
      )}

      {/* error */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-6 animate-fadeIn">
          <div className="max-w-[560px] text-center">
            <WarningIcon size={56} className="mx-auto text-nf-red" />
            <h2 className="mt-4 text-2xl font-bold"><Localized text={"We can't play this right now"} /></h2>
            <p className="mt-2 text-[#b3b3b3]">{t(errorText)}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {spec.type !== 'raw' && (
                <button onClick={() => setPickerOpen(true)} className="btn-white">
                  <Localized text={"Choose another source"} /></button>
              )}
              {!fixOn && streamRef.current && (
                <button
                  onClick={() => {
                    fixExplicitRef.current = true;
                    setAttempt((n) => n + 1);
                  }}
                  className="btn-gray"
                >
                  <VolumeIcon size={18} /> <Localized text={"Try audio fix"} /></button>
              )}
              <button onClick={() => setAttempt((n) => n + 1)} className="btn-gray">
                <Localized text={"Try again"} /></button>
              <button onClick={finish} className="btn-gray">
                <Localized text={"Go back"} /></button>
            </div>
          </div>
        </div>
      )}

      {/* top bar */}
      <div
        className={cx(
          'absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/80 to-transparent px-[3%] pb-10 pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-300 sm:gap-2',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <button onClick={finish} aria-label={t("Back to browsing")} className={iconBtn}>
          <BackIcon size={32} />
        </button>
        <div className="flex-1" />

        {fixOn && tracks.length > 1 && (
          <div className="relative">
            <button onClick={() => setAudioMenu((v) => !v)} aria-label={t("Choose audio language")} className={topBtn}>
              <VolumeIcon size={18} />
              <span className="max-w-[160px] truncate">{activeTrack ? langName(activeTrack.lang) || `Track ${activeTrack.ord + 1}` : 'Audio'}</span>
              <ChevronDown size={14} />
            </button>
            {audioMenu && (
              <div className="absolute right-0 top-11 z-10 w-72 animate-dropIn overflow-hidden rounded bg-black/95 py-1 shadow-2xl">
                <p className="px-4 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-white/50"><Localized text={"Audio"} /></p>
                {tracks.map((t) => (
                  <button
                    key={t.ord}
                    onClick={() => changeTrack(t.ord)}
                    className={cx('block w-full px-4 py-2 text-left text-sm hover:bg-white/15', t.ord === fixTrack ? 'font-bold text-white' : 'text-white/70')}
                  >
                    {t.ord === fixTrack ? '\u2713 ' : ''}
                    {trackLabel(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === 'ready' && !convertOn && !stream?.localId && (
          <button
            onClick={toggleFix}
            disabled={fixBusy}
            aria-pressed={fixOn}
            title={t('Keeps the picture exactly as it is and converts the sound to AAC. Use it when a release plays without sound (AC3, E-AC3, DTS, TrueHD). Your choice is remembered.')}
            className={cx(topBtn, fixOn && '!bg-white font-bold !text-black hover:!bg-white/80', fixBusy && 'opacity-60')}
          >
            <VolumeIcon size={18} />
            {t(fixBusy ? 'Preparing…' : fixOn ? 'Audio fix: On' : 'Audio fix')}
          </button>
        )}
        {(phase==='ready' || phase==='error') && streamRef.current && <button onClick={toggleConvert}
          aria-pressed={convertOn} title={t('Compatibility mode: convert video to H.264 and audio to AAC. Only one stream can convert at a time.')}
          className={cx(topBtn,convertOn && '!bg-white !text-black')}>
          {t(convertOn?'Video conversion: On':'Convert video')} ({convertHeight}p)
        </button>}
        {phase==='ready' && streamRef.current && <label className="flex items-center gap-1 text-xs text-white/70">
          <span className="hidden sm:inline">{t('Conversion quality')}</span>
          <select aria-label={t('Conversion quality')} className="rounded bg-black/80 p-2" value={convertHeight}
            onChange={e=>{setConvertHeight(Number(e.target.value));if(convertRef.current)setConvertOffset(Math.floor(currentAbs()));}}>
            <option value={480}>480p</option><option value={720}>720p</option>
          </select></label>}
        {phase==='ready' && stream?.hash && <button disabled={saveBusy} onClick={saveCurrentToServer} className={topBtn}
          title={t('Save this video in the server library')}>{t(saveBusy?'Saving…':'Save on server')}</button>}
        <button onClick={() => setPickerOpen((v) => !v)} aria-pressed={pickerOpen} className={cx(topBtn, pickerOpen && 'bg-white/15')}>
          <ListIcon size={20} /> <Localized text={"Sources"} />{playingAttempt && (
            <span className="hidden items-center gap-1 rounded bg-white/15 px-1.5 py-px text-[11px] font-bold sm:inline-flex">
              {[playingAttempt.quality, playingAttempt.lang].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>
      </div>

      {/* which source is playing — appears briefly, never blocks the picture or the controls */}
      {nowAttempt && phase === 'ready' && !pickerOpen && (
        <div className="pointer-events-none absolute left-[3%] top-24 z-10 w-[min(90vw,440px)] animate-slideLeft rounded-md border border-white/15 bg-black/80 p-3 shadow-2xl backdrop-blur">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/50">
            <Localized text={"Now playing"} />{failedCount > 0 && (
              <span className="font-normal normal-case tracking-normal text-white/60">
                {' '}
                · after {failedCount} source{failedCount > 1 ? 's' : ''} that would not play
              </span>
            )}
          </p>
          <p className="mt-1 break-all text-[13px] font-medium leading-snug">{nowAttempt.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#b3b3b3]">
            {nowAttempt.quality && <span className="rounded bg-white/10 px-1.5 py-px font-bold text-white">{nowAttempt.quality}</span>}
            <LangChip lang={nowAttempt.lang} langMatch={nowAttempt.langMatch} langAssumed={nowAttempt.langAssumed} />
            {nowAttempt.audio && <span>{nowAttempt.audio}</span>}
            {nowAttempt.size && <span>{nowAttempt.size}</span>}
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="pointer-events-auto mt-2 flex items-center gap-1.5 rounded border border-white/40 px-2.5 py-1 text-xs font-bold transition-colors hover:border-white hover:bg-white/10"
          >
            <DownloadIcon size={13} /> <Localized text={"Details & download"} /></button>
        </div>
      )}

      {/* "no sound?" hint */}
      {phase==='error' && streamRef.current && <button onClick={toggleConvert}
        className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded bg-white px-4 py-3 font-bold text-black">{t('Try compatible video (480/720p)')}</button>}

      {noAudioHint && !fixOn && phase === 'ready' && !pickerOpen && (
        <div className="absolute bottom-32 left-1/2 z-10 w-[min(92vw,470px)] -translate-x-1/2 animate-fadeInUp rounded-md border border-white/20 bg-black/90 p-4 shadow-2xl backdrop-blur">
          <p className="font-bold"><Localized text={"No sound?"} /></p>
          <p className="mt-1 text-sm text-white/70">
            <Localized text={"This file's audio format isn't supported by your browser. The audio fix keeps the picture as it is and converts only the sound."} /></p>
          <div className="mt-3 flex gap-2">
            <button onClick={toggleFix} className="btn-white !px-4 !py-1.5 !text-sm">
              <VolumeIcon size={16} /> <Localized text={"Play with audio fix"} /></button>
            <button
              onClick={() => {
                hintDismissedRef.current = true;
                setNoAudioHint(false);
              }}
              className="btn-gray !px-4 !py-1.5 !text-sm"
            >
              <Localized text={"Dismiss"} /></button>
          </div>
        </div>
      )}

      {/* User-saved intro/credits markers (one movie or episode, per profile). */}
      {phase==='ready' && !pickerOpen && skipMarkers.introStart!==null && time>=skipMarkers.introStart-2 && time<skipMarkers.introEnd && (
        <button onClick={()=>seekTo(skipMarkers.introEnd)} className="absolute bottom-32 right-[4%] z-30 rounded border border-white/60 bg-black/80 px-5 py-3 font-semibold backdrop-blur hover:bg-white hover:text-black">{t('Skip Intro')} ›</button>
      )}
      {phase==='ready' && !pickerOpen && skipMarkers.creditsStart!==null && time>=skipMarkers.creditsStart && (
        <button onClick={()=>nextEp?goNext():seekTo(Math.max(0,safeDuration-1))} className="absolute bottom-32 right-[4%] z-30 rounded border border-white/60 bg-black/80 px-5 py-3 font-semibold backdrop-blur hover:bg-white hover:text-black">{t('Skip Credits')} ›</button>
      )}

      {/* bottom controls */}
      {phase === 'ready' && (
        <div
          className={cx(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 transition-opacity duration-300',
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <div className="flex items-center gap-4 px-[3%]">
            <div
              ref={barRef}
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
              onPointerLeave={() => setHoverPct(null)}
              className="group/bar relative flex h-7 flex-1 cursor-pointer touch-none items-center"
            >
              <div className="relative h-[5px] w-full rounded bg-white/30 transition-all duration-150 group-hover/bar:h-[8px]">
                <div className="absolute inset-y-0 left-0 rounded bg-white/35" style={{ width: `${bufPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded bg-nf-red" style={{ width: `${pct}%` }} />
                <div
                  className={cx(
                    'absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-nf-red transition-transform duration-150 group-hover/bar:scale-100',
                    scrub !== null ? 'scale-100' : 'scale-0'
                  )}
                  style={{ left: `${pct}%` }}
                />
              </div>
              {hoverPct !== null && safeDuration > 0 && (
                <div
                  className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/85 px-2 py-1 text-xs tabular-nums"
                  style={{ left: `${hoverPct * 100}%` }}
                >
                  {fmtTime(hoverPct * safeDuration)}
                  {previewAt !== null && !previewError && stream?.hash && <img alt={t('Scene preview')} loading="lazy" draggable={false}
                     src={`${BASE}/api/preview?hash=${encodeURIComponent(stream.hash)}&index=${stream.fileIndex}&at=${previewAt}`}
                     onError={()=>setPreviewError(true)}
                     className="absolute bottom-full left-1/2 mb-1 h-auto w-36 max-w-[35vw] -translate-x-1/2 rounded border border-white/30 bg-black object-contain shadow-xl sm:w-48" />}
                </div>
              )}
            </div>
            <span className="w-[65px] shrink-0 text-right text-base tabular-nums sm:w-[72px] sm:text-xl">{fmtTime(remaining)}</span>
          </div>

          <div className="mt-1 flex items-center justify-between gap-0 px-[2%] sm:gap-2 sm:px-[3%]">
            <button onClick={toggle} aria-label={t(playing ? 'Pause' : 'Play')} className={iconBtn}>
              {playing ? <PauseIcon size={38} /> : <PlayIcon size={38} />}
            </button>
            <button onClick={() => seekBy(-10)} aria-label={t("Back 10 seconds")} className={iconBtn}>
              <Rewind10 size={36} />
            </button>
            <button onClick={() => seekBy(10)} aria-label={t("Forward 10 seconds")} className={iconBtn}>
              <Forward10 size={36} />
            </button>

            <div className="group/vol hidden items-center sm:flex">
              <button onClick={toggleMute} aria-label={t(muted ? 'Unmute' : 'Mute')} className={iconBtn}>
                <VolumeIcon size={34} level={muted || volume === 0 ? 0 : volume < 0.5 ? 1 : 2} />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={muted ? 0 : volume}
                onChange={(e) => applyVolume(parseFloat(e.target.value))}
                aria-label={t("Volume")}
                className="nf-range w-0 opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:ml-1 focus:w-24 focus:opacity-100"
                style={{ '--val': `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>

            <div className="mx-1 hidden min-w-0 flex-1 truncate text-center text-sm sm:mx-3 sm:block sm:text-lg">{heading}</div>

            {nextEp && (
              <button onClick={goNext} aria-label={t("Next episode")} title={`Next: S${nextEp.season}:E${nextEp.episode}`} className={iconBtn}>
                <NextIcon size={34} />
              </button>
            )}

            <div className="relative">
              <button onClick={() => setSubMenuOpen(v => !v)} aria-label={t('Subtitles')} className={iconBtn}>
                <span className="rounded border border-current px-1 text-xs font-bold">CC</span>
              </button>
              {subMenuOpen && (
                <div className="absolute bottom-14 right-0 z-30 max-h-72 w-[min(85vw,260px)] overflow-y-auto rounded border border-white/20 bg-black/95 p-2 text-sm shadow-2xl">
                  <p className="p-2 font-bold">{t('Subtitles')}</p>
                  {['off', 'en', 'es'].map(lang => <button key={lang}
                    onClick={() => { setSubLang(lang); setSubMenuOpen(false); }}
                    className={`block w-full rounded px-3 py-2 text-left hover:bg-white/15 ${profile?.subLang === lang ? 'bg-white/20' : ''}`}>
                    {lang === 'off' ? t('Off') : lang === 'en' ? t('English') : t('Español')}
                  </button>)}
                  <p className="px-2 pt-2 text-xs text-white/50">{subtitleFiles.length ? `${subtitleFiles.length} ${t('Subtitles')}` : t('No captions available for this source.')}</p>
                  <button className="mt-1 block w-full rounded px-3 py-2 text-left hover:bg-white/15" onClick={() => subtitleInput.current?.click()}>{t('Load your own SRT/VTT')}</button>
                  <input ref={subtitleInput} type="file" accept=".srt,.vtt,text/vtt" className="hidden" onChange={e => { loadCustomSubtitle(e.target.files?.[0]); e.target.value=''; }} />
                  <div className="mt-2 border-t border-white/20 pt-2"><p className="px-2 text-xs text-white/60">Subtitle sync: {subtitleOffset>0?'+':''}{subtitleOffset.toFixed(1)}s</p>
                    <div className="mt-1 flex items-center justify-around"><button className="rounded bg-white/15 px-3 py-1" onClick={()=>setSubtitleOffset(v=>Math.max(-20,+(v-0.5).toFixed(1)))}>−0.5s</button><button className="rounded bg-white/15 px-3 py-1" onClick={()=>setSubtitleOffset(0)}>Reset</button><button className="rounded bg-white/15 px-3 py-1" onClick={()=>setSubtitleOffset(v=>Math.min(20,+(v+0.5).toFixed(1)))}>+0.5s</button></div>
                    <p className="mt-2 px-2 text-xs text-white/60">Caption size</p><div className="mt-1 flex gap-2 px-2">{[100,125,150].map(v=><button key={v} onClick={()=>setSubtitleSize(v)} className={`rounded px-2 py-1 text-xs ${subtitleSize===v?'bg-white text-black':'bg-white/15'}`}>{v}%</button>)}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button onClick={() => setRateMenu((v) => !v)} aria-label={t("Playback speed")} className={iconBtn}>
                <SpeedIcon size={34} />
              </button>
              {rateMenu && (
                <div className="absolute bottom-14 right-0 w-36 animate-dropIn overflow-hidden rounded bg-black/95 py-1 shadow-2xl">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setRate(s);
                        if (videoRef.current) videoRef.current.playbackRate = s;
                        setRateMenu(false);
                      }}
                      className={cx('block w-full px-4 py-2 text-left text-sm hover:bg-white/15', rate === s ? 'font-bold text-white' : 'text-white/70')}
                    >
                      {s === 1 ? 'Normal' : `${s}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {supportsMarkers && <div className="relative">
              <button onClick={()=>setSkipMenu(v=>!v)} className="rounded border border-white/40 px-2 py-1 text-xs hover:bg-white/15" aria-label={t('Edit skip markers')}>⏭ <span className="hidden sm:inline">{t('Skip markers')}</span></button>
              {skipMenu && <div className="absolute bottom-14 right-0 z-40 w-60 rounded border border-white/20 bg-[#101010] p-3 text-sm shadow-xl">
                <p className="mb-2 font-semibold">{t('Mark intro and credits')}</p>
                <button className="block w-full rounded px-2 py-2 text-left hover:bg-white/15" onClick={()=>{setDraftIntroStart(Math.floor(time));notify(t('Intro start noted. Mark the end next.'));}}>{t('Mark intro start')} ({fmtTime(time)})</button>
                <button disabled={draftIntroStart===null||time<=draftIntroStart} className="block w-full rounded px-2 py-2 text-left hover:bg-white/15 disabled:opacity-40" onClick={()=>{writeMarkers({...skipMarkers,introStart:draftIntroStart,introEnd:Math.floor(time)});setDraftIntroStart(null);setSkipMenu(false);}}>{t('Mark intro end')} ({fmtTime(time)})</button>
                <button className="block w-full rounded px-2 py-2 text-left hover:bg-white/15" onClick={()=>{writeMarkers({...skipMarkers,creditsStart:Math.floor(time)});setSkipMenu(false);}}>{t('Mark credits start')} ({fmtTime(time)})</button>
                <button className="mt-2 block w-full rounded px-2 py-2 text-left text-red-200 hover:bg-white/15" onClick={()=>{writeMarkers({introStart:null,introEnd:null,creditsStart:null});setSkipMenu(false);}}>{t('Clear skip markers')}</button>
              </div>}
            </div>}
            {phase==='ready' && <button onClick={saveToPhone} disabled={savingOffline} aria-label="Save offline" title="Save offline to this device" className={`${iconBtn} text-xs disabled:opacity-40`}>↓ <span className="hidden lg:inline">Offline</span></button>}
            {(stream?.localId||stream?.localMediaId) && <button onClick={castSavedToChromecast} title="Cast saved MP4/WebM to Chromecast" aria-label="Chromecast" className={`${iconBtn} text-xs`}>Cast</button>}
            {canCast && <button onClick={castToDevice} aria-label={t('Cast / AirPlay')} title={t('Cast / AirPlay')} className={iconBtn}>▣</button>}
            <button onClick={toggleFs} aria-label={t(isFs ? 'Exit full screen' : 'Full screen')} className={iconBtn}>
              {isFs ? <ExitFullscreenIcon size={32} /> : <FullscreenIcon size={32} />}
            </button>
          </div>
        </div>
      )}

      {/* next episode card */}
      {showNextCard && nextEp && (
        <div className="absolute bottom-28 right-[3%] z-10 w-[300px] animate-slideLeft rounded-md border border-white/20 bg-black/85 p-4 shadow-2xl backdrop-blur">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60"><Localized text={"Next Episode"} /></p>
          <p className="mt-1 truncate font-bold">
            S{nextEp.season}:E{nextEp.episode} {nextEp.name ? `\u2013 ${nextEp.name}` : ''}
          </p>
          {countdown !== null && <p className="mt-1 text-sm text-white/70"><Localized text={"Starting in"} suffix=" " />{countdown}&hellip;</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={goNext} className="btn-white !px-4 !py-1.5 !text-sm">
              <PlayIcon size={16} /> <Localized text={"Play now"} /></button>
            <button
              onClick={() => {
                setCountdown(null);
                setNextDismissed(true);
              }}
              className="btn-gray !px-4 !py-1.5 !text-sm"
            >
              <Localized text={"Cancel"} /></button>
          </div>
        </div>
      )}

      {/* sources: a side drawer, so the video keeps playing while it is open */}
      {pickerOpen && (
        <SourcesDrawer
          spec={spec}
          attempts={attempts}
          preloaded={searched}
          statusOf={statusOf}
          onClose={() => setPickerOpen(false)}
          onPick={(source) => {
            setForced(source);
            setAttempt((n) => n + 1);
          }}
          onPickFix={(source) => {
            fixExplicitRef.current = true;
            setForced(source);
            setAttempt((n) => n + 1);
          }}
          onDownload={(source) => download(source, spec)}
          onDownloadCurrent={downloadCurrent}
        />
      )}
    </div>
  );
}
