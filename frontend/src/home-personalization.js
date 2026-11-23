// Never suppress an entire TV series because one episode was completed.
export function excludeCompletedMovies(items, completedIds, hideWatched) {
  if (!hideWatched) return items || [];
  const completed=new Set(completedIds||[]);
  return (items||[]).filter(item=>item?.type!=='movie'||!completed.has(item.id));
}
export function uniqueTitles(items) {
  const seen=new Set();
  return (items||[]).filter(item=>{
    if(!item?.id)return false;
    const key=`${item.type}:${item.id}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
