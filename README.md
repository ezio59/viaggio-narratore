# Viaggio Narratore

Una versione dell'app di viaggio descritta da Ezio: la mappa segue il GPS, identifica sempre prima il comune e annuncia a voce i cambi di comune. Permette inoltre di esplorare luoghi vicini e storia locale.

Il logo unisce un segnaposto sulla mappa, una bussola e le onde della voce. Il file vettoriale `icon.svg` è incluso nell'app; le varianti PNG servono per l'installazione sulla schermata Home.

## Prova rapida

- Apri l'app pubblicata su HTTPS dal telefono e premi **Inizia il viaggio**. Il browser chiederà il permesso di usare la posizione.
- Premi **Prova un esempio** per esplorare Passirano senza inviare coordinate a un servizio di geocodifica. Richiede comunque Internet per mappa e Wikipedia.
- Quando il comune cambia, il titolo e le schede si aggiornano e la voce lo annuncia. Le richieste di riconoscimento sono limitate nel tempo e nella distanza: l'aggiornamento del nome può arrivare dopo alcuni secondi, talvolta più a lungo vicino al confine o con GPS impreciso.
- Un riquadro ben visibile sulla mappa indica il comune anche con la voce spenta. Mostra l'eventuale frazione verificata e l'ora dell'ultimo aggiornamento. Se il GPS perde precisione o il viaggio è terminato, lo segnala come *ultimo comune rilevato* anziché come posizione attuale.
- Il comune ha sempre precedenza sulla località: per annunciare un comune italiano l'app richiede un confine amministrativo di livello comunale. Se manca, mostra il nome come provvisorio e non lo annuncia. Una frazione viene aggiunta solo se una scheda Wikipedia la descrive come frazione del comune rilevato. L'assenza della frazione nella scheda non esclude che essa esista nella realtà.
- La voce degli avvisi è attiva all'avvio, disattivabile con **Voce attiva**. Premi **Chiedi** e pronuncia “Dove mi trovo?”, “La sua storia” o “Cosa vedere?”; se il browser non offre il riconoscimento vocale, restano disponibili i pulsanti. Il riconoscimento potrebbe usare un servizio del browser per trascrivere l'audio.
- **Satellite ↗** apre la vista satellitare sulla posizione attuale in Google Maps. Per mantenere una mappa satellitare integrata nell'app serve configurare un fornitore di immagini con le sue credenziali e condizioni d'uso; la mappa principale resta OpenStreetMap.

## Pubblicazione su GitHub Pages

Carica i file contenuti in questa cartella nella radice di un nuovo repository e abilita **Settings → Pages → Deploy from a branch → main / (root)**. Apri l'indirizzo HTTPS risultante sull'iPhone. La PWA può essere aggiunta alla schermata Home tramite Safari. Non sono necessari account, chiavi API o backend.

## Fonti, privacy e limiti

- Mappa: OpenStreetMap con attribuzione visibile; libreria Leaflet 1.9.4. Le mappe richiedono Internet; non viene eseguito alcun download massivo di tessere.
- Comune: BigDataCloud Free Client Side Reverse Geocode to City. Le coordinate GPS attuali sono inviate direttamente dal browser al servizio, secondo le sue condizioni; l'app non salva cronologia o coordinate. L'API descrive l'area amministrativa; nelle zone di confine i dati possono essere approssimativi.
- Storia e dintorni: API di Wikipedia in italiano. Anche la ricerca dei luoghi vicini invia le coordinate attuali a Wikipedia. Le schede dei dintorni sono entro 10 km dal punto rilevato, dunque possono appartenere ad altri comuni. Non sono consigli editoriali né una lista completa delle attrazioni.
- Serve HTTPS per il GPS. Il browser può sospendere posizione, sintesi e riconoscimento vocale quando passa in background. Il monitoraggio è pensato per essere usato con la pagina aperta.

Per un utilizzo pubblico con molto traffico è opportuno verificare capacità e condizioni d'uso dei fornitori dei dati. L'endpoint di geocodifica è raccolto in una costante in `app.js` per poterlo sostituire.

## Sviluppo

Progetto statico in HTML, CSS e JavaScript, senza build. Per verificare la logica del comune e la classifica dei luoghi: `node --test tests/core.test.mjs`. Per una prova locale dell'interfaccia: `python3 -m http.server 8000` dalla cartella dell'app e apri `http://localhost:8000` (localhost è trattato come contesto affidabile dai browser, ma la prova GPS reale va fatta da HTTPS sul telefono).
