import test from 'node:test';
import assert from 'node:assert/strict';
import { municipalityFromGeocode, distanceMeters, rankPlaces, voiceIntent } from '../core.mjs';

test('usa il confine amministrativo del comune quando city indica un centro più grande', () => {
  const place = municipalityFromGeocode({
    city: 'Brescia', locality: 'Camignone', countryCode: 'IT', countryName: 'Italia',
    principalSubdivision: 'Lombardia', principalSubdivisionCode: 'IT-25',
    localityInfo: { administrative: [{ name: 'Italia', adminLevel: 2 }, { name: 'Passirano', adminLevel: 8 }] }
  });
  assert.equal(place.name, 'Passirano');
  assert.equal(place.verified, true);
  assert.equal(place.localityCandidate, 'Camignone');
  assert.equal(place.key, 'it|it-25|passirano');
});

test('la frazione non sostituisce mai il nome del comune', () => {
  const place = municipalityFromGeocode({
    city: 'Ospitaletto', locality: 'Lovernato',
    localityInfo: { administrative: [{ name: 'Ospitaletto', adminLevel: 8 }] }
  });
  assert.equal(place.name, 'Ospitaletto');
  assert.equal(place.localityCandidate, 'Lovernato');
  assert.equal(voiceIntent('Che comune sto attraversando?'), 'where');
  assert.equal(voiceIntent('Raccontami la storia di questo posto'), 'story');
  assert.equal(voiceIntent('Cosa c’è da vedere qui?'), 'see');
});

test('se manca il confine amministrativo usa city e non la frazione', () => {
  assert.equal(municipalityFromGeocode({ city: 'Iseo', locality: 'Clusane' }).name, 'Iseo');
  assert.equal(municipalityFromGeocode({ locality: 'Clusane' }).name, 'Clusane');
  assert.equal(municipalityFromGeocode({ countryCode: 'IT', locality: 'Clusane' }), null);
});

test('ordina prima i luoghi di interesse, ma segnala la distanza reale', () => {
  const places = rankPlaces([
    { title: 'Passirano', dist: 0 },
    { title: 'Voce generica', dist: 100 },
    { title: 'Castello di Passirano', dist: 1400 }
  ], 'Passirano');
  assert.deepEqual(places.map(p => p.title), ['Castello di Passirano', 'Voce generica']);
  assert.ok(distanceMeters({ lat: 45.6, lon: 10.0 }, { lat: 45.601, lon: 10.0 }) > 100);
});
