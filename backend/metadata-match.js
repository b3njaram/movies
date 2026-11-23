// Conservative title matching. Never silently treat a weak guess as confirmed.
const noise = /\b(?:2160p|1080p|720p|480p|web[ .-]?dl|bluray|brrip|x264|x265|hevc|hdr|dv|aac|dts|h264|h265|proper|repack|extended|remux|multi|dual|subbed|dubbed)\b/gi;
export function canonicalTitle(input) {
  return String(input || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/&/g,' and ').replace(noise,' ')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
export function matchConfidence(local, candidate) {
  if (!local || !candidate || local.type !== candidate.type) return 0;
  const left=canonicalTitle(local.title), right=canonicalTitle(candidate.title);
  if (!left || !right) return 0;
  const a=new Set(left.split(' ')), b=new Set(right.split(' '));
  const overlap=[...a].filter(word=>b.has(word)).length;
  const dice=(2*overlap)/(a.size+b.size);
  const exact=left===right;
  let score=exact?1: dice*0.89;
  const localYear=Number(local.year), candidateYear=Number(candidate.year);
  if (localYear>=1900 && candidateYear>=1900){
    const gap=Math.abs(localYear-candidateYear);
    if(gap>1)return Math.max(0,score-.55);
    if(gap===1)score-=.04;
  } else if(local.type==='movie') score-=.07;
  return Math.min(1,Math.max(0,Number(score.toFixed(3))));
}
export function chooseAutomaticMatch(local, candidates) {
  const ranked=(candidates||[]).filter(c=>c.type===local.type)
    .map(c=>({...c,confidence:matchConfidence(local,c)}))
    .sort((a,b)=>b.confidence-a.confidence);
  const [best,second]=ranked;
  // A weak or ambiguous guess must always wait for a human.
  if (!best || best.confidence < .94 || (second && best.confidence-second.confidence<.13)) return null;
  return best;
}
