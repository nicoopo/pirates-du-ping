// Chaque zone dépend d'un seul service : si l'un tombe, seule sa zone affiche "données indisponibles".
const $ = (id) => document.getElementById(id);

async function lire(url) {
  const reponse = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
  return reponse.json();
}

function liste(el, elements, texte) {
  el.replaceChildren(...elements.map((e) => {
    const li = document.createElement("li");
    li.textContent = texte(e);
    return li;
  }));
}

function indisponible(el) {
  el.innerHTML = '<li class="indispo">données indisponibles</li>';
}

async function rafraichir() {
  try {
    const { manche, buzz } = await lire("/api/manche");
    $("manche").textContent = manche;
    liste($("ordre"), buzz, (b) => b.joueur);
  } catch {
    $("manche").textContent = "–";
    indisponible($("ordre"));
  }
  try {
    liste($("stats"), await lire("/annexe/api/stats"), (s) => `${s.joueur} : ${s.victoires} victoire(s), ${s.buzz} buzz`);
  } catch {
    indisponible($("stats"));
  }
}

$("buzz").addEventListener("click", async () => {
  const joueur = $("joueur").value.trim();
  if (!joueur) return ($("message").textContent = "Choisis un pseudo avant de buzzer.");
  try {
    const reponse = await fetch("/api/buzz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joueur }),
      signal: AbortSignal.timeout(4000),
    });
    const corps = await reponse.json();
    $("message").textContent = reponse.ok ? `Buzz n°${corps.rang} de la manche !` : `Buzz refusé : ${corps.erreur}`;
  } catch {
    $("message").textContent = "Buzz non envoyé : données indisponibles.";
  }
  rafraichir();
});

rafraichir();
setInterval(rafraichir, 3000);
