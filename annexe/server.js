// Service annexe : agrège l'historique des manches et les stats des joueurs.
// Il ne fait que lire : c'est un travail différent de l'API, qui enregistre les buzz.
import express from "express";
import pg from "pg";
import { creerPool, assurerSchema, baseRepond, siTablesDisparues } from "../shared/base.js";
import { demarrerLePulse } from "../shared/pulse.js";

const pool = creerPool(pg);
const app = express();

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

app.get("/sante", async (req, res) => {
  const base = await baseRepond(pool);
  res.status(base ? 200 : 503).json({ statut: base ? "ok" : "degrade", base: base ? "ok" : "injoignable" });
});

// Un coup encaissé : une agrégation réelle sur la table des buzz, plus une écriture.
app.get("/travail", avecBase(async (req, res) => {
  await pool.query("INSERT INTO coups (service) VALUES ('annexe')");
  const { rows } = await pool.query("SELECT COUNT(DISTINCT joueur)::int AS joueurs FROM buzz");
  res.json({ ok: true, joueurs: rows[0].joueurs });
}));

// Chaque manche : son gagnant (premier buzz) et son nombre de buzz.
app.get("/api/historique", avecBase(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id AS manche, m.debut,
           (SELECT joueur FROM buzz b WHERE b.manche_id = m.id ORDER BY a, id LIMIT 1) AS gagnant,
           (SELECT COUNT(*)::int FROM buzz b WHERE b.manche_id = m.id) AS nb_buzz
    FROM manches m ORDER BY m.id DESC LIMIT 20`);
  res.json(rows);
}));

// Par joueur : manches gagnées et nombre total de buzz.
app.get("/api/stats", avecBase(async (req, res) => {
  const { rows } = await pool.query(`
    WITH premiers AS (
      SELECT DISTINCT ON (manche_id) manche_id, joueur FROM buzz ORDER BY manche_id, a, id
    )
    SELECT b.joueur, COUNT(*)::int AS buzz,
           (SELECT COUNT(*)::int FROM premiers p WHERE p.joueur = b.joueur) AS victoires
    FROM buzz b GROUP BY b.joueur ORDER BY victoires DESC, buzz DESC LIMIT 10`);
  res.json(rows);
}));

app.use((req, res) => res.status(404).json({ erreur: "route inconnue" }));

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`annexe sur le port ${port}`);
  demarrerLePulse();
});
process.on("SIGTERM", () => server.close(() => pool.end().finally(() => process.exit(0))));
