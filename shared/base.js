// Connexion à la base, partagée par l'API et l'annexe (rôle État).
// pg est passé par le service : shared/ n'a pas de node_modules à lui.

export function exigerVariables(noms) {
  const manquantes = noms.filter((nom) => !process.env[nom]);
  if (manquantes.length) {
    // Un service qui démarre avec une config incomplète est pire qu'un service qui refuse de démarrer.
    console.error(`Variables d'environnement manquantes : ${manquantes.join(", ")}`);
    process.exit(1);
  }
}

export function creerPool(pg) {
  exigerVariables(["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]);
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 2000,
  });
  // Sans ce handler, une base coupée fait crasher le process via un client inactif.
  pool.on("error", (err) => console.error("[base] connexion perdue :", err.message));
  return pool;
}

// Le schéma est créé au premier appel qui réussit : la base peut démarrer après le service.
let schemaPret = null;
export function assurerSchema(pool) {
  schemaPret ??= pool
    .query(`
      CREATE TABLE IF NOT EXISTS manches (
        id SERIAL PRIMARY KEY,
        debut TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS buzz (
        id SERIAL PRIMARY KEY,
        manche_id INTEGER NOT NULL REFERENCES manches(id),
        joueur VARCHAR(30) NOT NULL,
        a TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS coups (
        id SERIAL PRIMARY KEY,
        service VARCHAR(20) NOT NULL,
        a TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO manches (id) VALUES (1) ON CONFLICT DO NOTHING;
      SELECT setval('manches_id_seq', GREATEST((SELECT MAX(id) FROM manches), 1));
    `)
    .catch((err) => {
      schemaPret = null; // on réessaiera au prochain appel
      throw err;
    });
  return schemaPret;
}

// Une base repartie de zéro (volume perdu) n'a plus de tables : on oublie le schéma pour le recréer.
export function siTablesDisparues(err) {
  if (err.code === "42P01") schemaPret = null;
}

// Vérifie vraiment la base : une route de santé qui ne fait que répondre 200 ne prouve rien.
export async function baseRepond(pool) {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
