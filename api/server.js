// API métier du buzzer : qui a buzzé, dans quel ordre, manche par manche.
import fs from "node:fs";
import path from "node:path";
import express from "express";
import pg from "pg";
import client from "prom-client";
import { creerPool, assurerSchema, baseRepond, siTablesDisparues } from "../shared/base.js";
import { demarrerLePulse } from "../shared/pulse.js";
import { brancherMetriques } from "../shared/metriques.js";

const pool = creerPool(pg);
const PAVILLON = process.env.PAVILLON_FICHIER || "/data/pavillon.txt";
const app = express();
brancherMetriques(app, client, { base: () => baseRepond(pool) });
app.use(express.json({ limit: "1kb" }));
// Un JSON mal formé ou trop gros : un 400 lisible, jamais une trace d'erreur HTML avec nos chemins internes.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ erreur: "corps de requête invalide (JSON attendu, 1 ko max)" });
  }
  next(err);
});

// Une base coupée donne un 503 exploitable, jamais un plantage ni une requête pendue.
const avecBase = (handler) => async (req, res) => {
  try {
    await assurerSchema(pool);
    await handler(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.path} :`, err.message);
    siTablesDisparues(err);
    res.status(503).json({ erreur: "base de données indisponible" });
  }
};

// Le service fonctionne (pas seulement : le serveur HTTP écoute) : on interroge vraiment la base.
app.get("/sante", async (req, res) => {
  const base = await baseRepond(pool);
  res.status(base ? 200 : 503).json({ statut: base ? "ok" : "degrade", base: base ? "ok" : "injoignable" });
});

// Un coup encaissé : une écriture et une lecture réelles en base, quelques millisecondes.
app.get("/travail", avecBase(async (req, res) => {
  await pool.query("INSERT INTO coups (service) VALUES ('api')");
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM buzz WHERE manche_id = (SELECT MAX(id) FROM manches)");
  res.json({ ok: true, buzz_manche: rows[0].n });
}));

app.get("/api/manche", avecBase(async (req, res) => {
  const { rows: [manche] } = await pool.query("SELECT id, debut FROM manches ORDER BY id DESC LIMIT 1");
  const { rows: buzz } = await pool.query(
    "SELECT joueur, a FROM buzz WHERE manche_id = $1 ORDER BY a, id", [manche.id],
  );
  res.json({ manche: manche.id, debut: manche.debut, buzz });
}));

app.post("/api/buzz", (req, res, next) => {
  const joueur = typeof req.body?.joueur === "string" ? req.body.joueur.trim() : "";
  if (!joueur || joueur.length > 30) return res.status(400).json({ erreur: "joueur requis (1 à 30 caractères)" });
  req.joueur = joueur;
  next();
}, avecBase(async (req, res) => {
  const { rows: [buzz] } = await pool.query(
    `INSERT INTO buzz (manche_id, joueur) VALUES ((SELECT MAX(id) FROM manches), $1)
     RETURNING manche_id, (SELECT COUNT(*)::int + 1 FROM buzz b WHERE b.manche_id = buzz.manche_id) AS rang`,
    [req.joueur],
  );
  res.status(201).json({ joueur: req.joueur, manche: buzz.manche_id, rang: buzz.rang });
}));

app.post("/api/manche", avecBase(async (req, res) => {
  const { rows: [manche] } = await pool.query("INSERT INTO manches DEFAULT VALUES RETURNING id");
  res.status(201).json({ manche: manche.id });
}));

// Le pavillon (rôle État) : écrit sur le disque, relu par le pulse à chaque battement.
// Il ne survit au redéploiement que si PAVILLON_FICHIER est dans un volume.
app.post("/pavillon", (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ erreur: "message requis" });
  try {
    fs.mkdirSync(path.dirname(PAVILLON), { recursive: true });
    fs.writeFileSync(PAVILLON, message.slice(0, 140));
    res.status(201).json({ pavillon: message.slice(0, 140) });
  } catch (err) {
    // Panne 3 du sujet : dossier illisible. On le dit au lieu de faire semblant.
    console.error("[pavillon] écriture impossible :", err.message);
    res.status(503).json({ erreur: "pavillon non enregistré : stockage inaccessible" });
  }
});

app.use((req, res) => res.status(404).json({ erreur: "route inconnue" }));

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`api sur le port ${port}`);
  demarrerLePulse();
});
// Arrêt propre : sans ça, Node en PID 1 ignore SIGTERM et se fait tuer au bout du délai.
process.on("SIGTERM", () => server.close(() => pool.end().finally(() => process.exit(0))));
