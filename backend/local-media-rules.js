import path from 'node:path';
export function parseMediaName(name) {
  const stem=path.parse(name).name;
  const episode=/[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})/.exec(stem);
  const year=/(?<!\d)(19\d{2}|20\d{2})(?!\d)/.exec(stem)?.[1]||null;
  const prefix=(episode?stem.slice(0,episode.index):year?stem.slice(0,stem.indexOf(year)):stem)
    .replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();
  return {title:(prefix||stem).slice(0,150),type:episode?'tv':'movie',year,
    season:episode?Number(episode[1]):null,episode:episode?Number(episode[2]):null};
}
