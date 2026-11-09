// Page de réponse d'une référence d'expérience (09/11/2026) — voir api/references.js.
// Le texte affiché vient du serveur et passe par textContent : jamais par innerHTML.
(function () {
  "use strict";
  var jeton = "";
  try { jeton = new URLSearchParams(window.location.search).get("t") || ""; }
  catch (e) { console.error("[reference] adresse illisible :", e && e.message); }
  var $ = function (id) { return document.getElementById(id); };

  function montrer(texte) {
    $("chargement").classList.add("masque");
    $("formulaire").classList.add("masque");
    $("texte-message").textContent = texte;
    $("message").classList.remove("masque");
  }
  function appeler(corps) {
    return fetch("/api/references", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function periode(d, f) { return f && f !== d ? "de " + d + " à " + f : f === d ? "en " + d : "depuis " + d; }

  if (!jeton) { montrer("Ce lien n'est pas complet. Ouvrez celui de l'e-mail reçu."); return; }
  appeler({ action: "lire", jeton: jeton }).then(function (res) {
    if (!res.ok) { montrer(res.j.error || "Ce lien n'est pas valable."); return; }
    var d = res.j;
    var qui = d.qui || "Cette personne";
    $("resume").textContent = qui + " indique avoir travaillé chez " + d.entreprise + " comme « " + d.metier + " », " + periode(d.annee_debut, d.annee_fin) + ".";
    $("chargement").classList.add("masque");
    $("formulaire").classList.remove("masque");
  }, function (e) { console.error("[reference] lecture :", e && e.message); montrer("Connexion impossible. Réessayez dans un instant."); });

  $("formulaire").addEventListener("change", function () {
    var oui = $("formulaire").querySelector("input[name=a_travaille]:checked");
    $("bloc-recommande").style.display = oui && oui.value === "non" ? "none" : "";
  });
  $("formulaire").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = $("formulaire");
    var travaille = f.querySelector("input[name=a_travaille]:checked");
    if (!travaille) return;
    var reco = f.querySelector("input[name=recommande]:checked");
    $("envoyer").disabled = true;
    $("erreur").classList.add("masque");
    appeler({ action: "repondre", jeton: jeton, reponse: {
      a_travaille: travaille.value === "oui",
      recommande: reco && reco.value ? reco.value === "oui" : null,
      commentaire: f.commentaire.value, repondant: f.repondant.value,
    } }).then(function (res) {
      if (res.ok) { montrer("Merci ! Votre réponse est enregistrée."); return; }
      if (res.j && /déjà|expiré/.test(res.j.error || "")) { montrer(res.j.error); return; }
      $("erreur").textContent = (res.j && res.j.error) || "Votre réponse n'a pas pu être envoyée. Réessayez.";
      $("erreur").classList.remove("masque");
      $("envoyer").disabled = false;
    }, function (e) {
      console.error("[reference] envoi :", e && e.message);
      $("erreur").textContent = "Connexion impossible. Réessayez dans un instant.";
      $("erreur").classList.remove("masque");
      $("envoyer").disabled = false;
    });
  });
})();
