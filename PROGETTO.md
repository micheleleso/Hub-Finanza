# Hub Finanza — documentazione di progetto

> **Per chi lavora su questo progetto (persone o AI: Claude, ChatGPT/Codex, altri):**
> leggi questo file prima di toccare il codice e **aggiornalo ogni volta che cambi qualcosa**
> (vedi «Registro modifiche» in fondo). Così chi arriva dopo sa cosa è stato fatto e perché.

Ultimo aggiornamento di questo file: 2026-11-16 (Claude: versione 3.0, budget mensile personalizzabile).

---

## 1. Cos'è
App personale di finanza, gratuita, che gira nel browser (PC e smartphone) ed è installabile come PWA.
Nasce come evoluzione di un tracker in Google Fogli (fogli IMPOSTAZIONI, TRANSAZIONI, ANALISI MENSILE, INVESTIMENTI).
L'utente **non è uno sviluppatore**: spiegare i passaggi uno per uno, in italiano, senza dare per scontato nulla.
Interfaccia e messaggi sono **in italiano**.

## 2. Regole tecniche (non cambiare senza chiedere)
- Un solo file applicativo: `index.html` con HTML5, Tailwind CSS via CDN e **JavaScript vanilla (ES6+)**. Niente React/Node/build step.
- Database e autenticazione: **Supabase** (client ufficiale via CDN). Dati unici condivisi tra tutti i dispositivi dell'utente.
- Se `SUPABASE_URL` o `SUPABASE_ANON_KEY` sono vuote, l'app parte in **modalità demo** con dati di esempio in `localStorage`.
- Tema **Dark Mode fintech**: sfondo `#0b0f19`, superfici `#111827`, bordi `slate-800`, accento menta `#29FFC2`.
- Mobile-first: barra di navigazione in basso su mobile, sidebar a sinistra su desktop, tasto flottante `+` sempre sopra la barra.

## 3. Librerie (tutte via CDN, versioni fissate)
| Libreria | Versione | Note |
|---|---|---|
| Tailwind CSS (Play CDN) | `cdn.tailwindcss.com` | colori custom in `tailwind.config`: `bg`, `surf`, `mint` |
| Chart.js | 4.4.1 (jsdelivr) | ciambella Necessità/Casuale nell'Analisi |
| @supabase/supabase-js | 2.109.0 (jsdelivr, UMD) | **serve una versione recente**: la 2.45.4 usata all'inizio è troppo vecchia per le chiavi `sb_publishable_…` |

## 4. File del repository
| File | Scopo |
|---|---|
| `index.html` | **Tutta l'app** (HTML + CSS + JS inline) |
| `manifest.webmanifest` | Manifest PWA (tema scuro, icona SVG incorporata) |
| `sw.js` | Service worker minimo: network-first con fallback sulla cache; non mette in cache le chiamate a Supabase |
| `schema.sql` | Schema del database da eseguire nell'SQL Editor di Supabase (riportato anche al §6) |
| `migration_budget.sql` | Script da eseguire **una volta** su Supabase per creare la tabella `budget_settings` (budget mensile personalizzabile) |
| `PROGETTO.md` | Questo file |
| `README.md` | Creato da GitHub |

## 5. Configurazione e sicurezza
- In cima allo script di `index.html`: `SUPABASE_URL` e `SUPABASE_ANON_KEY` (qui va la chiave **publishable** `sb_publishable_…`, pensata per stare nel browser; la sicurezza dei dati è garantita da login + RLS).
- **Non mettere mai** la *secret key* di Supabase nel repo, in chat o nel codice (in passato è stata incollata in chat per errore ed è stata ruotata).
- Il repository GitHub è **pubblico** (necessario per GitHub Pages gratuito): nel codice non deve esserci nulla di segreto.
- Login con email + password (Supabase Auth) e **email di conferma**. In Supabase, Authentication → URL Configuration:
  *Site URL* e *Redirect URLs* devono coincidere con l'indirizzo pubblicato (GitHub Pages), altrimenti il link nella mail non funziona.
- `localStorage`: chiave `hub_finanza_demo` (dati demo) e `hub_imported` (flag: dati locali già importati nel database).

## 6. Schema del database (Supabase)
Tutte le tabelle hanno **RLS attiva**: ogni utente vede e modifica solo le righe con `user_id = auth.uid()`.
`user_id` si compila da solo (`default auth.uid()`), il client non lo invia.

```sql
-- =====================================================================
-- HUB FINANZA PERSONALE - Fase 1
-- Incolla tutto nel SQL Editor di Supabase ed esegui (Run).
-- Ogni utente vede e modifica SOLO i propri dati (Row Level Security).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- CONTI ----------
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  type            text not null check (type in ('cash','card','savings','investment')),
  initial_balance numeric(14,2) not null default 0,
  color           text default '#4f46e5',
  created_at      timestamptz not null default now()
);

-- ---------- CATEGORIE ----------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  type           text not null check (type in ('income','expense')),
  icon           text default '🏷️',
  color          text default '#64748b',
  monthly_budget numeric(14,2),                -- opzionale
  created_at     timestamptz not null default now()
);

-- ---------- TRANSAZIONI ----------
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  to_account_id uuid references public.accounts(id) on delete cascade,   -- solo trasferimenti
  category_id   uuid references public.categories(id) on delete set null,
  type          text not null check (type in ('income','expense','transfer','refund')),
  amount        numeric(14,2) not null check (amount > 0),
  is_necessary  boolean,                        -- true = Necessaria, false = Casuale (solo uscite)
  date          date not null default current_date,
  description   text,
  notes         text,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  constraint transactions_category_required check (type = 'transfer' or category_id is not null),
  constraint transfer_consistency check (
    (type = 'transfer' and to_account_id is not null and to_account_id <> account_id)
    or (type <> 'transfer' and to_account_id is null)
  )
);

create index if not exists idx_tx_user_date on public.transactions (user_id, date desc);
create index if not exists idx_tx_account   on public.transactions (account_id);
create index if not exists idx_tx_category  on public.transactions (category_id);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;

create policy "accounts: solo i propri" on public.accounts
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories: solo le proprie" on public.categories
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per le transazioni controlliamo anche che i conti collegati siano dell'utente
create policy "transactions: solo le proprie" on public.transactions
  for all to authenticated
  using (
    auth.uid() = user_id
    and (category_id is null or exists (
      select 1 from public.categories c where c.id = transactions.category_id and c.user_id = auth.uid()
    ))
  )
  with check (
    auth.uid() = user_id
    and (category_id is null or exists (
      select 1 from public.categories c where c.id = transactions.category_id and c.user_id = auth.uid()
    ))
    and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())
    and (to_account_id is null or exists (select 1 from public.accounts a where a.id = to_account_id and a.user_id = auth.uid()))
  );
```

Nota sul progetto live: il vincolo `transactions_category_required` è stato aggiunto come `NOT VALID` per preservare una transazione storica senza categoria; continua comunque a controllare nuove righe e righe modificate. Dalla versione 2.6 `Riconcilia saldo` crea la rettifica con la categoria «Rettifica saldo» (creata al bisogno, una per Entrata e una per Uscita), quindi rispetta il vincolo.

### Tabella `budget_settings` (aggiunta con la v3.0, script `migration_budget.sql`)
Una riga per utente (`user_id` unico, `default auth.uid()`), RLS attiva: `needs_pct` (Necessità), `wants_pct` (Casuale), `savings_pct` (Risparmio) con vincolo **somma = 100**, e `expected_income` (entrata mensile prevista, facoltativa). Default 50/30/20.

### Regole del modello dati
- `accounts.type`: `cash`, `card`, `savings`, `investment`.
- `categories.type`: `income` o `expense`; `monthly_budget` è opzionale.
- `transactions.type`: `income`, `expense`, `transfer`, `refund`; `amount` è sempre **positivo**.
- `is_necessary`: solo per le uscite (`true` = **Necessità**, `false` = **Casuale**); `null` per gli altri tipi e per le rettifiche.
- **Trasferimento**: ha `to_account_id`, nessuna categoria; non conta come entrata né come uscita.
- **Rimborso**: collegato a una categoria di spesa; aumenta il saldo del conto e **riduce** la spesa di quella categoria.
- **Conti Investimenti**: si contano al **capitale versato** (saldo iniziale + trasferimenti); le rettifiche su questi conti vengono ignorate e «Riconcilia saldo» non è disponibile. Nessuna plusvalenza non realizzata.
- **Rettifica di saldo** (Riconcilia): transazione `income`/`expense` per la differenza, con tag `rettifica`, descrizione «Rettifica saldo»; **esclusa dai KPI mensili**.

### Logica contabile (in `index.html`, funzione `balance(a)`)
`saldo = saldo_iniziale + entrate + rimborsi − uscite − trasferimenti in uscita + trasferimenti in entrata`

Card della Dashboard: **Contanti** = conti `cash` + `savings`; **Carte** = `card`; **Investimenti** = `investment`; **Patrimonio** = somma dei tre.
KPI di Analisi: *Uscite nette* = uscite − rimborsi; *Risparmio* = entrate − uscite nette; *Tasso di risparmio* = risparmio / entrate.

## 7. Come è fatta l'app (`index.html`)
**Stato globale**: `S = {accounts, categories, transactions}`; `V` = filtri della scheda Transazioni (mese `''` = tutti, anno, tipo, conto, ricerca); `A` = mese/anno dell'Analisi; `T` = tipo transazione del modulo.

**Dati**
- `load()`: legge da localStorage (demo) o da Supabase; al primo accesso crea le categorie di default.
- `ins()`, `upd()`, `del()`, `rmTx()`: inserimento, modifica e cancellazione; le scritture Supabase passano per la coda `Q` e, in caso di errore, i dati vengono ricaricati. In modalità Supabase le scritture passano per una **coda** (`Q`) così i conti vengono salvati prima delle transazioni che li usano.
- Gli id sono UUID generati dal client (`uid()`, con alternativa se `crypto.randomUUID` non esiste: succede su `http://IP`).
- Sincronizzazione tra dispositivi: ricarica i dati al ritorno sulla scheda e ogni 15 secondi (salta se l'utente sta scrivendo o c'è un modale aperto).
- `importLocal()`: importa nel database i dati salvati in localStorage (con nuovi id).

**Interfaccia**
- Schede: **Dashboard**, **Transazioni**, **Analisi**, **Patrimonio & Calendario** (segnaposto). Email e stato Supabase sono nel piè di pagina della sidebar desktop.
- `render()` ridisegna la scheda corrente; `modal()` / `closeModal()` per i pannelli; `dateSel()` crea i due menu **Mese + Anno** (mese in italiano, «Tutti i mesi» solo in Transazioni).
- Tutto il testo inserito dall'utente passa da `esc()` (protezione dall'HTML iniettato).
- Errori JavaScript visibili in una barra rossa (`showFatal`); sulla schermata di accesso una riga verifica il collegamento a Supabase e mostra la versione (`APP_VERSION`).

**Dashboard**: 4 card riepilogative, conti con «Riconcilia saldo», modifica/eliminazione, ultimi 5 movimenti.
**Transazioni**: pulsante flottante  (Entrata, Uscita, Trasferimento, Rimborso), lista filtrabile e modificabile/eliminabile. Il menu «Gestisci categorie» è sopra la lista; da lì si vedono, creano, modificano ed eliminano categorie. Conti e categorie sono indipendenti.
**Analisi**: KPI del mese/anno selezionati, entrate e uscite nette per categoria, confronto dei budget mensili e ciambella Necessità/Casuale. Il tasso di risparmio è mensile; non c'è un grafico di andamento annuale.
**Moduli**: modifica/eliminazione di conti, categorie e movimenti; non si eliminano conti o categorie ancora usati. Le uscite hanno menu «Necessità» / «Casuale». Selezione emoji con pulsante quadrato e pannello interno; il colore si seleziona dal quadratino.

## 8. Pubblicazione
- Ospitata su **GitHub Pages** (repo pubblico, ramo `main`, cartella radice). Indirizzo del tipo `https://UTENTE.github.io/hub-finanza/`.
- **Come aggiornare**: nel repo su GitHub → *Add file* → *Upload files* → trascinare il nuovo `index.html` (stesso nome esatto, senza «(1)») → *Commit changes*. Dopo circa un minuto l'app è aggiornata; sul telefono ricaricare la pagina.
- Cloudflare Drop/Pages è stato provato e **abbandonato**: dal telefono l'indirizzo non si apriva (ipotesi non confermata: blocchi di rete sugli indirizzi Cloudflare in Italia). Non riproporlo senza motivo.
- Idea futura: pubblicazione automatica con Claude Code / GitHub (vedi §11).

## 9. Problemi incontrati e soluzioni (da non ripetere)
- `crypto.randomUUID` non esiste su `http://192.168.x.x` (contesto non sicuro) → c'è un'alternativa in `uid()`.
- `localStorage` è separato per browser, indirizzo e porta → i dati demo non si sincronizzano: per dati unici serve Supabase.
- L'anteprima della chat di Claude **non può raggiungere Supabase** («Failed to fetch» lì è normale): provare l'app dal PC aprendo il file o da GitHub Pages.
- «Anonymous sign-ins are disabled» = il pulsante «Crea account» era premuto con i campi vuoti → ora `reportValidity()` blocca l'invio.
- Il browser rinomina i file scaricati («index (1).html») e il doppio clic apriva la copia vecchia → controllare sempre il numero di versione in pagina.
- Il servizio email predefinito di Supabase ha pochissimi invii all'ora e consegna solo ai membri del progetto.
- Su GitHub vanno caricati i **file**, non la cartella che li contiene; `index.html` deve stare al primo livello.

## 10. Cronologia versioni
| Versione | Cosa |
|---|---|
| 1.0 | Fase 1: schema SQL con RLS, Dashboard e Transazioni, Analisi base, segnaposto Patrimonio; modalità demo; tema chiaro |
| 2.0 | Tema Dark Mode fintech (#29FFC2), menu Mese + Anno, barra mobile con area sicura |
| 2.0+ | Ritorno a Supabase con login, scritture ottimistiche, sincronizzazione, importazione dati locali |
| 2.1–2.4 | Libreria Supabase 2.109.0, messaggi di errore in italiano, email di conferma con reinvio, riga di diagnostica, barra errori, controllo campi, testo «Caricamento…» |
| 2.6 | Correzione di «Riconcilia saldo»: la rettifica ora usa la categoria «Rettifica saldo» (il vincolo `transactions_category_required` rifiutava le rettifiche senza categoria). Controllata con un test automatico in modalità demo (dashboard, riconciliazione, form, analisi, selettore emoji: nessun errore JS); **non provata con Supabase reale** |
| 2.7 | Reinserito nell'Analisi il grafico **Andamento ultimi 6 mesi** (barre Entrate e Uscite nette + linea Risparmio, fino al mese selezionato; rettifiche escluse, rimborsi sottratti alle uscite). Provata con test automatico in modalità demo; **non provata con Supabase reale** |
| 2.8 | Grafico andamento reso più leggibile (su richiesta dell'utente, «opzione C»): **una sola linea** (risparmio mensile) con il mese selezionato evidenziato, legenda tolta, tooltip con risparmio/entrate/uscite/tasso, e **tabella compatta** sotto (mese, entrate, uscite, risparmio, tasso). Sempre **6 mesi** terminanti nel mese selezionato, anche se vuoti. Test automatico in modalità demo ok; non provata con Supabase reale |
| 2.9 | **Scheda Patrimonio** (al posto del segnaposto «Patrimonio & Calendario»; icona 📈): card Patrimonio/Liquidità/Investito, barra di composizione, grafico a linea a fine mese con scelta della serie (Totale/Liquidità/Investito) e dell'intervallo (6/12/24 mesi), etichette solo su primo/ultimo/minimo/massimo, tabella «Mostra valori» chiusa di default. Storico **ricalcolato dai movimenti** (`balanceAt`, `wealthSeries`), parte dal primo mese con dati. **Investimenti = solo capitale versato**: le rettifiche sui conti `investment` sono ignorate nei saldi e «Riconcilia saldo» è nascosto/bloccato su quei conti. Test automatico in modalità demo con dati su più mesi ok; non provata con Supabase reale |
| 3.0 | **Budget mensile personalizzabile** (stile 50/30/20) nell'Analisi: card «Budget del mese» dopo i KPI con tre righe (Necessità, Casuale, Risparmio), obiettivo % e valore reale, barre, «Ti restano / Superato di / Mancano»; modulo «Modifica» con preset (50/30/20, 60/20/20, 70/20/10, 80/10/10), tre percentuali libere che devono fare 100 e **entrata mensile prevista** facoltativa (se vuota si usano le entrate reali del mese). Salvataggio nella nuova tabella `budget_settings` (una riga per utente, RLS; script `migration_budget.sql`). Se la tabella non esiste l'app funziona lo stesso ma il budget non si salva. La card per categoria è stata rinominata «Budget per categoria». Test automatico in modalità demo ok; non provata con Supabase reale |
| 2.5 | Modifica/eliminazione di movimenti, conti e categorie; Analisi per categoria e budget mensile; selezione colore dal quadratino; menu «Necessità» / «Casuale»; selettore emoji a pulsante quadrato; email e stato sincronizzazione nella sidebar. Commit presenti su `main`; non provata in browser. |

## 11. Da fare (decisioni prese con l'utente il 2026-11-16)
L'utente vuole procedere **un passo alla volta**, senza implementare tutto insieme. Ordine concordato:

1. ✅ **Grafico andamento 6 mesi** in Analisi (fatto: v2.7, semplificato in v2.8 con linea del risparmio e tabella).
2. ✅ **Scheda Patrimonio** (fatta, v2.9; sostituisce il segnaposto «Patrimonio & Calendario»):
   - grafico **a linea mensile**, **ricalcolato dai movimenti** (saldo iniziale + movimenti fino a fine mese): nessun compito automatico sul server;
   - mostrare **liquidità** (cash + savings + carte) e **capitale investito**; **niente plusvalenze** (non sono garantite finché non ritirate): per i conti `investment` si conta solo quanto è stato versato (trasferimenti in entrata/uscita), si **nasconde «Riconcilia saldo»** su quei conti e si escludono dal grafico le eventuali rettifiche su di essi;
   - importi **discreti**: valori esatti al tocco, etichette solo su primo/ultimo/minimo/massimo, riga di mesi scorrevole in grigio con variazione sul mese prima, tasto «Mostra valori» per l'elenco completo.
3. ✅ **Budget personalizzabile** (fatto, v3.0): modello 50/30/20 come punto di partenza, ma l'utente sceglie le tre percentuali (Necessità / Casuale / Risparmio). Confronto con i mesi reali («sei al 62/25/13»), **senza AI**. Servirà una piccola tabella per le impostazioni (con RLS).
4. **Scheda Obiettivi** (diventa la 5ª scheda; nome provvisorio, il Calendario potrà entrarci in futuro):
   - ogni obiettivo ha nome, importo da raggiungere e un **grafico a torta che si riempie**;
   - modello **accantonamento**: i soldi restano sui conti veri, l'obiettivo è una quota messa da parte; «Aggiungi» e «Preleva» con storico, «Usa fondi» registra la spesa vera in Transazioni e scala l'obiettivo; **avviso** se la somma degli obiettivi supera la liquidità;
   - tabelle previste: `goals` e `goal_entries`, con RLS;
   - *da confermare con l'utente*: accantonamento (proposto) oppure obiettivo legato a un conto dedicato.

**Rimandati** (non fare senza richiesta dell'utente): consiglio AI sulla ripartizione, riepilogo con commento AI, **Calendario** (solo mese corrente, con tabella di ricorrenze), **calcolatore debiti** (l'utente deve ancora decidere com'è la pagina), foto automatiche di fine mese con `pg_cron`, sezione Investimenti con operazioni/prezzi, collegamenti bancari.

**Altro**: miglioramento grafica; esportazione/importazione JSON; pubblicazione automatica (Claude Code o GitHub);
**dividere `index.html` in più file più avanti** (con Claude Code): oggi non è un problema (il file è piccolo), serve per la manutenzione e per evitare che più AI sovrascrivano lo stesso file.

## 12. Come aggiornare questo file
Dopo ogni modifica aggiungi una riga al registro qui sotto (la più recente in alto) e, se serve, aggiorna le sezioni sopra
(librerie, regole del modello dati, cronologia versioni, «Da fare»). Aumenta `APP_VERSION` in `index.html` a ogni modifica,
perché serve a capire a colpo d'occhio quale versione è davvero online.

### Registro modifiche
| Data | Chi | Versione | Cosa è stato fatto | Note / da verificare |
|---|---|---|---|---|
| 2026-11-16 | Claude | 3.0 | Budget mensile 50/30/20 personalizzabile. Nuovi: `budgetCfg`, `budgetCard`, `budgetForm`, `budgetPreset`, `budgetSum`, `BUDGET_DEFAULT`, `BUDGET_PRESETS`, `S.budget_settings`, `budgetReady`; `load()` legge anche `budget_settings` (errore ignorato se la tabella manca). Nuovo file `migration_budget.sql`. | **L'utente deve eseguire `migration_budget.sql` su Supabase** prima di poter salvare le percentuali. Risparmio = entrate − uscite nette (rimborsi sottratti); Necessità e Casuale sono uscite lorde per tipo di spesa |
| 2026-11-16 | Claude | 2.9 | Nuova scheda Patrimonio; `balance(a)` ora = `balanceAt(a)` (che ignora le rettifiche sui conti Investimenti); nuove funzioni `balanceAt`, `wealthSeries`, `viewPat`, `setPat`, plugin `wealthLabels`; variabili `P`, `SER`, `chart3`, `eur0`. Dashboard: «Riconcilia saldo» nascosto sui conti Investimenti. | Per far salire/scendere il valore di un investimento si usano solo i trasferimenti (capitale versato). Il tab 4 si chiama ora solo «Patrimonio»: il Calendario è rimandato |
| 2026-11-16 | Claude | 2.8 | Analisi: grafico andamento ridisegnato (linea del risparmio + tabella). Funzioni/variabili coinvolte: `monthSummary`, `chart2`, `rateOf`, blocco `months`/`tr` in `viewAn`. | Il nome `rate` era già usato per il tasso di risparmio del mese: non riutilizzarlo |
| 2026-11-16 | Claude | 2.7 | Grafico «Andamento ultimi 6 mesi» in Analisi (funzione `monthSummary`, variabile `chart2`). Basato sul `index.html` 2.6 (Codex + fix riconciliazione). | Se nel frattempo `index.html` è cambiato con altri strumenti, confrontare prima di sovrascrivere |
| 2026-11-14 | Claude | 2.6 | Revisione del `index.html` di Codex (sintassi ok). Fix «Riconcilia saldo» con categoria «Rettifica saldo». Il resto del codice di Codex è invariato. | Provare con Supabase reale: riconcilia un conto e controlla che la rettifica compaia nei movimenti ma non nei KPI. La categoria «Rettifica saldo» compare nell'elenco categorie e nei menu: è voluto, non eliminarla finché ci sono rettifiche. Il grafico dell'andamento mensile (presente nella mia 2.5) resta rimosso |
| 2026-11-14 | ChatGPT/Codex | 2.5 | RLS verifica categoria proprietaria; categoria resa obbligatoria per movimenti non trasferimenti; UI con messaggio dedicato; modifica/eliminazione per movimenti, conti e categorie; analisi per categoria e budget; menu categorie sopra i movimenti; emoji a pulsante, menu Necessità/Casuale, colore da quadratino; email in sidebar; rimosso grafico andamento mensile. | Modifiche su `main`; nessun test browser. Una rettifica di saldo senza categoria è incompatibile col nuovo vincolo e va corretta. |
