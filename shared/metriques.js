// Métriques Prometheus d'un service (rôle Mesure) : de quoi nommer une panne sans ouvrir un terminal.
// prom-client est passé par le service : shared/ n'a pas de node_modules à lui.
import fs from "node:fs";
import path from "node:path";
import { tableauJoignable } from "./pulse.js";

const SERVICE = process.env.SERVICE || "inconnu";
const VERSION = process.env.VERSION || "dev";
const PAVILLON = process.env.PAVILLON_FICHIER || "/data/pavillon.txt";

// Panne 3 : le dossier du pavillon illisible, alors que le service tourne très bien.
function pavillonLisible() {
  try {
    fs.accessSync(path.dirname(PAVILLON), fs.constants.R_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// dependances : { nom: async () => booléen }, propres au service (base, api, annexe...).
export function brancherMetriques(app, client, dependances = {}) {
  const registre = new client.Registry();
  registre.setDefaultLabels({ service: SERVICE });
  client.collectDefaultMetrics({ register: registre });

  // Panneau 4 : la version qui tourne vraiment, un exemplaire = une série.
  new client.Gauge({
    name: "flotte_info",
    help: "Toujours 1, porte la version de l'image qui tourne",
    labelNames: ["version"],
    registers: [registre],
  }).set({ version: VERSION }, 1);

  const coups = new client.Counter({
    name: "flotte_coups_total",
    help: "Requêtes sur /travail, par code de réponse",
    labelNames: ["statut"],
    registers: [registre],
  });
  // Un histogramme et pas une moyenne : la saturation se voit dans la queue (p95), pas au milieu.
  const duree = new client.Histogram({
    name: "flotte_travail_duree_secondes",
    help: "Durée de la route /travail",
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registre],
  });

  const toutes = { tableau: async () => tableauJoignable(), pavillon: async () => pavillonLisible(), ...dependances };
  new client.Gauge({
    name: "flotte_dependance",
    help: "1 si la dépendance répond, 0 sinon",
    labelNames: ["dependance"],
    registers: [registre],
    // Évalué à chaque scrape : l'état est celui de l'instant, pas celui du démarrage.
    async collect() {
      const etats = await Promise.all(Object.values(toutes).map((verifier) => verifier().catch(() => false)));
      Object.keys(toutes).forEach((nom, i) => this.set({ dependance: nom }, etats[i] ? 1 : 0));
    },
  });

  // Branché avant les routes : chaque coup sur /travail est compté et chronométré, réussi ou non.
  app.use("/travail", (req, res, next) => {
    const fin = duree.startTimer();
    res.on("finish", () => {
      fin();
      coups.inc({ statut: String(res.statusCode) });
    });
    next();
  });

  app.get("/metrics", async (req, res) => {
    res.type(registre.contentType).send(await registre.metrics());
  });
}
