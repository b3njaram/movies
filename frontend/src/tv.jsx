import { useEffect } from 'react';
import { nearestInDirection } from './tv-spatial';

export function defaultTvMode() {
  try {const saved=localStorage.getItem('sh_tv_mode');if(saved!==null)return saved==='1';}catch{}
  return /SMART.TV|TIZEN|WEB0S|WEBOS|AFTB|GOOGLE.?TV|ANDROID.?TV/i.test(navigator.userAgent);
}

export function useTvNavigation(enabled) {
  useEffect(()=>{
    if(!enabled)return;
    const selector='button:not([disabled]),a[href],[role="button"][tabindex],input:not([disabled]),select:not([disabled])';
    const focusables=()=>[...(document.querySelector('[role="dialog"][aria-modal="true"]') || document).querySelectorAll(selector)].filter(el=>{
      const r=el.getBoundingClientRect();const st=getComputedStyle(el);
      return r.width>1&&r.height>1&&st.visibility!=='hidden'&&st.display!=='none'&&st.opacity!=='0';
    });
    const onKey=(e)=>{
      if(document.querySelector('.sh-player'))return; // Player has its own remote controls.
      const active=document.activeElement;
      const editable=active?.matches('input,textarea,select,[contenteditable="true"]');
      if(editable)return;
      if(e.key==='Backspace' || e.key==='BrowserBack'){
        e.preventDefault();history.back();return;
      }
      const dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];
      if(!dir || e.altKey || e.ctrlKey || e.metaKey)return;
      const available=focusables();
      if(!available.length)return;
      const current=available.includes(active)?active:available[0];
      const idx=nearestInDirection(current.getBoundingClientRect(),available.filter(el=>el!==current).map(el=>el.getBoundingClientRect()),dir);
      const others=available.filter(el=>el!==current);
      if(idx>=0){e.preventDefault();others[idx].focus({preventScroll:true});others[idx].scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});}
      else if(!available.includes(active)){e.preventDefault();current.focus();}
    };
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[enabled]);
}
