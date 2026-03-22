/**
 * Seed the ÚOOÚ database with sample decisions and guidelines for testing.
 *
 * Includes real ÚOOÚ decisions (O2 Czech Republic, Avast, Mall Group)
 * and representative guidance documents so MCP tools can be tested without
 * running a full data ingestion pipeline.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["UOOU_DB_PATH"] ?? "data/uoou.db";
const force = process.argv.includes("--force");

// --- Bootstrap database ------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Topics ------------------------------------------------------------------

interface TopicRow {
  id: string;
  name_cs: string;
  name_en: string;
  description: string;
}

const topics: TopicRow[] = [
  {
    id: "consent",
    name_cs: "Souhlas",
    name_en: "Consent",
    description: "Získání, platnost a odvolání souhlasu se zpracováním osobních údajů (čl. 7 GDPR).",
  },
  {
    id: "cookies",
    name_cs: "Cookies a sledovací technologie",
    name_en: "Cookies and trackers",
    description: "Ukládání a čtení cookies a sledovacích technologií na zařízeních uživatelů.",
  },
  {
    id: "transfers",
    name_cs: "Předávání dat do třetích zemí",
    name_en: "International transfers",
    description: "Předávání osobních údajů do třetích zemí nebo mezinárodním organizacím (čl. 44–49 GDPR).",
  },
  {
    id: "dpia",
    name_cs: "Posouzení vlivu na ochranu osobních údajů (DPIA)",
    name_en: "Data Protection Impact Assessment (DPIA)",
    description: "Posouzení rizik pro práva a svobody osob při zpracování s vysokým rizikem (čl. 35 GDPR).",
  },
  {
    id: "breach_notification",
    name_cs: "Porušení zabezpečení osobních údajů",
    name_en: "Data breach notification",
    description: "Oznamování porušení zabezpečení ÚOOÚ a dotčeným osobám (čl. 33–34 GDPR).",
  },
  {
    id: "privacy_by_design",
    name_cs: "Ochrana soukromí od návrhu",
    name_en: "Privacy by design",
    description: "Zohledňování ochrany osobních údajů od návrhu a standardně (čl. 25 GDPR).",
  },
  {
    id: "cctv",
    name_cs: "Kamerové systémy",
    name_en: "CCTV and video surveillance",
    description: "Kamerové sledovací systémy v veřejných a soukromých prostorech v souladu s GDPR.",
  },
  {
    id: "health_data",
    name_cs: "Zdravotní údaje",
    name_en: "Health data",
    description: "Zpracování zdravotních údajů — zvláštní kategorie vyžadující posílené záruky (čl. 9 GDPR).",
  },
  {
    id: "children",
    name_cs: "Údaje dětí",
    name_en: "Children's data",
    description: "Ochrana osobních údajů dětí, zejména v online službách (čl. 8 GDPR).",
  },
];

const insertTopic = db.prepare(
  "INSERT OR IGNORE INTO topics (id, name_cs, name_en, description) VALUES (?, ?, ?, ?)",
);

for (const t of topics) {
  insertTopic.run(t.id, t.name_cs, t.name_en, t.description);
}

console.log(`Inserted ${topics.length} topics`);

// --- Decisions ---------------------------------------------------------------

interface DecisionRow {
  reference: string;
  title: string;
  date: string;
  type: string;
  entity_name: string;
  fine_amount: number | null;
  summary: string;
  full_text: string;
  topics: string;
  gdpr_articles: string;
  status: string;
}

const decisions: DecisionRow[] = [
  // ÚOOÚ — O2 Czech Republic — telemarketing
  {
    reference: "UOOU-00350/22-28",
    title: "Rozhodnutí ÚOOÚ — O2 Czech Republic a.s. (nevyžádaná obchodní sdělení)",
    date: "2022-10-05",
    type: "sanction",
    entity_name: "O2 Czech Republic a.s.",
    fine_amount: 2_500_000,
    summary:
      "ÚOOÚ uložil O2 Czech Republic pokutu 2 500 000 Kč za zasílání nevyžádaných obchodních sdělení zákazníkům bez platného souhlasu a za nedostatečné mechanismy pro evidenci a respektování odvolání souhlasu.",
    full_text:
      "Úřad pro ochranu osobních údajů (ÚOOÚ) provedl šetření u O2 Czech Republic a.s. na základě stížností zákazníků, kteří dostávali nevyžádaná obchodní sdělení a marketingová volání i poté, co odvolali souhlas nebo vznesli námitku. ÚOOÚ zjistil tato porušení: (1) Zpracování pro marketingové účely bez platného souhlasu — O2 kontaktovalo zákazníky, kteří odvolali souhlas se zasíláním obchodních sdělení, nebo kteří souhlas nikdy nevyjádřili způsobem splňujícím požadavky čl. 7 GDPR; (2) Nedostatečná evidence souhlasů — O2 nevedlo záznamy souhlasů v podobě, která by umožnila prokázat, kdy a jak byl souhlas udělen; (3) Technická selhání při respektování odvolání souhlasu — systémy O2 neumožňovaly okamžité zastavení marketingové komunikace po odvolání souhlasu; zákazníci byli kontaktováni ještě týdny po odvolání souhlasu. ÚOOÚ uložil pokutu 2 500 000 Kč a nařídil O2 uvést mechanismy evidence a respektování souhlasů do souladu s GDPR.",
    topics: JSON.stringify(["consent"]),
    gdpr_articles: JSON.stringify(["6", "7", "17", "21"]),
    status: "final",
  },
  // ÚOOÚ — Avast — browser data
  {
    reference: "UOOU-05117/19-4",
    title: "Rozhodnutí ÚOOÚ — Avast Software s.r.o. (prodej dat z prohlížeče)",
    date: "2020-02-11",
    type: "decision",
    entity_name: "Avast Software s.r.o.",
    fine_amount: null,
    summary:
      "ÚOOÚ zahájil šetření u Avast Software v souvislosti s prodejem dat o chování uživatelů antivirového softwaru a rozšíření prohlížeče třetím stranám prostřednictvím dceřiné společnosti Jumpshot. Avast shromažďoval podrobná data o historii prohlížení uživatelů bez jejich dostatečného informování a souhlasu.",
    full_text:
      "Úřad pro ochranu osobních údajů zahájil šetření Avast Software s.r.o. poté, co investigativní reportáže odhalily, že Avast prostřednictvím dceřiné společnosti Jumpshot prodával detailní data o chování uživatelů internetu inzerentům a analytickým společnostem. Data zahrnovala: historii prohlížení (navštívené URL adresy), vyhledávací dotazy, produkty zobrazené na e-commerce stránkách, přístupy ke zdravotním a finančním webům. ÚOOÚ zjistil: (1) Nedostatečné informování — uživatelé antiviru a rozšíření prohlížeče Avast Online Security nebyli dostatečně informováni, že jejich data z prohlížení budou prodávána třetím stranám; souhlas s prohlášením o ochraně osobních údajů byl bundlovaný s instalací softwaru; (2) Soulad se zásadou účelového omezení — data shromážděná za účelem bezpečnosti (detekce hrozeb) byla použita pro zcela jiný účel (komerční analýza chování); toto použití nebylo slučitelné s původním účelem ve smyslu čl. 5(1)(b) GDPR; (3) Právní základ — na základě šetření ÚOOÚ, Avast ukončil prodej dat prostřednictvím Jumpshot v lednu 2020 a Jumpshot byl zlikvidován. Avast přijal nápravná opatření a ÚOOÚ šetření uzavřel.",
    topics: JSON.stringify(["transfers", "consent", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["5", "6", "13"]),
    status: "final",
  },
  // ÚOOÚ — Mall Group — data breach
  {
    reference: "UOOU-00712/21-6",
    title: "Rozhodnutí ÚOOÚ — Mall Group a.s. (porušení zabezpečení dat zákazníků)",
    date: "2021-09-16",
    type: "sanction",
    entity_name: "Mall Group a.s.",
    fine_amount: 600_000,
    summary:
      "ÚOOÚ uložil Mall Group pokutu 600 000 Kč za porušení zabezpečení osobních údajů zákazníků e-shopu mall.cz a za opožděné oznámení tohoto porušení Úřadu.",
    full_text:
      "Úřad pro ochranu osobních údajů provedl šetření u Mall Group a.s. po hlášení o porušení zabezpečení dat zákazníků e-shopu mall.cz. Porušení se týkalo osobních údajů tisíců zákazníků. ÚOOÚ zjistil: (1) Nedostatečná technická bezpečnostní opatření — databáze zákazníků nebyla chráněna odpovídajícím způsobem; záznamy obsahovaly hesla uložená v nedostatečně zabezpečené formě; (2) Opožděné oznámení — Mall Group oznámilo porušení zabezpečení ÚOOÚ 9 dní po jeho zjištění, přičemž zákonná lhůta je 72 hodin; oznámení nebylo úplné a neobsahovalo všechny informace vyžadované čl. 33(3) GDPR; (3) Neoznámení dotčeným zákazníkům — navzdory tomu, že porušení mohlo představovat vysoké riziko pro práva a svobody zákazníků (kompromitace přihlašovacích údajů), Mall Group neoznámilo porušení dotčeným zákazníkům. ÚOOÚ uložil pokutu 600 000 Kč a nařídil Mall Group implementovat odpovídající technická bezpečnostní opatření a zlepšit postupy pro řízení a oznamování bezpečnostních incidentů.",
    topics: JSON.stringify(["breach_notification", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["32", "33", "34"]),
    status: "final",
  },
  // ÚOOÚ — Czech Social Insurance Administration — excessive retention
  {
    reference: "UOOU-06188/20-5",
    title: "Rozhodnutí ÚOOÚ — Česká správa sociálního zabezpečení (nadměrná doba uchování)",
    date: "2020-11-25",
    type: "reprimand",
    entity_name: "Česká správa sociálního zabezpečení",
    fine_amount: null,
    summary:
      "ÚOOÚ vydal napomenutí České správě sociálního zabezpečení za uchování osobních údajů žadatelů o dávky po dobu výrazně přesahující zákonem stanovené lhůty a za nedostatečnou dokumentaci lhůt pro uchování.",
    full_text:
      "Úřad pro ochranu osobních údajů provedl šetření u České správy sociálního zabezpečení (ČSSZ) v souvislosti se stížností osoby, jejíž osobní údaje byly ČSSZ uchovávány i po uplynutí zákonem stanovené doby. ÚOOÚ zjistil: (1) Překročení zákonných lhůt uchování — ČSSZ uchovávala spisy žadatelů o invalidní důchod a nemocenské dávky déle, než stanoví příslušné právní předpisy; zákonné lhůty uchování pro tyto spisy jsou stanoveny Nařízením Evropského parlamentu a archivními předpisy; (2) Nedostatečná dokumentace lhůt uchování — ČSSZ nevedla záznamy o zpracování ve smyslu čl. 30 GDPR obsahující informace o lhůtách uchování pro různé kategorie zpracovávaných osobních údajů; (3) Absence systematického procesu skartace — ČSSZ neměla zaveden systém, který by automaticky identifikoval spisy, jejichž zákonná lhůta uchování uplynula. ÚOOÚ vydal napomenutí a nařídil ČSSZ zavést systém pro sledování a dodržování zákonných lhůt uchování.",
    topics: JSON.stringify(["privacy_by_design"]),
    gdpr_articles: JSON.stringify(["5", "30"]),
    status: "final",
  },
  // ÚOOÚ — Benefit Systems Czech — direct marketing
  {
    reference: "UOOU-03582/21-9",
    title: "Rozhodnutí ÚOOÚ — Benefit Systems Czech s.r.o. (přímý marketing)",
    date: "2021-07-14",
    type: "sanction",
    entity_name: "Benefit Systems Czech s.r.o.",
    fine_amount: 180_000,
    summary:
      "ÚOOÚ uložil Benefit Systems Czech pokutu 180 000 Kč za zasílání přímé marketingové komunikace zákazníkům bez platného právního základu a bez respektování vznesených námitek.",
    full_text:
      "Úřad pro ochranu osobních údajů provedl šetření u Benefit Systems Czech s.r.o. (operátor benefit karet MultiSport) na základě stížností zákazníků. ÚOOÚ zjistil: (1) Zpracování osobních údajů pro přímý marketing bez platného právního základu — Benefit Systems zasílal marketingovou komunikaci zákazníkům, kteří neposkytli souhlas, přičemž se odvolával na oprávněný zájem (čl. 6(1)(f) GDPR); ÚOOÚ shledal, že nebyl proveden test proporcionality (balancing test), který by prokázal, že oprávněné zájmy správce převažují nad zájmy dotčených osob; (2) Nerespektování námitek — zákazníci, kteří vznesli námitku proti přímému marketingu, byli nadále kontaktováni, v rozporu s čl. 21(3) GDPR; (3) Nepřiměřená frekvence komunikace — zákazníci dostávali marketingové e-maily v nadměrném počtu. ÚOOÚ uložil pokutu 180 000 Kč.",
    topics: JSON.stringify(["consent"]),
    gdpr_articles: JSON.stringify(["6", "21"]),
    status: "final",
  },
  // ÚOOÚ — Lékárna.cz — health data disclosure
  {
    reference: "UOOU-04237/22-10",
    title: "Rozhodnutí ÚOOÚ — Lékárna.cz s.r.o. (zpřístupnění zdravotních dat)",
    date: "2022-06-20",
    type: "sanction",
    entity_name: "Lékárna.cz s.r.o.",
    fine_amount: 350_000,
    summary:
      "ÚOOÚ uložil Lékárna.cz pokutu 350 000 Kč za zpřístupnění zdravotních údajů zákazníků (historií objednávek léků) třetím stranám bez souhlasu a za nedostatečné zabezpečení zvláštních kategorií osobních údajů.",
    full_text:
      "Úřad pro ochranu osobních údajů provedl šetření u provozovatele online lékárny Lékárna.cz s.r.o. po bezpečnostním incidentu, při němž došlo ke kompromitaci zákaznické databáze. ÚOOÚ zjistil: (1) Nedostatečné zabezpečení zvláštních kategorií osobních údajů — data zákazníků online lékárny obsahovala informace o objednávaných lécích, která lze považovat za zdravotní údaje ve smyslu čl. 4(15) a čl. 9 GDPR; přesto nebyla chráněna na úrovni odpovídající jejich citlivosti; (2) Absence posouzení vlivu na ochranu osobních údajů — zpracování zdravotních dat v rozsahu celé zákaznické databáze vyžadovalo provedení DPIA dle čl. 35 GDPR; DPIA provedena nebyla; (3) Únik dat — v důsledku bezpečnostního incidentu se objednávková historie zákazníků (obsahující informace o konkrétních lécích) dostala do rukou neoprávněných osob. ÚOOÚ uložil pokutu 350 000 Kč a nařídil provedení DPIA a implementaci šifrování databáze.",
    topics: JSON.stringify(["health_data", "dpia", "breach_notification"]),
    gdpr_articles: JSON.stringify(["9", "32", "33", "35"]),
    status: "final",
  },
  // ÚOOÚ — Real estate agency — identity documents
  {
    reference: "UOOU-02915/20-8",
    title: "Rozhodnutí ÚOOÚ — Realitní kancelář (kopírování dokladů totožnosti)",
    date: "2020-07-08",
    type: "reprimand",
    entity_name: "Realitní kancelář (anonymizováno)",
    fine_amount: null,
    summary:
      "ÚOOÚ vydal napomenutí realitní kanceláři za pořizování kopií dokladů totožnosti zájemců o pronájem bez zákonného oprávnění a bez splnění informační povinnosti.",
    full_text:
      "Úřad pro ochranu osobních údajů prošetřil stížnost fyzické osoby, které realitní kancelář odmítla zprostředkovat prohlídku bytu, pokud nepředloží kopii svého občanského průkazu. ÚOOÚ zjistil: (1) Absence zákonného oprávnění — pořizování a uchovávání kopií dokladů totožnosti zájemců o pronájem (kteří se ještě nestali nájemníky) nemá oporu v právním předpisu ani v smluvním vztahu; pravost totožnosti lze ověřit nahlédnutím do dokladu bez pořízení kopie; (2) Nepřiměřenost — pořizování kopie dokladu totožnosti v rané fázi prohlídky (před uzavřením smlouvy) je nepřiměřené účelu ověření totožnosti; (3) Nesplnění informační povinnosti — kancelář neposkytla zájemcům informace o zpracování jejich osobních údajů. ÚOOÚ vydal napomenutí a doporučil omezit zpracování na nahlédnutí do dokladu bez kopírování.",
    topics: JSON.stringify(["privacy_by_design", "consent"]),
    gdpr_articles: JSON.stringify(["5", "6", "13"]),
    status: "final",
  },
  // ÚOOÚ — Healthcare — CCTV in patient areas
  {
    reference: "UOOU-01148/23-5",
    title: "Rozhodnutí ÚOOÚ — Zdravotnické zařízení (kamerový systém v pacientských prostorech)",
    date: "2023-03-29",
    type: "sanction",
    entity_name: "Zdravotnické zařízení (anonymizováno)",
    fine_amount: 420_000,
    summary:
      "ÚOOÚ uložil zdravotnickému zařízení pokutu 420 000 Kč za provozování kamerového systému v čekárnách a vyšetřovnách bez DPIA, bez informačních tabulí a bez zákonného základu pro snímání zdravotní péče v soukromých prostorech.",
    full_text:
      "Úřad pro ochranu osobních údajů provedl kontrolu u zdravotnického zařízení, jehož kamerový systém pokrýval čekárny, chodby i vyšetřovny. ÚOOÚ zjistil: (1) Snímání zdravotní péče ve vyšetřovnách — kamerový systém zaznamenával i průběh vyšetření pacientů, čímž docházelo ke zpracování zvláštních kategorií osobních údajů (zdravotní data) bez odpovídajícího právního základu dle čl. 9(2) GDPR; (2) Absence DPIA — zdravotnické zařízení neprovedlo posouzení vlivu na ochranu osobních údajů, přestože zpracování představovalo vysoké riziko (snímání zdravotní péče, velký počet pacientů); (3) Chybějící nebo nedostatečné informační tabule — pacienti nebyli dostatečně informováni o kamerovém systému a účelech záznamu; (4) Nadměrná doba uchování — záznamy byly uchovávány 30 dní bez zdůvodnění. ÚOOÚ uložil pokutu 420 000 Kč, nařídil ukončení záznamu ve vyšetřovnách, provedení DPIA a instalaci řádných informačních tabulí.",
    topics: JSON.stringify(["cctv", "health_data", "dpia"]),
    gdpr_articles: JSON.stringify(["5", "6", "9", "13", "35"]),
    status: "final",
  },
];

const insertDecision = db.prepare(`
  INSERT OR IGNORE INTO decisions
    (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDecisionsAll = db.transaction(() => {
  for (const d of decisions) {
    insertDecision.run(
      d.reference,
      d.title,
      d.date,
      d.type,
      d.entity_name,
      d.fine_amount,
      d.summary,
      d.full_text,
      d.topics,
      d.gdpr_articles,
      d.status,
    );
  }
});

insertDecisionsAll();
console.log(`Inserted ${decisions.length} decisions`);

// --- Guidelines --------------------------------------------------------------

interface GuidelineRow {
  reference: string | null;
  title: string;
  date: string;
  type: string;
  summary: string;
  full_text: string;
  topics: string;
  language: string;
}

const guidelines: GuidelineRow[] = [
  {
    reference: "UOOU-GUIDE-COOKIES-2022",
    title: "Soubory cookies a podobné technologie sledování — metodický pokyn",
    date: "2022-07-01",
    type: "guideline",
    summary:
      "Metodický pokyn ÚOOÚ k používání souborů cookies a obdobných technologií sledování na webových stránkách a v mobilních aplikacích. Obsahuje požadavky na souhlas, výjimky pro nezbytné cookies a návod pro návrh informačních lišt (cookie bannerů).",
    full_text:
      "Úřad pro ochranu osobních údajů vydal metodický pokyn k ukládání souborů cookies a přístupu k informacím uloženým na koncovém zařízení uživatele ve světle GDPR a § 89 zákona č. 127/2005 Sb., o elektronických komunikacích. Právní základ: Ukládání souborů cookies a podobných technologií sledování vyžaduje předchozí souhlas uživatele dle čl. 7 GDPR, s výjimkou nezbytně nutných cookies. Požadavky na platný souhlas: (1) Dobrovolnost — souhlas musí být vyjádřen svobodně; podmínění přístupu ke službě souhlasem se sledovacími cookies (tzv. cookie wall) je zpravidla nepřípustné; (2) Konkrétnost — souhlas musí být udělen zvlášť pro každý účel (analytické cookies, reklamní cookies, cookies sociálních sítí); (3) Jednoznačnost — souhlas musí být vyjádřen jasným aktivním jednáním (kliknutím na tlačítko); zaškrtnutá políčka ve výchozím stavu jsou zakázána; (4) Odmítnutí musí být stejně snadné jako přijetí — tlačítko pro odmítnutí cookies musí být stejně prominentní jako tlačítko pro přijetí. Výjimky: soubory relace, koše nákupního košíku, přihlašovací soubory, soubory pro bezpečnostní účely. ÚOOÚ upozorňuje na nepřijatelné praktiky: tmavé vzory (dark patterns), skrytá tlačítka pro odmítnutí, víceúrovňové menu pro odmítnutí.",
    topics: JSON.stringify(["cookies", "consent"]),
    language: "cs",
  },
  {
    reference: "UOOU-GUIDE-KAMERA-2021",
    title: "Provozování kamerových systémů — praktický průvodce",
    date: "2021-04-14",
    type: "guideline",
    summary:
      "Praktický průvodce ÚOOÚ k provozování kamerových systémů v souladu s GDPR. Zahrnuje právní základ, informační povinnosti, doby uchovávání záznamů a zvláštní pravidla pro pracoviště, veřejný prostor a komerční prostory.",
    full_text:
      "Úřad pro ochranu osobních údajů vydal praktický průvodce k provozování kamerových systémů (CCTV) ve světle nařízení GDPR. Právní základ: Soukromoprávní subjekty mohou provozovat kamerový systém na základě oprávněného zájmu (čl. 6(1)(f) GDPR) za podmínky provedení testu proporcionality; veřejné orgány se opírají o výkon veřejné moci (čl. 6(1)(e) GDPR). Informační povinnosti: Na vstupu do sledovaného prostoru musí být umístěna viditelná tabule obsahující: název správce, účel záznamu, dobu uchování, kontaktní údaje. Doby uchovávání: Záznamy by neměly být uchovávány déle než 72 hodin, pokud nebyl detekován konkrétní bezpečnostní incident; v odůvodněných případech lze prodloužit na 7 dnů. Pracoviště: Kamerové systémy na pracovišti musí být projednány se zástupci zaměstnanců; zaměstnanci musí být informováni; skrytá kamera je zakázána s výjimkou odůvodněných případů s předchozí konzultací s ÚOOÚ. Zakázaná místa: šatny, toalety, sprchy, kojicí koutky. DPIA: Pro kamerové systémy v rozsáhlých prostorech přístupných veřejnosti nebo systémy sledující zaměstnance je zpravidla nutné posouzení vlivu na ochranu osobních údajů.",
    topics: JSON.stringify(["cctv", "dpia", "privacy_by_design"]),
    language: "cs",
  },
  {
    reference: "UOOU-GUIDE-DPIA-2020",
    title: "Posouzení vlivu na ochranu osobních údajů — metodický pokyn",
    date: "2020-09-10",
    type: "guideline",
    summary:
      "Metodický pokyn ÚOOÚ k provádění posouzení vlivu na ochranu osobních údajů (DPIA) dle čl. 35 GDPR. Obsahuje seznam zpracování vyžadujících povinné DPIA, třístupňovou metodiku a dokumentační požadavky.",
    full_text:
      "Úřad pro ochranu osobních údajů vydal metodický pokyn k posouzení vlivu na ochranu osobních údajů (DPIA) dle čl. 35 GDPR. DPIA je povinné, pokud je pravděpodobné, že zpracování bude mít za následek vysoké riziko pro práva a svobody fyzických osob. Povinné případy DPIA: systematické a rozsáhlé vyhodnocování osobních hledisek fyzických osob, zejména profilování; zpracování zvláštních kategorií osobních údajů ve velkém rozsahu; systematické sledování veřejně přístupného prostoru ve velkém rozsahu. ÚOOÚ vydal seznam druhů zpracování, které vyžadují posouzení vlivu. Třístupňová metodika: (1) Popis zamýšleného zpracování — účely, popis datových toků, popis bezpečnostních opatření; (2) Posouzení nezbytnosti a přiměřenosti zpracování — zákonnost, proporcionalita, informační povinnost; (3) Posouzení rizik pro práva a svobody subjektů údajů — identifikace scénářů rizik (neoprávněný přístup, nežádoucí modifikace, ztráta), posouzení závažnosti a pravděpodobnosti, identifikace opatření ke zmírnění rizik. Pokud zpracování navzdory opatřením přináší vysoké zbytkové riziko, je správce povinen konzultovat ÚOOÚ před zahájením zpracování.",
    topics: JSON.stringify(["dpia", "privacy_by_design"]),
    language: "cs",
  },
];

const insertGuideline = db.prepare(`
  INSERT INTO guidelines (reference, title, date, type, summary, full_text, topics, language)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertGuidelinesAll = db.transaction(() => {
  for (const g of guidelines) {
    insertGuideline.run(
      g.reference,
      g.title,
      g.date,
      g.type,
      g.summary,
      g.full_text,
      g.topics,
      g.language,
    );
  }
});

insertGuidelinesAll();
console.log(`Inserted ${guidelines.length} guidelines`);

// --- Summary -----------------------------------------------------------------

const decisionCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
).cnt;
const guidelineCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }
).cnt;
const topicCount = (
  db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }
).cnt;
const decisionFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions_fts").get() as { cnt: number }
).cnt;
const guidelineFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Topics:         ${topicCount}`);
console.log(`  Decisions:      ${decisionCount} (FTS entries: ${decisionFtsCount})`);
console.log(`  Guidelines:     ${guidelineCount} (FTS entries: ${guidelineFtsCount})`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
