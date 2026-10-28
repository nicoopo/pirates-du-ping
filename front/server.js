// Front du buzzer : sert la page, et relaie vers l'API et l'annexe, qui n'ont pas à être exposées.
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { demarrerLePulse } from "../shared/pulse.js";

const API_URL = process.env.API_URL || "http://api:3000";
const ANNEXE_URL = process.env.ANNEXE_URL || "http://annexe:3000";
const app = express();
app.use(express.json({ limit: "1kb" }));
// Un JSON mal formé ou trop gros : un 400 lisible, jamais une trace d'erreur HTML avec nos chemins internes.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ erreur: "corps de requête invalide (JSON attendu, 1 ko max)" });
  }
  next(err);
});
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

// Le front répond toujours, même si ses dépendances sont tombées : c'est la dégradation gracieuse.
// Il annonce l'état de ses dépendances sans en faire dépendre sa propre santé.
async function joignable(url) {
  try {
    return (await fetch(`${url}/sante`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
app.get("/sante", async (req, res) => {
  const [api, annexe] = await Promise.all([joignable(API_URL), joignable(ANNEXE_URL)]);
  res.json({ statut: "ok", api: api ? "ok" : "injoignable", annexe: annexe ? "ok" : "injoignable" });
});

// Un coup encaissé : un vrai calcul, sans dépendance, pour que le front tienne seul la charge.
app.get("/travail", (req, res) => {
  const empreinte = crypto.createHash("sha256").update(String(Date.now())).digest("hex");
  res.json({ ok: true, empreinte: empreinte.slice(0, 8) });
});

// Relais vers un service interne : une panne en face donne un 503 lisible, jamais une page blanche.
const relayer = (cible) => async (req, res) => {
  try {
    const reponse = await fetch(`${cible}${req.originalUrl.replace(/^\/annexe/, "")}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(3000),
    });
    res.status(reponse.status).type("application/json").send(await reponse.text());
  } catch {
    res.status(503).json({ erreur: "données indisponibles" });
  }
};
app.use("/api", relayer(API_URL));
app.use("/annexe/api", relayer(ANNEXE_URL));

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`front sur le port ${port}`);
  demarrerLePulse();
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
