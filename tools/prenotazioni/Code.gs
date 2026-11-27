/**
 * Backend prenotazioni "Set fotografico di Natale" - Società Atletica Castello
 *
 * Google Apps Script collegato al file Google Sheets "natale2026_setfoto".
 * Le prenotazioni vengono salvate nel foglio "Prenotazioni set fotografico".
 * Istruzioni di installazione: tools/prenotazioni/README.md
 *
 * API (Web App):
 *   GET  ?action=config                     -> { ok: true, giorni: [...], fasce: [["10:00","13:00"], ...], durata: 20 }
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
  // giorni prenotabili, fasce orarie e durata: la pagina web li legge da qui (?action=config)
  GIORNI: ['2026-12-19'],
  FASCE: [['10:00', '13:00'], ['14:00', '17:00']],
  DURATA_MINUTI: 20,
  MITTENTE: 'Società Atletica Castello',
  RISPONDI_A: 'sito@societaatleticacastello.it',
  TELEFONO_INFO: '353 4937251',
  // email che riceve una copia di ogni prenotazione (vuoto = nessuna notifica)
  NOTIFICA_A: '',
  // fuso orario usato per non accettare turni già iniziati
  FUSO_ORARIO: 'Europe/Rome'
};

var INTESTAZIONI = ['Data e ora prenotazione', 'Giorno', 'Orario', 'Nome', 'Cognome',
  'Email', 'Telefono', 'Note', 'Consenso privacy'];

// ---------------------------------------------------------------- web app
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'config') {
    return json_({ ok: true, giorni: CONFIG.GIORNI, fasce: CONFIG.FASCE, durata: CONFIG.DURATA_MINUTI });
  }
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
    var righe = righe_();
    // una sola prenotazione per email e per numero di telefono
    var email = normEmail_(d.email), tel = normTel_(d.telefono);
    var giaPrenotato = righe.some(function (r) { return normEmail_(r[4]) === email || normTel_(r[5]) === tel; });
    if (giaPrenotato) {
      return json_({ ok: false, errore: 'Risulta già una prenotazione con questa email o questo numero di telefono.' });
    }
    var presi = occupatiDa_(righe, d.data);
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
  if (d.data + ' ' + d.orario <= adesso_()) return 'Questo orario è già passato: scegline uno successivo.';
  if (!str_(d.nome) || !str_(d.cognome)) return 'Inserisci nome e cognome.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str_(d.email))) return 'Inserisci un indirizzo email valido.';
  if (!/^[+\d][\d\s./-]{5,}$/.test(str_(d.telefono))) return 'Inserisci un numero di telefono valido.';
  if (d.privacy !== true) return 'È necessario accettare l\'informativa sulla privacy.';
  if (str_(d.nome).length > 60 || str_(d.cognome).length > 60 || str_(d.email).length > 120 ||
      str_(d.telefono).length > 30 || str_(d.note).length > 500) return 'Alcuni campi sono troppo lunghi.';
  return null;
}

// righe del foglio, colonne B..G: [Giorno, Orario, Nome, Cognome, Email, Telefono]
function righe_() {
  var sh = foglio_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 2, n, 6).getDisplayValues();
}

// slice(0, 5): un orario scritto a mano nel foglio può apparire come "10:00:00"
function occupatiDa_(righe, giorno) {
  return righe.filter(function (r) { return r[0] === giorno; }).map(function (r) { return String(r[1]).slice(0, 5); });
}

function occupati_(giorno) {
  return occupatiDa_(righe_(), giorno);
}

// "AAAA-MM-GG HH:MM" nel fuso orario italiano, confrontabile come testo
function adesso_() {
  return Utilities.formatDate(new Date(), CONFIG.FUSO_ORARIO, 'yyyy-MM-dd HH:mm');
}

function normEmail_(v) { return str_(v).replace(/^'/, '').replace(/\s+/g, '').toLowerCase(); }

// solo cifre, senza prefisso internazionale italiano: "+39 333 123 4567" = "3331234567"
function normTel_(v) {
  var t = str_(v).replace(/\D/g, '');
  if (/^(0039|39)\d{9,10}$/.test(t)) t = t.replace(/^(0039|39)/, '');
  return t;
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
    // Giorno, Orario e Telefono come testo semplice: il foglio non li trasforma in date/ore/numeri
    sh.getRange('B:C').setNumberFormat('@');
    sh.getRange('G:G').setNumberFormat('@');
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
