// TextTrackCue times are relative to their original source and adjusted
// without accumulating error as the viewer changes the offset.
export function shiftTextTrack(track, seconds, originals=new WeakMap()) {
  if(!Number.isFinite(seconds)||Math.abs(seconds)>20)return 0;
  let changed=0;
  for(const cue of track?.cues||[]){
    let source=originals.get(cue);
    if(!source){source={start:cue.startTime,end:cue.endTime};originals.set(cue,source);}
    try{
      cue.startTime=Math.max(0,source.start+seconds);
      cue.endTime=Math.max(cue.startTime+0.05,source.end+seconds);
      changed++;
    }catch{/* Some native caption tracks do not expose editable cues. */}
  }
  return changed;
}
