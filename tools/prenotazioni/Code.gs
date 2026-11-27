/**
 * Backend prenotazioni "Set fotografico di Natale" - Società Atletica Castello
 *
 * Google Apps Script collegato al file Google Sheets "natale2026_setfoto".
 * Le prenotazioni vengono salvate nel foglio "Prenotazioni set fotografico".
 * Istruzioni di installazione: tools/prenotazioni/README.md
 *
 * API (Web App):
 *   GET  ?action=occupati&data=AAAA-MM-GG  -> { ok: true, occupati: ["10:00", ...] }
 *   POST body JSON (Content-Type text/plain) {action:"prenota", data, orario, nome, cognome,
 *        email, telefono, note, privacy, sito}  -> { ok: true } | { ok: false, errore, occupati? }
 */

// ---------------------------------------------------------------- configurazione
var CONFIG = {
  NOME_FOGLIO: 'Prenotazioni set fotografico',
  // ID del file natale2026_setfoto: lascialo vuoto se lo script è creato da
  // Estensioni > Apps Script dentro il file stesso (script "collegato").
  ID_FILE: '',
  TITOLO: 'Set fotografico di Natale',
  LUOGO: 'Società Atletica Castello - Oasi Biancoverde, Via Reginaldo Giuliani 518, Firenze',
  // giorni prenotabili e fasce orarie: devono coincidere con lo shortcode nella pagina
  GIORNI: ['2026-12-19'],
  FASCE: [['10:00', '13:00'], ['14:00', '17:00']],
  DURATA_MINUTI: 20,
  MITTENTE: 'Società Atletica Castello',
  RISPONDI_A: 'sito@societaatleticacastello.it',
  TELEFONO_INFO: '353 4937251',
  // email che riceve una copia di ogni prenotazione (vuoto = nessuna notifica)
  NOTIFICA_A: ''
};

var INTESTAZIONI = ['Data e ora prenotazione', 'Giorno', 'Orario', 'Nome', 'Cognome',
  'Email', 'Telefono', 'Note', 'Consenso privacy'];

// ---------------------------------------------------------------- web app
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'occupati') {
    if (CONFIG.GIORNI.indexOf(p.data) < 0) return json_({ ok: false, errore: 'Giorno non prenotabile.' });
    return json_({ ok: true, occupati: occupati_(p.data) });
  }
  return json_({ ok: true, servizio: 'prenotazioni ' + CONFIG.TITOLO });
}

function doPost(e) {
  var d;
  try {
    d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, errore: 'Richiesta non valida.' });
  }
  if (d.action !== 'prenota') return json_({ ok: false, errore: 'Azione non valida.' });

  // campo trappola anti-spam: se è compilato fingiamo che sia andato tutto bene
  if (d.sito) return json_({ ok: true });

  var errore = valida_(d);
  if (errore) return json_({ ok: false, errore: errore });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, errore: 'Troppe richieste in questo momento, riprova tra qualche secondo.' });
  }
  try {
    var presi = occupati_(d.data);
    if (presi.indexOf(d.orario) >= 0) {
      return json_({ ok: false, errore: 'Ci dispiace, l\'orario delle ' + d.orario + ' è appena stato prenotato. Scegline un altro.', occupati: presi });
    }
    foglio_().appendRow([new Date(), "'" + d.data, "'" + d.orario, pulisci_(d.nome), pulisci_(d.cognome),
      pulisci_(d.email), "'" + str_(d.telefono), pulisci_(d.note), 'Sì']);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  try {
    inviaConferma_(d);
  } catch (err) {
    console.error('Invio email fallito: ' + err);
  }
  return json_({ ok: true });
}

// ---------------------------------------------------------------- logica
function orariPrevisti_() {
  var out = [];
  CONFIG.FASCE.forEach(function (f) {
    for (var m = minuti_(f[0]); m + CONFIG.DURATA_MINUTI <= minuti_(f[1]); m += CONFIG.DURATA_MINUTI) out.push(hhmm_(m));
  });
  return out;
}

function valida_(d) {
  if (CONFIG.GIORNI.indexOf(d.data) < 0) return 'Il giorno scelto non è prenotabile.';
  if (orariPrevisti_().indexOf(d.orario) < 0) return 'L\'orario scelto non è previsto.';
  if (!str_(d.nome) || !str_(d.cognome)) return 'Inserisci nome e cognome.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str_(d.email))) return 'Inserisci un indirizzo email valido.';
  if (!/^[+\d][\d\s./-]{5,}$/.test(str_(d.telefono))) return 'Inserisci un numero di telefono valido.';
  if (d.privacy !== true) return 'È necessario accettare l\'informativa sulla privacy.';
  if (str_(d.nome).length > 60 || str_(d.cognome).length > 60 || str_(d.email).length > 120 ||
      str_(d.telefono).length > 30 || str_(d.note).length > 500) return 'Alcuni campi sono troppo lunghi.';
  return null;
}

function occupati_(giorno) {
  var sh = foglio_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 2, n, 2).getDisplayValues()
    .filter(function (r) { return r[0] === giorno; })
    .map(function (r) { return r[1]; });
}

function inviaConferma_(d) {
  var quando = dataLunga_(d.data) + ' alle ore ' + d.orario;
  var testo =
    'Ciao ' + pulisci_(d.nome) + ',\n\n' +
    'la tua prenotazione per il ' + CONFIG.TITOLO + ' è confermata!\n\n' +
    'Quando: ' + quando + ' (turno di ' + CONFIG.DURATA_MINUTI + ' minuti)\n' +
    'Dove: ' + CONFIG.LUOGO + '\n' +
    'Nome: ' + pulisci_(d.nome) + ' ' + pulisci_(d.cognome) + '\n' +
    'Telefono: ' + pulisci_(d.telefono) + '\n' +
    (str_(d.note) ? 'Note: ' + pulisci_(d.note) + '\n' : '') +
    '\nTi chiediamo di arrivare qualche minuto prima dell\'orario prenotato.\n' +
    'Se non puoi più venire o per qualsiasi informazione rispondi a questa email o chiama il ' + CONFIG.TELEFONO_INFO + '.\n\n' +
    'A presto e buone feste! 🎄\n' + CONFIG.MITTENTE;

  MailApp.sendEmail({
    to: str_(d.email),
    subject: 'Conferma prenotazione ' + CONFIG.TITOLO + ' - ' + quando,
    body: testo,
    name: CONFIG.MITTENTE,
    replyTo: CONFIG.RISPONDI_A
  });

  if (CONFIG.NOTIFICA_A) {
    MailApp.sendEmail({
      to: CONFIG.NOTIFICA_A,
      subject: 'Nuova prenotazione set fotografico: ' + quando,
      body: testo.replace(/^Ciao [^\n]*\n\n/, '') + '\n\nEmail: ' + str_(d.email),
      name: CONFIG.MITTENTE
    });
  }
}

// ---------------------------------------------------------------- utilità
function foglio_() {
  var ss = CONFIG.ID_FILE ? SpreadsheetApp.openById(CONFIG.ID_FILE) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.NOME_FOGLIO);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.NOME_FOGLIO);
    sh.appendRow(INTESTAZIONI);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTESTAZIONI.length).setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

// evita che il foglio interpreti il testo come formula (=, +, -, @)
function pulisci_(v) { var s = str_(v); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function minuti_(h) { var p = h.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }

function hhmm_(m) { var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }

function dataLunga_(iso) {
  var giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
  return giorni[d.getDay()] + ' ' + d.getDate() + ' ' + mesi[d.getMonth()] + ' ' + d.getFullYear();
}

/** Da eseguire una volta dall'editor: crea il foglio e chiede le autorizzazioni (fogli + email). */
function installa() {
  foglio_();
  console.log('Foglio pronto. Orari previsti: ' + orariPrevisti_().join(', '));
  console.log('Email rimanenti oggi: ' + MailApp.getRemainingDailyQuota());
}
