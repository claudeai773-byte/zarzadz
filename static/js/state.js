//  STATE
// ══════════════════════════════════════════════════════════════
let state = {
  screen: SERVER_URL ? 'login' : 'config',
  user: null,
  activeTab: 'praca',
  loading: false,
  error: null,

  // Pracownik
  operacje: [],
  aktywnesje: [],         // wiele sesji równoległych
  timers: {},             // sesja_id -> {sec, interval, paused}
  qrScanMode: false,
  qrLastCodes: [],        // historia QR

  // Majster
  majsterStats: null,
  majsterSubTab: 'live',

  // Magazynier
  transportOps: [],
  transportHidden: [],    // ID operacji ukrytych przez użytkownika (przycisk X)

  // Zlecenia
  zlecenia: [],
  zlecenieModal: null,    // null | 'new' | {edytowane zlecenie}
  operacjeModal: null,    // {zlecenie} | null
  zlecenieKoszty: null,

  // Admin
  adminTab: 'uzytkownicy',
  sesjaGlownaModal: null,    // {operacjaId, aktywne:[]} – wybór sesji głównej
  importPdfModal: false,     // modal importu technologii z PDF
  importPdfResult: null,     // wynik importu
  importPdfPreview: null,    // podgląd przed importem (parse-only)
  importPdfBom: [],          // lista materiałów BOM do potwierdzenia
  importPdfParsing: false,
  kjModal: null,             // {op} – modal KJ dla pracownika
  kontynuacjaModal: null,    // {operacjaId, pracownik, sesjaGlownaId} – dialog kontynuacji operacji innego
  userPermissions: {},  // {userId: [tabs]}
  users: [],
  stawki: [],
  produktyZlecenia: [],   // produkty aktualnie edytowanego zlecenia
  katalog: [],
  userModal: null,
  stawkaModal: null,
  produktModal: null,

  // Modal stop/pauza
  stopModal: null,        // null | {sesja}
  pauzaModal: null,
  nieprodukcyjnaModal: false,

  // QR gen
  qrGenModal: false,
  qrGenKod: '',
  qrGenTitle: '',
  qrZleceniePickerModal: null,

  // Pracownik wydajność
  pracaSubTab: 'praca',   // praca | wydajnosc
  pracaWydajnosc: null,
  pracaWydOkres: 'tydzien',

  // Majster wydajność
  wydajnoscMajster: null,
  wydajnoscOkres: 'dzis',
  majsterExpandedUser: null,
  majsterExpandedZlecenie: null,  // id zlecenia rozwiniętego w tab Zlecenia
  oblozenie: null,
  oblozenieLading: false,
  oblozenieSelected: null,
  majsterOpsCache: {},            // {zid: [operacje]} - cache operacji dla majstra
  raportOkres: {od:"", do:""},
  raportWydOkres: {od:"", do:""},
  raportWydTyp: "skrocony",

  // Autofill operacje
  autofillSourceId: null,
  autofillOperacje: [],
  editSesjaModal: null,   // {sesja_id, start_time, end_time}

  // Feedback / ocena
  feedbackRating: 0,
  feedbackModal: false,
  feedbackMsg: '',
  adminFeedbacks: null,

  // ─── Wizard: Nowe zlecenie z drzewem G→P ────────────────────────────────────
  nzModal: false,       // czy wizard otwarty
  nzStep: 1,            // 1=dane zlecenia  2=drzewo G→P
  nzNumer: '', nzNazwa: '', nzOpis: '', nzTermin: '', nzIlosc: 1,
  nzCena: 0, nzMatKlienta: false,
  nzTree: null,         // korzeń G
  nzEditNode: null,     // id węzła edytowanego
  nzMatSearch: '',
  nzMatResults: [],
  nzMatSearching: false,
  nzSaving: false,

  // BOM
  bomData: {},        // {zlecenie_id: [...pozycje]}
  bomSearch: '',
  bomSearchResults: [],
  bomSearching: false,
  bomQty: 1,
  bomUwagi: '',
  bomSelectedMat: null,
  materialyCount: null,

  // Magazyn – nowe
  magazynSubTab: 'transport',   // transport | materialy | rezerwacje | zapotrzebowanie
  magazynMatSearch: '',
  magazynMatResults: [],
  magazynMatSearching: false,
  magazynMatCount: null,
  magazynRezerwacje: [],        // lista rezerwacji z localStorage
  magazynZapotrzebowanie: null, // dane zapotrzebowania ze wszystkich zleceń
  magazynZapotrzebowanieLoading: false,
  magazynBraki: false,          // czy są braki → ikona ! w navbarze
  magazynDodajOpen: false,      // czy formularz dodawania materiału jest otwarty
  magazynEditMat: null,         // materiał do edycji lub null
  rezerwacjaModal: null,        // {material_id, material_opis, material_indeks, stan} | null
  magazynLastRefresh: null,     // czas ostatniego odświeżenia danych magazynu

  // Narzędziownia
  narzCount: null,
  narzNiskie: 0,
  narzSearch: '',
  narzResults: [],
  narzSearching: false,
  narzHistoria: [],
  narzHistoriaLoading: false,
  narzNiskeStany: null,
  narzSubView: 'stany',      // stany | historia | niskie | import
  narzPobierzModal: null,    // {narzedzie} – modal pobrania
  narzEditModal: null,       // {narzedzie} – edycja stanu
  narzDodajModal: false,     // dodawanie nowej pozycji


  // Print modal
  printModal: null,
  printOps: [],
  warehouseInfo: null,
  zlecenieDetailsModal: null,
  zlecenieModal: null,
  qrInneMode: false,
  qrManualMode: false,
  zlecenieSubTab: 'lista',  // lista | stawki | fakturowanie

  // Drzewko P/M zleceń (inline expand)
  zlecenieExpanded: {},   // {zid: bool}
  zlecenieDrzewa: {},     // {zid: {polprodukty, materialy, operacje}}
  podzlecenieIds: new Set(), // ID zleceń które są podzleceniami P (ukryte z głównej listy)
  pmModal: null,          // {typ:'polprodukt'|'material', zid, item}
  podZlecenieModal: null, // {loading, zid, zlecenie, operacje, materialy}

  // Fakturowanie
  fakturyList: [],
  fakturyLoading: false,
  fakturaModal: null,
  fakturaPreview: null,
  fakturaForm: null,
  kontrahenciList: [],
  kontrahentModal: null,
  fakturySubTab: 'lista',
  fakturyFilterStatus: 'wszystkie',
  fakturyFilterRok: new Date().getFullYear(),

  // Drzewo G/P
  drzewoWyrobyG: [],
  drzewoWyrobyP: [],
  drzewoLoading: false,
  drzewoSelectedG: null,
  drzewoTree: null,
  drzewoTreeLoading: false,
  drzewoPanel: 'drzewo',     // drzewo | mrp | import | nowy
  drzewoSearch: '',
  drzewoZleceniaG: [],
  drzewoExpanded: {},        // {nodeKey: bool}
  drzewoMrp: null,
  drzewoMrpLoading: false,
  drzewoMrpView: 'zbiorczy', // zbiorczy | p-status | lista-zakupow | czasy
  drzewoImportResult: null,
  drzewoImportError: null,
  drzewoImportUploading: false,
  drzewoNowyForm: null,      // {symbol,nazwa,typ,jednostka,numer_rysunku} | null
  drzewoZleceniaP: [],       // zlecenia P powiązane z aktualnym G (przez zapotrzebowania)
  drzewoZleceniaPLoading: false,

  // Karta zlecenia – modal wyboru rodzaju wydruku
  kartaModal: null,          // null | {zlecenie, mode} – mode: 'choice'|'whole'|'partial'|'materials'
  kartaSubZlecenia: [],      // lista podzleceń G+P do wydruku karty
  kartaSubLoading: false,
  kartaSelectedSub: null,    // wybrane podzlecenie do karty częściowej

  // Nowe modale: równoległa obróbka + zmiana maszyny
  parallelModal: null,       // {operacjaId, stanowisko, aktywne:[]} – drugi scan uruchomionej op
  zmianaMaszynyModal: null,  // {operacjaId, stanowiskoOryginalne, stanowiskoLista:[]}

  // ── Patch 1: autocomplete historii zleceń w wizardzie ───────────────────────
  nzFromHistory: null,       // {id, numer, nazwa} | null – załadowany szablon z historii

  // ── Patch 3: widok priorytetów dla majstra ───────────────────────────────────
  majsterPriorytety: (function(){ try{ return JSON.parse(localStorage.getItem('majster_priorytety')||'{}'); }catch(e){return {};} })(),
  majsterPriorFilter: 'all',      // 'all' | 'opoznione' | 'dzis' | 'bez_op'
  majsterSesjeAktywne: [],        // cache sesji wszystkich pracowników dla widoku priorytetów
};

function setState(p, noRender) {
  state = {...state, ...p};
  if (!noRender) render();
}

// Otwiera/zamyka formularz bez pełnego re-renderu – naprawia problem z klawiaturą na mobile
function showPanel(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = ''; requestAnimationFrame(() => { const inp = el.querySelector('input'); if(inp) inp.focus(); }); }
}
function hidePanel(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
