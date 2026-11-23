// Google Cast's default media receiver can play authenticated media only via
// our narrow, time-limited signed stream URL. No cookies reach the receiver.
let loadOnce=null;
function loadSdk(){
  if(loadOnce)return loadOnce;
  loadOnce=new Promise((resolve,reject)=>{
    if(!window.isSecureContext){reject(new Error('Chromecast requires a reachable HTTPS StreamHub address.'));return;}
    if(!('chrome' in window) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent)){
      reject(new Error('Open StreamHub in Chrome or another Cast-enabled browser.'));return;
    }
    const timeout=setTimeout(()=>reject(new Error('Google Cast could not be initialized.')),12000);
    const previous=window.__onGCastApiAvailable;
    window.__onGCastApiAvailable=(available,error)=>{
      if(typeof previous==='function')previous(available,error);
      clearTimeout(timeout);
      if(!available){reject(new Error(error||'Google Cast unavailable.'));return;}
      try{
        const c=window.cast.framework.CastContext.getInstance();
        c.setOptions({receiverApplicationId:window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy:window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED});
        resolve(c);
      }catch(e){reject(e);}
    };
    const script=document.createElement('script');
    script.src='https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';script.async=true;
    script.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not load Google Cast SDK.'));};
    document.head.appendChild(script);
  });
  return loadOnce;
}
export async function castMedia({url,title,mime='video/mp4',position=0}){
  const context=await loadSdk();
  let session=context.getCurrentSession();
  if(!session){await context.requestSession();session=context.getCurrentSession();}
  if(!session)throw new Error('No Chromecast receiver selected.');
  const info=new window.chrome.cast.media.MediaInfo(url,mime);
  info.streamType=window.chrome.cast.media.StreamType.BUFFERED;
  const meta=new window.chrome.cast.media.GenericMediaMetadata();meta.title=title||'StreamHub';info.metadata=meta;
  const request=new window.chrome.cast.media.LoadRequest(info);
  request.currentTime=Math.max(0,Number(position)||0);
  await session.loadMedia(request);
}
