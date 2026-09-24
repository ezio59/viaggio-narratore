import { municipalityFromGeocode, distanceMeters, rankPlaces, extractHistory, cleanText, voiceIntent } from './core.mjs';

const $ = id => document.getElementById(id);
const ui = {
  statusPill: $('status-pill'), statusText: $('status-text'), mapHeadline: $('map-headline'),
  mapPlace: $('map-place'), mapPlaceKicker: $('map-place-kicker'), mapPlaceName: $('map-place-name'),
  mapPlaceDetail: $('map-place-detail'), mapVoiceState: $('map-voice-state'),
  eyebrow: $('place-eyebrow'), title: $('place-title'), description: $('place-description'),
  index: $('place-index'), startActions: $('start-actions'), travelControls: $('travel-controls'),
  travelStatus: $('travel-status'), travelIndicator: $('travel-indicator'), feedback: $('feedback'),
  content: $('content-area'), see: $('panel-see'), story: $('panel-story'),
  tabSee: $('tab-see'), tabStory: $('tab-story'), voice: $('voice-button'), ask: $('ask-button'),
  recenter: $('recenter-button'), satellite: $('satellite-link'), dialog: $('info-dialog')
};

const state = {
  map: null, marker: null, circle: null, watchId: null, mode: 'idle',
  position: null, lastLookup: null, city: null, locality: '', epoch: 0, lookupSeq: 0,
  lastCityUpdate: null, locationStale: false,
  following: true, voiceOn: true, activeTab: 'see', listening: false, recognizer: null,
  pendingNarration: '', placesLoaded: false, storyLoaded: false,
  places: [], storyText: '', storyUrl: '', storyTitle: '',
  placeCache: new Map(), localityCache: new Map()
};

const GEO_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const WIKI_ENDPOINT = 'https://it.wikipedia.org/w/api.php';
const MAP_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function initMap() {
  if (typeof L === 'undefined') {
    showFeedback('La mappa non si è caricata. Controlla la connessione e aggiorna la pagina.');
    return;
  }
  state.map = L.map('map', { zoomControl: false }).setView([42.7, 12.7], 6);
  L.tileLayer(MAP_TILES, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
  }).addTo(state.map);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  state.map.on('dragstart', () => { state.following = false; ui.recenter.hidden = !state.position; });
}

function setStatus(label, kind = '') {
  ui.statusPill.className = `status-pill ${kind}`.trim();
  ui.statusText.textContent = label;
  ui.travelIndicator.classList.toggle('live', kind === 'live');
}

function showFeedback(message) {
  ui.feedback.textContent = message;
  ui.feedback.hidden = !message;
}

function updateMapPlace() {
  const city = state.city;
  ui.mapPlace.hidden = !city;
  if (!city) return;
  ui.mapPlaceKicker.textContent = state.mode === 'demo' ? 'ESEMPIO · COMUNE'
    : !city.verified && city.countryCode === 'IT' ? 'COMUNE DA VERIFICARE'
    : state.locationStale || state.mode !== 'live' ? 'ULTIMO COMUNE RILEVATO' : 'COMUNE ATTUALE';
  ui.mapPlaceName.textContent = city.name;
  ui.mapVoiceState.textContent = state.voiceOn ? 'Voce attiva' : 'Voce spenta';
  const detail = state.locality ? `Frazione: ${state.locality}` : city.region || city.country || '';
  const time = state.lastCityUpdate && state.mode !== 'demo'
    ? `Aggiornato alle ${new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(state.lastCityUpdate)}` : '';
  ui.mapPlaceDetail.textContent = [detail, time].filter(Boolean).join(' · ');
}

function showTravelControls() {
  ui.startActions.hidden = true;
  ui.travelControls.hidden = false;
}

function startTravel() {
  stopTravel(false);
  state.mode = 'live';
  state.epoch++;
  state.city = null;
  state.locality = '';
  state.lastCityUpdate = null;
  state.locationStale = false;
  updateMapPlace();
  state.position = null;
  state.lastLookup = null;
  state.pendingNarration = '';
  state.following = true;
  if (state.map && state.marker) state.map.removeLayer(state.marker);
  if (state.map && state.circle) state.map.removeLayer(state.circle);
  state.marker = null;
  state.circle = null;
  ui.recenter.hidden = true;
  ui.content.hidden = true;
  showTravelControls();
  showFeedback('');
  setStatus('Ricerca GPS', 'searching');
  ui.mapHeadline.textContent = 'Un luogo alla volta.';
  ui.travelStatus.textContent = 'Cerco la tua posizione…';
  ui.eyebrow.textContent = 'IN CERCA DELLA POSIZIONE';
  ui.title.textContent = 'Sto cercando dove sei…';
  ui.description.textContent = 'Consenti l’accesso alla posizione quando il telefono lo chiede.';
  if (!window.isSecureContext || !navigator.geolocation) {
    showFeedback('Per seguire il GPS apri l’app da un indirizzo HTTPS sul telefono e consenti la posizione. Puoi intanto provare l’esempio.');
    ui.travelControls.hidden = true;
    ui.startActions.hidden = false;
    state.mode = 'idle';
    setStatus('GPS non disponibile');
    return;
  }
  if (state.voiceOn) speak('Viaggio avviato. Ti dirò quando entri in un nuovo comune.');
  resumeWatch();
}

function resumeWatch() {
  if (state.mode !== 'live' || state.watchId !== null) return;
  state.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 20000
  });
}

function stopTravel(resetStatus = true) {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  if (state.recognizer && state.listening) state.recognizer.abort();
  state.epoch++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!resetStatus) return;
  state.mode = 'idle';
  state.locationStale = true;
  updateMapPlace();
  ui.travelControls.hidden = true;
  ui.startActions.hidden = false;
  ui.travelStatus.textContent = '';
  setStatus('GPS spento');
  ui.eyebrow.textContent = 'VIAGGIO TERMINATO';
  ui.description.textContent = 'Puoi continuare a leggere oppure riprendere il viaggio quando vuoi.';
  showFeedback('');
}

function onGeoError(error) {
  if (state.mode !== 'live') return;
  state.locationStale = true;
  updateMapPlace();
  const messages = {
    1: 'Posizione negata. Abilita la localizzazione nelle impostazioni del browser e riprova.',
    2: 'Il GPS non riesce a trovare una posizione. Prova all’aperto o verifica la connessione.',
    3: 'Il GPS sta impiegando troppo tempo. Attendi qualche secondo o riprova.'
  };
  showFeedback(messages[error.code] || 'Non riesco a leggere la posizione. Riprova tra poco.');
  setStatus('GPS in attesa', 'searching');
  ui.travelStatus.textContent = 'In attesa di una posizione valida';
}

function onPosition(result) {
  if (state.mode !== 'live') return;
  const { latitude: lat, longitude: lon, accuracy } = result.coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const position = { lat, lon, accuracy: Math.round(accuracy || 0) };
  state.position = position;
  setStatus('GPS attivo', 'live');
  ui.travelStatus.textContent = `Posizione aggiornata · precisione ±${position.accuracy} m`;
  showFeedback('');
  updateMarker(position);

  // Il servizio gratuito riceve solo coordinate GPS attuali, mai luoghi di prova o salvati.
  // Limitiamo le richieste durante il viaggio; vicino a un confine serve qualche secondo.
  const now = Date.now();
  if (state.lastLookup && now - state.lastLookup.time < 8000) return;
  if (state.lastLookup && distanceMeters(state.lastLookup.position, position) < 120 && now - state.lastLookup.time < 45000) return;
  if (position.accuracy > 250 && state.city) return;
  state.lastLookup = { time: now, position };
  lookupMunicipality(position, state.epoch);
}

function updateMarker(position) {
  const satellite = new URL('https://www.google.com/maps/@');
  satellite.search = new URLSearchParams({ api: '1', map_action: 'map', center: `${position.lat},${position.lon}`, zoom: '15', basemap: 'satellite' });
  ui.satellite.href = satellite.toString();
  if (!state.map) return;
  if (!state.marker) {
    const icon = L.divIcon({ className: '', html: '<div class="current-marker"></div>', iconSize: [19, 19], iconAnchor: [10, 10] });
    state.marker = L.marker([position.lat, position.lon], { icon }).addTo(state.map);
    state.circle = L.circle([position.lat, position.lon], { radius: Math.max(position.accuracy, 20), color: '#368b89', weight: 1, fillOpacity: .09 }).addTo(state.map);
  } else {
    state.marker.setLatLng([position.lat, position.lon]);
    state.circle.setLatLng([position.lat, position.lon]).setRadius(Math.max(position.accuracy, 20));
  }
  if (state.following) state.map.setView([position.lat, position.lon], Math.max(state.map.getZoom(), 13), { animate: !!state.city });
  ui.recenter.hidden = state.following;
}

async function lookupMunicipality(position, epoch) {
  const sequence = ++state.lookupSeq;
  try {
    const url = new URL(GEO_ENDPOINT);
    url.search = new URLSearchParams({ latitude: String(position.lat), longitude: String(position.lon), localityLanguage: 'it' });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geocodifica ${response.status}`);
    const city = municipalityFromGeocode(await response.json());
    if (epoch !== state.epoch || sequence !== state.lookupSeq || state.mode !== 'live') return;
    if (!city) throw new Error('Nessun comune riconosciuto');
    // Con GPS molto approssimativo è preferibile attendere prima di annunciare un confine.
    if (position.accuracy > 180 && state.city && city.key !== state.city.key) {
      state.locationStale = true;
      updateMapPlace();
      showFeedback('Il GPS è impreciso: sto verificando se hai superato il confine del comune.');
      return;
    }
    state.lastCityUpdate = new Date();
    state.locationStale = false;
    if (state.city?.key !== city.key || (!state.city.verified && city.verified)) {
      displayCity(city, position, false);
      if (city.verified || city.countryCode !== 'IT') {
        loadContent(city, position, state.epoch);
        if (state.voiceOn) speak(city.verified ? `Sei entrato nel comune di ${city.name}.` : `Ora sei a ${city.name}.`);
      } else showFeedback('Sto verificando il confine del comune. Il nome indicato potrebbe essere una località vicina.');
    }
    if (city.verified && state.city?.key === city.key) resolveLocality(city, state.epoch);
    updateMapPlace();
  } catch (error) {
    if (epoch === state.epoch && sequence === state.lookupSeq && state.mode === 'live') {
      state.locationStale = true;
      updateMapPlace();
      showFeedback('La mappa ti segue, ma ora non riesco a riconoscere il comune. Riproverò quando ti sposti.');
    }
  }
}

function displayCity(city, position, demo) {
  state.city = city;
  state.locality = '';
  if (demo) state.lastCityUpdate = new Date();
  state.places = [];
  state.placesLoaded = false;
  state.storyLoaded = false;
  state.pendingNarration = '';
  state.storyText = '';
  state.storyUrl = '';
  state.storyTitle = '';
  ui.content.hidden = !demo && !city.verified && city.countryCode === 'IT';
  ui.eyebrow.textContent = demo ? 'UN ASSAGGIO DI VIAGGIO' : (!city.verified && city.countryCode === 'IT' ? 'COMUNE DA VERIFICARE' : (city.country === 'Italia' ? 'IL COMUNE IN CUI TI TROVI' : 'IL LUOGO IN CUI TI TROVI'));
  ui.title.textContent = city.name;
  ui.mapHeadline.textContent = city.name;
  setPlaceDescription();
  updateMapPlace();
  ui.index.textContent = demo ? 'MODALITÀ ESEMPIO' : 'POSIZIONE ATTUALE';
  ui.see.innerHTML = '<div class="loading-copy">Cerco luoghi interessanti nei dintorni…</div>';
  ui.story.innerHTML = '<div class="loading-copy">Cerco la storia del comune…</div>';
  showFeedback('');
  ui.recenter.hidden = false;
  state.position = position;
  updateMarker(position);
  setTab('see');
}

function setPlaceDescription() {
  const place = state.city;
  if (!place) return;
  const detail = state.locality ? `${state.locality} · frazione di ${place.name}` : null;
  ui.description.textContent = [detail, place.region, place.country].filter(Boolean).join(' · ') || 'Scopri cosa c’è intorno a te.';
  updateMapPlace();
}

async function resolveLocality(city, epoch) {
  const candidate = city.localityCandidate;
  if (!candidate) {
    if (state.locality) { state.locality = ''; setPlaceDescription(); }
    return;
  }
  const cacheKey = `${city.key}|${candidate.toLocaleLowerCase('it')}`;
  let verified = state.localityCache.get(cacheKey);
  if (verified === undefined) {
    try {
      const article = await getArticle(candidate);
      const text = article?.text || '';
      const town = city.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      verified = Boolean(text && /\bfrazione\b/i.test(text) && new RegExp(`\\b${town}\\b`, 'i').test(text));
    } catch { return; }
    state.localityCache.set(cacheKey, verified);
  }
  if (epoch !== state.epoch || state.city?.key !== city.key) return;
  const next = verified ? candidate : '';
  if (next === state.locality) return;
  state.locality = next;
  setPlaceDescription();
  if (next && state.voiceOn && state.mode === 'live') speak(`Frazione di ${city.name}: ${next}.`, false);
}

function startDemo() {
  stopTravel(false);
  state.mode = 'demo';
  state.epoch++;
  state.following = true;
  state.lastLookup = null;
  const position = { lat: 45.599, lon: 10.069, accuracy: 0 };
  showTravelControls();
  ui.travelStatus.textContent = 'Esempio · Passirano (BS)';
  setStatus('Esempio');
  displayCity({ name: 'Passirano', region: 'Lombardia', country: 'Italia', countryCode: 'IT', verified: true, key: 'demo|passirano' }, position, true);
  loadContent(state.city, position, state.epoch);
  if (state.voiceOn) speak('Esempio di viaggio. Ti trovi nel comune di Passirano.');
}

function setTab(tab) {
  state.activeTab = tab;
  for (const name of ['see', 'story']) {
    const active = tab === name;
    ui[name].hidden = !active;
    const control = name === 'see' ? ui.tabSee : ui.tabStory;
    control.classList.toggle('active', active);
    control.setAttribute('aria-selected', String(active));
    control.tabIndex = active ? 0 : -1;
  }
}

function wikiUrl(params) {
  const url = new URL(WIKI_ENDPOINT);
  url.search = new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params });
  return url;
}

async function wikiJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
    return response.json();
  } finally { clearTimeout(timer); }
}

async function loadContent(city, position, epoch) {
  await Promise.allSettled([loadPlaces(city, position, epoch), loadStory(city, epoch)]);
}

async function loadPlaces(city, position, epoch) {
  try {
    const json = await wikiJson(wikiUrl({ list: 'geosearch', gscoord: `${position.lat}|${position.lon}`, gsradius: '10000', gslimit: '35' }));
    if (epoch !== state.epoch || state.city?.key !== city.key) return;
    state.places = rankPlaces(json.query?.geosearch, city.name);
    state.placesLoaded = true;
    renderPlaces();
    if (state.pendingNarration === 'see') {
      state.pendingNarration = '';
      narratePlaces();
    }
  } catch {
    if (epoch === state.epoch && state.city?.key === city.key) {
      state.placesLoaded = true;
      renderEmpty(ui.see, 'Non riesco a caricare i luoghi vicini. Verifica la connessione e riprova.');
      if (state.pendingNarration === 'see') { state.pendingNarration = ''; speak('Non riesco a caricare i luoghi vicini in questo momento.'); }
    }
  }
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const p = document.createElement('p');
  p.className = 'empty-copy';
  p.textContent = message;
  container.append(p);
}

function renderPlaces() {
  ui.see.replaceChildren();
  if (!state.places.length) return renderEmpty(ui.see, 'Non ho trovato schede di luoghi vicini su Wikipedia. La mappa resta disponibile per esplorare.');
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Luoghi documentati su Wikipedia entro 10 km: alcuni possono trovarsi in comuni vicini.';
  ui.see.append(hint);
  for (const place of state.places) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-card';
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = place.title;
    const distance = document.createElement('small');
    distance.textContent = place.dist < 1000 ? `${Math.round(place.dist)} m da qui` : `${(place.dist / 1000).toFixed(1).replace('.', ',')} km da qui`;
    text.append(name, distance);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    button.append(text, arrow);
    button.addEventListener('click', () => showPlaceDetail(place));
    ui.see.append(button);
  }
}

async function getArticle(title) {
  const key = title.toLowerCase();
  if (state.placeCache.has(key)) return state.placeCache.get(key);
  const json = await wikiJson(wikiUrl({ prop: 'extracts|info', inprop: 'url', exintro: '1', explaintext: '1', redirects: '1', titles: title }));
  const page = Object.values(json.query?.pages || {})[0];
  if (!page || page.missing !== undefined) return null;
  const result = { title: page.title, text: cleanText(page.extract), url: page.fullurl || `https://it.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` };
  state.placeCache.set(key, result);
  return result;
}

async function showPlaceDetail(place) {
  const epoch = state.epoch;
  ui.see.replaceChildren();
  const back = document.createElement('button');
  back.className = 'detail-back';
  back.textContent = '← Tutti i luoghi';
  back.addEventListener('click', renderPlaces);
  const heading = document.createElement('h2');
  heading.className = 'detail-title';
  heading.textContent = place.title;
  const copy = document.createElement('p');
  copy.className = 'story-copy';
  copy.textContent = 'Carico la scheda…';
  ui.see.append(back, heading, copy);
  try {
    const page = await getArticle(place.title);
    if (epoch !== state.epoch || !copy.isConnected) return;
    copy.textContent = page?.text || 'La scheda non contiene un’introduzione. Puoi aprirla direttamente su Wikipedia.';
    const link = sourceLink(page?.url || `https://it.wikipedia.org/wiki/${encodeURIComponent(place.title.replace(/ /g, '_'))}`, 'Apri su Wikipedia ↗');
    ui.see.append(link);
    if (state.voiceOn && page?.text) speak(`${place.title}. ${page.text.slice(0, 700)}`);
  } catch {
    if (copy.isConnected) copy.textContent = 'Non riesco a caricare la scheda. Riprova tra poco.';
  }
}

async function loadStory(city, epoch) {
  try {
    let article = await getArticle(city.name);
    if (!article?.text) {
      const results = await wikiJson(wikiUrl({ list: 'search', srsearch: `${city.name} ${city.region}`, srlimit: '3' }));
      const title = results.query?.search?.[0]?.title;
      article = title ? await getArticle(title) : article;
    }
    if (epoch !== state.epoch || state.city?.key !== city.key) return;
    if (!article) {
      state.storyLoaded = true;
      renderEmpty(ui.story, 'Non ho trovato una scheda attendibile per questo comune su Wikipedia.');
      if (state.pendingNarration === 'story') { state.pendingNarration = ''; speak('Non ho trovato una scheda storica per questo comune.'); }
      return;
    }
    let history = '';
    try {
      const sectionsUrl = wikiUrl({ action: 'parse', page: article.title, prop: 'sections' });
      const sections = await wikiJson(sectionsUrl);
      const match = sections.parse?.sections?.find(section => /^(storia|cenni storici)$/i.test(section.line.replace(/<[^>]+>/g, '').trim()));
      if (match) {
        const sectionUrl = wikiUrl({ action: 'parse', page: article.title, prop: 'text', section: String(match.index), disableeditsection: '1' });
        const section = await wikiJson(sectionUrl);
        history = extractHistory(section.parse?.text?.['*']);
      }
    } catch { /* L'introduzione resta disponibile. */ }
    if (epoch !== state.epoch || state.city?.key !== city.key) return;
    state.storyText = history || article.text || '';
    state.storyLoaded = true;
    state.storyUrl = article.url;
    state.storyTitle = history ? 'Un po’ di storia' : 'Conosciamo il luogo';
    renderStory();
    if (state.pendingNarration === 'story') {
      state.pendingNarration = '';
      narrateStory();
    }
  } catch {
    if (epoch === state.epoch && state.city?.key === city.key) {
      state.storyLoaded = true;
      renderEmpty(ui.story, 'Non riesco a caricare la storia. Verifica la connessione e riprova.');
      if (state.pendingNarration === 'story') { state.pendingNarration = ''; speak('Non riesco a caricare la storia in questo momento.'); }
    }
  }
}

function sourceLink(href, label) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'source-link';
  link.textContent = label;
  return link;
}

function renderStory() {
  ui.story.replaceChildren();
  const heading = document.createElement('h2');
  heading.className = 'detail-title';
  heading.textContent = state.storyTitle;
  const text = document.createElement('p');
  text.className = 'story-copy';
  text.textContent = state.storyText || 'Questa voce non ha ancora un testo introduttivo.';
  ui.story.append(heading, text, sourceLink(state.storyUrl, 'Continua su Wikipedia ↗'));
}

function speak(text, replace = true) {
  if (!('speechSynthesis' in window) || !text) return;
  if (replace) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
  utterance.lang = 'it-IT';
  utterance.rate = .95;
  const italian = speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('it'));
  if (italian) utterance.voice = italian;
  speechSynthesis.speak(utterance);
}

function narrateStory() {
  if (!state.city) return speak('Non ho ancora individuato un comune.');
  if (!state.storyText) {
    if (state.storyLoaded) return speak(`Non ho trovato notizie storiche per ${state.city.name}.`);
    state.pendingNarration = 'story';
    return speak(`Sto cercando la storia di ${state.city.name}.`);
  }
  speak(`${state.city.name}. ${state.storyText}`);
}

function narratePlaces() {
  if (!state.city) return speak('Non ho ancora individuato un comune.');
  if (!state.places.length) {
    if (state.placesLoaded) return speak(`Non ho trovato luoghi documentati vicino a ${state.city.name}.`);
    state.pendingNarration = 'see';
    return speak(`Sto cercando luoghi interessanti intorno a ${state.city.name}.`);
  }
  const names = state.places.slice(0, 3).map(p => p.title).join(', ');
  speak(`Nei dintorni di ${state.city.name} ci sono, tra gli altri: ${names}. Alcuni luoghi possono essere in comuni vicini. Tocca una scheda per saperne di più.`);
}

function handleVoiceCommand(transcript) {
  const intent = voiceIntent(transcript);
  showFeedback(intent ? '' : `Ho sentito “${transcript}”, ma non ho capito la richiesta. Prova “dove mi trovo”, “la sua storia” o “cosa vedere”.`);
  if (intent === 'where') {
    const place = state.city ? `Ti trovi nel comune di ${state.city.name}${state.locality ? `, frazione ${state.locality}` : ''}.` : 'Non ho ancora individuato il comune.';
    speak(place);
  } else if (intent === 'story') {
    setTab('story');
    narrateStory();
  } else if (intent === 'see') {
    setTab('see');
    narratePlaces();
  }
}

function startListening() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return showFeedback('Il riconoscimento vocale non è disponibile in questo browser. Usa i pulsanti “Cosa vedere” e “La sua storia”.');
  if (state.listening) { state.recognizer?.stop(); return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const recognizer = new Recognition();
  state.recognizer = recognizer;
  recognizer.lang = 'it-IT';
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  recognizer.onstart = () => {
    state.listening = true;
    ui.ask.classList.add('listening');
    ui.ask.querySelector('span').textContent = 'Ascolto…';
    showFeedback('Parla ora: “Dove mi trovo?”, “La sua storia” o “Cosa vedere?”.');
  };
  recognizer.onresult = event => handleVoiceCommand(event.results?.[0]?.[0]?.transcript || '');
  recognizer.onerror = event => {
    if (event.error !== 'aborted') showFeedback(event.error === 'not-allowed'
      ? 'Per fare una domanda a voce, consenti l’uso del microfono nel browser.'
      : 'Non ho sentito bene. Riprova o usa i pulsanti.');
  };
  recognizer.onend = () => {
    state.listening = false;
    ui.ask.classList.remove('listening');
    ui.ask.querySelector('span').textContent = 'Chiedi';
  };
  try { recognizer.start(); } catch { showFeedback('Il microfono non si è avviato. Riprova o usa i pulsanti.'); }
}

function toggleVoice() {
  if (!('speechSynthesis' in window)) return showFeedback('Questo browser non dispone della lettura vocale.');
  state.voiceOn = !state.voiceOn;
  updateMapPlace();
  ui.voice.setAttribute('aria-pressed', String(state.voiceOn));
  ui.voice.querySelector('span').textContent = state.voiceOn ? 'Voce attiva' : 'Voce spenta';
  if (state.voiceOn) {
    const narration = state.activeTab === 'story' && state.storyText
      ? `${state.city?.name}. ${state.storyText}`
      : state.city ? `Sei a ${state.city.name}. Tocca un luogo per ascoltarne la descrizione, oppure apri La sua storia.` : 'Voce attiva.';
    speak(narration);
  } else speechSynthesis.cancel();
}

$('start-button').addEventListener('click', startTravel);
$('demo-button').addEventListener('click', startDemo);
$('stop-button').addEventListener('click', () => stopTravel());
ui.recenter.addEventListener('click', () => { state.following = true; if (state.position) updateMarker(state.position); });
ui.tabSee.addEventListener('click', () => setTab('see'));
ui.tabStory.addEventListener('click', () => { setTab('story'); if (state.voiceOn && state.storyText) speak(`${state.city?.name}. ${state.storyText}`); });
ui.voice.addEventListener('click', toggleVoice);
ui.ask.addEventListener('click', startListening);
$('info-link').addEventListener('click', event => { event.preventDefault(); ui.dialog.showModal(); });
$('dialog-done').addEventListener('click', () => ui.dialog.close());
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const next = state.activeTab === 'see' ? ui.tabStory : ui.tabSee;
  next.click(); next.focus();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'live' && state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.epoch++;
    state.locationStale = true;
    updateMapPlace();
    setStatus('In pausa');
    ui.travelStatus.textContent = 'Monitoraggio in pausa';
  } else if (!document.hidden && state.mode === 'live' && state.watchId === null) {
    state.lastLookup = null;
    setStatus('Ricerca GPS', 'searching');
    ui.travelStatus.textContent = 'Riprendo la posizione…';
    resumeWatch();
  }
});
initMap();
