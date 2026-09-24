export function municipalityFromGeocode(data) {
  const admins = data?.localityInfo?.administrative;
  const comune = Array.isArray(admins)
    ? admins.find(item => Number(item.adminLevel) === 8 && item.name)
    : null;
  // In Italia una semplice "locality" può essere una frazione: non la spacciamo per comune.
  const name = cleanText(comune?.name || data?.city || (data?.countryCode === 'IT' ? '' : data?.locality));
  const locality = cleanText(data?.locality);
  return name ? {
    name,
    verified: Boolean(comune),
    countryCode: cleanText(data?.countryCode),
    localityCandidate: locality && locality.toLocaleLowerCase('it') !== name.toLocaleLowerCase('it') ? locality : '',
    region: cleanText(data?.principalSubdivision),
    country: cleanText(data?.countryName),
    key: `${cleanText(data?.countryCode).toLowerCase()}|${cleanText(data?.principalSubdivisionCode).toLowerCase()}|${name.toLowerCase()}`
  } : null;
}

export function voiceIntent(spoken) {
  const words = cleanText(spoken).toLocaleLowerCase('it');
  if (/\b(dove (sono|mi trovo)|che comune|nome del comune)\b/.test(words)) return 'where';
  if (/\b(storia|storico|raccontami|racconto|origini)\b/.test(words)) return 'story';
  if (/\b(vedere|visitare|da non perdere|luoghi|attrazioni|punti d.interesse|cosa c.è)\b/.test(words)) return 'see';
  return null;
}

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

const INTERESTING = /castell|rocc|chies|duom|cattedral|muse|palazz|villac|villa\b|abbazi|santuar|monaster|parco|giardin|lago|borgo|teatr|monument|torre|ponte|riserva|piazza|convent|anfiteatr|basilic|eremo|fortezz|cascat/i;

export function rankPlaces(places, municipalityName) {
  const town = cleanText(municipalityName).toLowerCase();
  return (Array.isArray(places) ? places : [])
    .filter(p => p && typeof p.title === 'string' && p.title.trim().toLowerCase() !== town)
    .map(p => ({ ...p, interesting: INTERESTING.test(p.title), dist: Number(p.dist) || 0 }))
    .sort((a, b) => Number(b.interesting) - Number(a.interesting) || a.dist - b.dist)
    .slice(0, 6);
}

export function extractHistory(html) {
  if (typeof DOMParser === 'undefined' || !html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('sup, table, figure, .mw-editsection, .navbox, .metadata, .toc, .reflist, .references, script, style').forEach(node => node.remove());
  const paragraphs = [...doc.body.querySelectorAll('p')]
    .map(node => cleanText(node.textContent).replace(/\s+([.,;:!?])/g, '$1'))
    .filter(text => text.length > 45)
    .slice(0, 3);
  return (paragraphs.length ? paragraphs.join('\n\n') : cleanText(doc.body.textContent)).slice(0, 1100).trim();
}

export function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
