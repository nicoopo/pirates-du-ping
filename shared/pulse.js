// pulse.js : fourni par le sujet, à importer depuis chaque service qui tient un carré au tableau
import os from "node:os";
import fs from "node:fs";

const TABLEAU = process.env.TABLEAU_URL;
const GROUPE = process.env.GROUPE;
const COULEUR = process.env.COULEUR || "#888888";
const SERVICE = process.env.SERVICE;
const VERSION = process.env.VERSION || "dev";
const PAVILLON = process.env.PAVILLON_FICHIER || "/data/pavillon.txt";
const MOI = process.env.URL_INTERNE || "http://localhost:3000";

let totalEncaisse = 0; // depuis le démarrage de ce process, affiché sur le carré
let aDeclarer = 0; // encaissés depuis le dernier pulse, ce que le tableau attend
let tableauOk = false; // dernier pulse reçu par le tableau : distingue la panne 6 d'un service mort

export const tableauJoignable = () => tableauOk;

// Le pavillon est relu du disque à chaque pulse : s'il vit dans un volume, il
// traverse le redéploiement, sinon il disparaît du tableau devant toute la classe.
function lirePavillon() {
  try {
    return fs.readFileSync(PAVILLON, "utf8").trim();
  } catch {
    return "";
  }
}

// Un coup, c'est une vraie requête sur sa propre route de travail. Les coups partent
// par paquets de dix en parallèle, sinon un gros retard bloquerait le pulse suivant.
async function encaisser(nombre) {
  const aFaire = Math.min(nombre, 300);
  for (let debut = 0; debut < aFaire; debut += 10) {
    const paquet = [];
    for (let i = debut; i < Math.min(debut + 10, aFaire); i++) {
      paquet.push(
        fetch(`${MOI}/travail`)
          .then((reponse) => {
            if (reponse.ok) {
              totalEncaisse++;
              aDeclarer++;
            }
          })
          .catch(() => {})
      );
    }
    await Promise.all(paquet);
  }
}

async function envoyerPulse() {
  let attente = 5000;
  const declares = aDeclarer;
  try {
    const reponse = await fetch(`${TABLEAU}/api/pulse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupe: GROUPE,
        couleur: COULEUR,
        service: SERVICE,
        conteneur: os.hostname(),
        version: VERSION,
        pavillon: lirePavillon(),
        encaisses: declares,
        total_encaisse: totalEncaisse,
      }),
    });
    // Les coups déclarés ne sont retirés du compteur local qu'une fois le tableau
    // au courant : si l'appel échoue, ils repartiront dans le pulse suivant.
    aDeclarer -= declares;
    tableauOk = reponse.ok;
    const ordre = await reponse.json();
    attente = ordre.prochain_pulse_ms || 5000;
    if (ordre.coups_a_encaisser > 0) await encaisser(ordre.coups_a_encaisser);
  } catch (erreur) {
    tableauOk = false;
    console.error("[pulse] tableau injoignable :", erreur.message);
  }
  setTimeout(envoyerPulse, attente);
}

export function demarrerLePulse() {
  if (!TABLEAU || !GROUPE || !SERVICE) {
    console.error("[pulse] TABLEAU_URL, GROUPE et SERVICE sont obligatoires");
    return;
  }
  console.log(`[pulse] ${GROUPE}/${SERVICE} vers ${TABLEAU}`);
  envoyerPulse();
}
