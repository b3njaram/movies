// Geometry-only spatial navigation: testable without a browser.
export function nearestInDirection(current, targets, direction) {
  const x = current.left + current.width / 2;
  const y = current.top + current.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  const choices = targets.map((r,index)=>{
    const dx = (r.left+r.width/2)-x;
    const dy = (r.top+r.height/2)-y;
    const forward = (horizontal ? dx : dy)*sign;
    const lateral = Math.abs(horizontal?dy:dx);
    // Strong preference for on-axis neighbors; avoid jumping between rows.
    return {index,forward,lateral,score:forward+2.5*lateral};
  }).filter(x=>x.forward>12);
  return choices.sort((a,b)=>a.score-b.score)[0]?.index ?? -1;
}
