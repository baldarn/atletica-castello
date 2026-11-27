# Prenotazioni set fotografico di Natale

La pagina [`/set-fotografico/`](../../content/set-fotografico/index.md) mostra calendario, orari e modulo
tramite lo shortcode `prenotazioni` (`layouts/shortcodes/prenotazioni.html`).
Le prenotazioni vengono salvate gratis su **Google Sheets** tramite **Google Apps Script** (`Code.gs`).

Finché `scriptUrl` nel front matter della pagina è vuoto, il sito mostra
"Le prenotazioni apriranno a breve".

## Attivazione (una volta sola, ~10 minuti)

1. Apri su Google Drive il file **natale2026_setfoto** (crealo se non esiste: un Foglio Google vuoto).
2. Menu **Estensioni → Apps Script**.
3. Cancella il contenuto di `Codice.gs`, incolla tutto il contenuto di [`Code.gs`](Code.gs) e salva (💾).
   Controlla l'oggetto `CONFIG` in cima (giorni, orari e durata dei turni, email di risposta, eventuale `NOTIFICA_A`
   per ricevere una copia di ogni prenotazione).
4. Nella barra in alto scegli la funzione **`installa`** e premi **Esegui**.
   Google chiede le autorizzazioni (accesso al foglio e invio email a tuo nome): accettale
   (se compare "App non verificata": *Avanzate → Vai al progetto*).
   Nel file comparirà il foglio **"Prenotazioni set fotografico"** con le intestazioni.
5. **Esegui il deployment → Nuovo deployment** → tipo **App web**:
   - *Esegui come*: **Me**
   - *Chi ha accesso*: **Chiunque**

   Premi **Esegui il deployment** e copia l'**URL dell'app web** (finisce con `/exec`).
6. Incolla l'URL in `content/set-fotografico/index.md`:

   ```yaml
   scriptUrl: "https://script.google.com/macros/s/XXXXXXXX/exec"
   ```

7. Pubblica il sito (`make deploy`).

Per verificare: aprendo `URL/exec?action=config` deve comparire la configurazione dei giorni e degli orari;
aprendo `URL/exec?action=occupati&data=2026-12-19` nel browser deve comparire
`{"ok":true,"occupati":[]}`.

## Come funziona

- **Orari**: turni da 20 minuti, 10:00–13:00 e 14:00–17:00 (18 turni). Giorni, fasce e durata si
  cambiano **solo** in `CONFIG` dentro `Code.gs`: la pagina li legge dallo script (`?action=config`),
  quindi sito e script non possono divergere. Il backend accetta solo giorni e orari previsti lì.
- **Doppie prenotazioni**: ogni turno può essere prenotato una sola volta. Il controllo avviene
  con un lock, quindi anche due invii contemporanei non possono prendere lo stesso orario;
  chi arriva secondo vede un messaggio e la lista aggiornata degli orari liberi.
- **Una prenotazione a persona**: dentro lo stesso lock il backend rifiuta la richiesta se l'email
  (senza maiuscole/spazi) o il telefono (solo cifre, senza +39) hanno già una prenotazione.
  Così una sola persona non può occupare tutti i turni.
- **Orari passati**: non si possono prenotare giorni od orari già iniziati (fuso orario `Europe/Rome`);
  la pagina li mostra barrati e il backend li rifiuta comunque.
- **Email di conferma**: inviata automaticamente all'indirizzo indicato, con "rispondi a"
  `sito@societaatleticacastello.it`. Un account Gmail gratuito può inviare circa 100 email al giorno.
- **Anti-spam**: il modulo ha un campo nascosto "trappola" che i bot compilano e le persone no.
- **Annullare una prenotazione**: basta cancellare la riga dal foglio; l'orario torna libero subito e la persona può prenotare di nuovo.

## Modifiche successive al codice

Dopo aver modificato `Code.gs` nell'editor di Apps Script:
**Esegui il deployment → Gestisci deployment → ✏️ → Versione: Nuova versione → Esegui il deployment**.
L'URL resta lo stesso, quindi non serve toccare il sito.
