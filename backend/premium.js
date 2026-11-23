// Pure Phase 2 rules. Keep this module independent of Express/SQLite for testing.
export const AGE_CHOICES = [0, 7, 10, 13, 16, 18];

const AGE_BY_RATING = {
  G: 0, PG: 10, 'PG-13': 13, R: 17, 'NC-17': 18, NR: 18,
  'TV-Y': 0, 'TV-Y7': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 14, 'TV-MA': 18,
  U: 0, PG12: 12, '12': 12, '12A': 12, '15': 15, '18': 18,
};
export function ratingAge(certification) {
  const key = String(certification || '').trim().toUpperCase();
  return AGE_BY_RATING[key] ?? null;
}
export function allowedByRating(certification, maxAge) {
  if (Number(maxAge) >= 18) return true;
  const age = ratingAge(certification);
  // Unrated/unknown movies fail closed in restricted profiles.
  return age !== null && age <= Number(maxAge);
}
export function maxAgeValue(value, kids = false) {
  const age = Number(value);
  if (AGE_CHOICES.includes(age)) return kids ? Math.min(age, 13) : age;
  return kids ? 10 : 18;
}
export function safeContentKey(value) {
  const key = String(value || '');
  if (!/^(?:movie:\d+|tv:\d+:s\d+e\d+)$/.test(key) || key.length > 120) {
    throw Object.assign(new Error('Invalid movie or episode identifier.'), { status: 400 });
  }
  return key;
}
export function cleanMarkers(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('Invalid skip markers.'), {status: 400});
  const result = {};
  for (const key of ['introStart', 'introEnd', 'creditsStart']) {
    const raw = input[key];
    if (raw === null || raw === '' || raw === undefined) result[key] = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 12 * 3600) throw Object.assign(new Error('Marker must be a valid video timestamp.'), { status: 400 });
      result[key] = Math.floor(n);
    }
  }
  if ((result.introStart === null) !== (result.introEnd === null)) {
    throw Object.assign(new Error('Set both the intro start and end.'), {status: 400});
  }
  if (result.introStart !== null && result.introEnd <= result.introStart) {
    throw Object.assign(new Error('Intro end must be after intro start.'), {status: 400});
  }
  return result;
}
export const GENRES = [
  ['28','Action'], ['12','Adventure'], ['16','Animation'], ['35','Comedy'], ['80','Crime'], ['99','Documentary'],
  ['18','Drama'], ['10751','Family'], ['14','Fantasy'], ['27','Horror'], ['9648','Mystery'],
  ['10749','Romance'], ['878','Science Fiction'], ['53','Thriller'], ['10762','Kids'],
];
export function cleanDiscoverFilters(input = {}) {
  const type = ['movie','tv'].includes(input.type) ? input.type : 'movie';
  const genre = GENRES.some(([id]) => id === String(input.genre)) ? String(input.genre) : '';
  const year = Number(input.year);
  const minRating = Number(input.minRating);
  return {
    type, genre,
    year: Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear() + 2 ? year : null,
    minRating: Number.isFinite(minRating) ? Math.max(0, Math.min(9, minRating)) : 0,
    sort: ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc'].includes(input.sort)
      ? input.sort : 'popularity.desc',
  };
}
export function selectFavoriteGenre(items) {
  const scores = new Map();
  for (const item of items) {
    for (const id of item.genreIds || []) {
      if (GENRES.some(([g]) => Number(g) === id)) scores.set(id, (scores.get(id) || 0) + 1);
    }
  }
  return [...scores.entries()].sort((a,b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || null;
}
