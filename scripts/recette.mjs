// ═══════════════════════════════════════════════════════════════════════════
// Recette Supabase — copier la structure de la production, puis comparer
// ═══════════════════════════════════════════════════════════════════════════
//
//   node scripts/recette.mjs comparer   → confronte production et recette
//   node scripts/recette.mjs sql        → imprime le script de copie (rien n'est écrit)
//   node scripts/recette.mjs copier     → applique ce script à la recette (vide)
//
// Variables : SUPABASE_PROD_READ_TOKEN (production, lecture seule),
//             SUPABASE_ACCESS_TOKEN (recette, lecture/écriture).
// Dans l'environnement cloud, lancer avec NODE_USE_ENV_PROXY=1.
//
// LA PRODUCTION N'EST JAMAIS ÉCRITE. Ce n'est pas une promesse du jeton : le
// jeton « lecture seule » laisse lever son verrou d'un `set transaction read
// write` (constaté le 23/09/2026). C'est ce fichier qui la tient : la
// production n'est interrogée que par l'endpoint `read-only`, et aucune
// requête ne part vers elle ailleurs que dans `lireProd()`.
//
// Ce qui est copié : séquences, tables, contraintes, index, fonctions,
// déclencheurs (dont celui d'`auth.users`), RLS et règles, droits des tables,
// colonnes et fonctions, bucket `Documents` (sans fichiers), publication
// realtime, et les réglages `platform_settings` (compteur de factures à 0).
// Ce qui ne l'est pas : aucune donnée, aucun compte, aucun fichier.
// Les réglages Auth se règlent à part (voir DOCUMENTATION.md, « La recette »).

const PROD = "dezxefweqesurqbqxsta";
const RECETTE = (process.env.SUPABASE_RECETTE_REF || "qoizrysxwjmhqwuteajj").replace(/\s/g, "");
const JETON_PROD = (process.env.SUPABASE_PROD_READ_TOKEN || "").replace(/\s/g, "");
const JETON_RECETTE = (process.env.SUPABASE_ACCESS_TOKEN || "").replace(/\s/g, "");

if (RECETTE === PROD) {
  console.error("[recette] la cible désignée est la production : refus.");
  process.exit(1);
}

async function requete(url, jeton, sql) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const corps = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(corps)) {
    throw new Error(`${res.status} ${JSON.stringify(corps).slice(0, 400)}`);
  }
  return corps;
}
const lireProd = (sql) =>
  requete(`https://api.supabase.com/v1/projects/${PROD}/database/query/read-only`, JETON_PROD, sql);
const recette = (sql) =>
  requete(`https://api.supabase.com/v1/projects/${RECETTE}/database/query`, JETON_RECETTE, sql);

// ── Lecture du catalogue ────────────────────────────────────────────────────
const CATALOGUE = {
  seq: `select sequencename, data_type::text, start_value, increment_by from pg_sequences where schemaname='public'`,
  cols: `select c.relname t, a.attnum n, a.attname col, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin,d.adrelid) def
         from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
         left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
         where s.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 1,2`,
  cons: `select c.relname t, co.conname, co.contype, pg_get_constraintdef(co.oid) def from pg_constraint co
         join pg_class c on c.oid=co.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' order by 1,2`,
  idx: `select pg_get_indexdef(i.oid) def from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid
        join pg_namespace s on s.oid=c.relnamespace where s.nspname='public'
        and not exists (select 1 from pg_constraint co where co.conindid=i.oid) order by 1`,
  funcs: `select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def, p.proacl::text[] acl
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`,
  trig: `select n.nspname sch, c.relname t, tg.tgname, pg_get_triggerdef(tg.oid) def, tg.tgenabled from pg_trigger tg
         join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
         where not tg.tgisinternal and (n.nspname='public' or (n.nspname='auth' and c.relname='users')) order by 1,2,3`,
  tabacl: `select c.relname t, c.relkind k, c.relrowsecurity rls, c.relforcerowsecurity force, c.relacl::text[] acl
           from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S') order by 1`,
  colacl: `select c.relname t, a.attname col, a.attacl::text[] acl from pg_attribute a join pg_class c on c.oid=a.attrelid
           join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2`,
  pol: `select schemaname, tablename, policyname, permissive, roles::text[] roles, cmd, qual, with_check
        from pg_policies where schemaname in ('public','storage') order by 1,2,3`,
  buckets: `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets`,
  pub: `select pubname, tablename from pg_publication_tables where schemaname='public'`,
  reglages: `select key, value from public.platform_settings order by 1`,
};

const ROLES = ["PUBLIC", "anon", "authenticated", "service_role"];
const PRIV = { a: "INSERT", r: "SELECT", w: "UPDATE", d: "DELETE", D: "TRUNCATE", x: "REFERENCES", t: "TRIGGER", m: "MAINTAIN", U: "USAGE", X: "EXECUTE" };
const id = (s) => `"${s.replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function droits(acl, objet, colonne) {
  const out = [];
  for (const e of acl || []) {
    const [bénéficiaire, reste] = e.split("=");
    const role = bénéficiaire === "" ? "PUBLIC" : bénéficiaire;
    if (!ROLES.includes(role)) continue;
    const privs = [...reste.split("/")[0]].map((c) => PRIV[c]).filter(Boolean);
    if (!privs.length) continue;
    const liste = colonne ? privs.map((p) => `${p} (${id(colonne)})`).join(", ") : privs.join(", ");
    out.push(`GRANT ${liste} ON ${objet} TO ${role};`);
  }
  return out;
}

async function genererSql() {
  const c = {};
  for (const [cle, sql] of Object.entries(CATALOGUE)) c[cle] = await lireProd(sql);
  const S = ["BEGIN;", "SET check_function_bodies = off;"];
  const seqs = new Set(c.seq.map((s) => s.sequencename));

  for (const s of c.seq) S.push(`CREATE SEQUENCE public.${id(s.sequencename)} AS ${s.data_type} START ${s.start_value} INCREMENT ${s.increment_by};`);
  const tables = [...new Set(c.cols.map((x) => x.t))];
  for (const t of tables) {
    const lignes = c.cols.filter((x) => x.t === t).map((x) =>
      `  ${id(x.col)} ${x.typ}${x.def ? ` DEFAULT ${x.def}` : ""}${x.nn ? " NOT NULL" : ""}`);
    S.push(`CREATE TABLE public.${id(t)} (\n${lignes.join(",\n")}\n);`);
  }
  for (const s of c.seq) {
    const col = c.cols.find((x) => x.def && x.def.includes(`'${s.sequencename}'`));
    if (col) S.push(`ALTER SEQUENCE public.${id(s.sequencename)} OWNED BY public.${id(col.t)}.${id(col.col)};`);
  }
  // Clés étrangères en dernier : elles supposent les clés primaires en place.
  for (const type of ["p", "u", "c", "x", "f"]) {
    for (const k of c.cons.filter((x) => x.contype === type)) {
      S.push(`ALTER TABLE public.${id(k.t)} ADD CONSTRAINT ${id(k.conname)} ${k.def};`);
    }
  }
  for (const i of c.idx) S.push(`${i.def};`);
  for (const f of c.funcs) {
    const sig = `public.${id(f.proname)}(${f.args})`;
    S.push(`${f.def.trim()};`);
    // Une fonction créée reçoit EXECUTE pour tous : on repart de zéro, puis
    // on reprend exactement les droits de la production (leçon de S-02).
    S.push(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated, service_role;`);
    S.push(...droits(f.acl, `FUNCTION ${sig}`));
  }
  for (const t of c.trig) {
    S.push(`${t.def};`);
    if (t.tgenabled === "D") S.push(`ALTER TABLE ${t.sch}.${id(t.t)} DISABLE TRIGGER ${id(t.tgname)};`);
  }
  for (const r of c.tabacl) {
    const objet = `${seqs.has(r.t) ? "SEQUENCE" : "TABLE"} public.${id(r.t)}`;
    S.push(`REVOKE ALL ON ${objet} FROM PUBLIC, anon, authenticated, service_role;`);
    S.push(...droits(r.acl, objet));
    if (r.k === "r" && r.rls) S.push(`ALTER TABLE public.${id(r.t)} ENABLE ROW LEVEL SECURITY;`);
    if (r.k === "r" && r.force) S.push(`ALTER TABLE public.${id(r.t)} FORCE ROW LEVEL SECURITY;`);
  }
  for (const r of c.colacl) S.push(...droits(r.acl, `public.${id(r.t)}`, r.col));
  for (const p of c.pol) {
    const roles = p.roles.map((r) => (r === "public" ? "PUBLIC" : r)).join(", ");
    S.push(`CREATE POLICY ${id(p.policyname)} ON ${p.schemaname}.${id(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${roles}` +
      `${p.qual ? ` USING (${p.qual})` : ""}${p.with_check ? ` WITH CHECK (${p.with_check})` : ""};`);
  }
  for (const b of c.buckets) {
    const types = b.allowed_mime_types ? `ARRAY[${b.allowed_mime_types.map(lit).join(",")}]::text[]` : "NULL";
    S.push(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? "NULL"}, ${types});`);
  }
  for (const p of c.pub) S.push(`ALTER PUBLICATION ${id(p.pubname)} ADD TABLE public.${id(p.tablename)};`);
  for (const r of c.reglages) {
    // La numérotation des factures de recette ne doit rien à celle de la production.
    const valeur = r.key === "invoice_sequence" ? 0 : r.value;
    S.push(`INSERT INTO public.platform_settings (key, value, updated_at) VALUES (${lit(r.key)}, ${lit(JSON.stringify(valeur))}::jsonb, now());`);
  }
  S.push("COMMIT;");
  return S.join("\n");
}

// ── Comparaison ─────────────────────────────────────────────────────────────
// Les écarts de pure écriture sont neutralisés : ordre des droits, schéma
// `extensions.` affiché ou non selon le search_path, parenthèses redondantes
// (une règle recréée voit ses `OR` aplatis : `((a OR b) OR c)` → `(a OR b OR c)`).
// Limite assumée : deux règles qui ne différeraient QUE par le groupement de
// leurs `AND`/`OR` passeraient pour identiques.
const COMPARAISON = {
  // Sans `attnum` : la production garde la trace des colonnes supprimées, et
  // numérote donc autrement des colonnes identiques.
  colonnes: `select c.relname t, a.attname col, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin,d.adrelid) def
             from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
             left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
             where s.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped`,
  contraintes: `select c.relname t, co.conname, pg_get_constraintdef(co.oid) def from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public'`,
  index: `select pg_get_indexdef(i.oid) def from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public'`,
  fonctions: CATALOGUE.funcs,
  declencheurs: CATALOGUE.trig,
  droits_tables: CATALOGUE.tabacl,
  droits_colonnes: CATALOGUE.colacl,
  regles_rls: CATALOGUE.pol,
  bucket: CATALOGUE.buckets,
  realtime: CATALOGUE.pub,
  reglages: `select key from public.platform_settings`,
};
const normaliser = (ligne) => {
  const l = { ...ligne };
  for (const k of Object.keys(l)) {
    if (Array.isArray(l[k])) l[k] = [...l[k]].sort();
    if (typeof l[k] === "string") l[k] = l[k].replace(/extensions\./g, "").replace(/[()\s]/g, "");
  }
  return JSON.stringify(l, Object.keys(l).sort());
};

async function comparer() {
  let ecarts = 0;
  for (const [nom, sql] of Object.entries(COMPARAISON)) {
    const [p, r] = await Promise.all([lireProd(sql), recette(sql)]);
    const P = new Set(p.map(normaliser)), R = new Set(r.map(normaliser));
    const seulP = [...P].filter((x) => !R.has(x)), seulR = [...R].filter((x) => !P.has(x));
    console.log(`${nom.padEnd(16)} production=${String(p.length).padStart(3)} recette=${String(r.length).padStart(3)} ${seulP.length + seulR.length ? "ÉCART" : "identique"}`);
    for (const x of seulP.slice(0, 5)) console.log("   seulement en production :", x.slice(0, 200));
    for (const x of seulR.slice(0, 5)) console.log("   seulement en recette    :", x.slice(0, 200));
    ecarts += seulP.length + seulR.length;
  }
  console.log(ecarts ? `\n${ecarts} écart(s).` : "\nLa recette a la même structure que la production.");
  process.exit(ecarts ? 1 : 0);
}

const commande = process.argv[2];
try {
  if (!JETON_PROD || !JETON_RECETTE) throw new Error("SUPABASE_PROD_READ_TOKEN et SUPABASE_ACCESS_TOKEN sont requis.");
  if (commande === "comparer") await comparer();
  else if (commande === "sql") console.log(await genererSql());
  else if (commande === "copier") {
    const [{ n }] = await recette("select count(*)::int n from information_schema.tables where table_schema='public'");
    if (n > 0) throw new Error(`la recette contient déjà ${n} tables : la copie ne s'applique qu'à une base vide.`);
    await recette(await genererSql());
    console.log("Structure copiée. Vérifier : node scripts/recette.mjs comparer");
  } else {
    console.log("Usage : node scripts/recette.mjs comparer | sql | copier");
    process.exit(1);
  }
} catch (err) {
  console.error("[recette] échec :", err.message);
  process.exit(1);
}
