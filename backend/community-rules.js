// Pure validation shared by community endpoints and their unit tests.
export function invalid(message) { return Object.assign(new Error(message),{status:400}); }
export function titleText(value,max=120) {
  const v=String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
  if(!v||v.length>max)throw invalid(`Title must contain 1–${max} characters.`);
  return v;
}
export function mediaType(type) {
  if(type!=='movie'&&type!=='tv')throw invalid('Choose a movie or TV series.');
  return type;
}
export function positiveId(id,required=true) {
  if((id===null||id===undefined||id==='')&&!required)return null;
  const v=Number(id);
  if(!Number.isSafeInteger(v)||v<1||v>2147483647)throw invalid('Invalid title ID.');
  return v;
}
export function collectionId(id){return positiveId(id);}
export function roomCode(v) {
  const code=String(v||'').trim().toUpperCase();
  if(!/^[A-F0-9]{12}$/.test(code))throw invalid('Invalid watch-party code.');
  return code;
}
export function roomSpec(input) {
  const type=mediaType(input?.type),id=positiveId(input?.tmdbId);
  const season=input?.season==null?null:Number(input.season);
  const episode=input?.episode==null?null:Number(input.episode);
  if(type==='tv'&&(!Number.isInteger(season)||season<0||season>100||!Number.isInteger(episode)||episode<1||episode>1000))
    throw invalid('Choose a valid season and episode for this watch party.');
  return {type,tmdbId:id,title:titleText(input?.title),season:type==='tv'?season:null,episode:type==='tv'?episode:null};
}
export function playbackState(input) {
  const position=Number(input?.positionSeconds);
  if(!Number.isFinite(position)||position<0||position>86400)throw invalid('Invalid playback position.');
  return {positionSeconds:position,playing:input?.playing===true};
}
