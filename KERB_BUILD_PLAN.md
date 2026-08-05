# KERB - BUILD PLAN
## Flare Summer Signal, Track 2 (Confidential Compute Apps)
Rédigé le 2026-08-04. Deadline soumission: 2026-08-14 15:59 (vérifier le fuseau sur DoraHacks). Fenêtre: 10 jours.

Nom: le kerb trading, la négociation en marge du parquet, au bord du trottoir. Le London Metal Exchange appelle encore ses sessions "kerb". Kerb = l'exécution au bord du marché, hors de la vue du carnet. À placer dans le README et la vidéo.

Pitch une ligne: l'automation que le DEX natif XRPL n'a jamais eue. Stop-loss, limit orders et DCA non-custodiaux sur le DEX XRPL, la stratégie chiffrée dans un TEE Flare, les triggers pris sur FTSOv2, les dépôts et règlements prouvés par FDC.

---

## 0. ÉTAT VÉRIFIÉ DE LA STACK (2026-08-04)

Tout ce qui suit a été vérifié aujourd'hui sur les sources listées en fin de document.

1. **FCC est buildable MAINTENANT sur Coston2.** Les docs officielles fournissent un scaffold complet de "Flare Compute Extension" (FCE) qui tourne contre le Coston2 réel avec `SIMULATED_TEE=true` (attestation simulée, chaîne réelle). Warning officiel: FCC est "in the final stages of development and is not yet a fully public production system". [S1][S2]
2. **Le framework fait 80% du travail TEE.** L'exemple officiel `fce-sign` fait exactement le coeur de Kerb: livraison d'un secret chiffré ECIES au TEE, stockage d'une clé secp256k1 en enclave, endpoint `/decrypt` du node TEE (port 7701), pubkey du TEE exposée sur `/info` du proxy, commande SIGN qui retourne une signature onchain. Implémentations Go, Python et TypeScript. [S3]
3. **Architecture FCC**: contrats système `TeeExtensionRegistry` + `TeeMachineRegistry` déjà déployés sur Coston2 (adresses dans `config/coston2/deployed-addresses.json` du scaffold, temporaire avant `FlareContractRegistry`). Instructions envoyées onchain via `sendInstructions` (payable), relayées par les data providers (seuil 50%+ du poids de signature), exécutées par la machine TEE, résultats signés par l'identité TEE et vérifiables onchain. Code version = hash d'image Docker reproductible. `ActionResult` status: 0 erreur, 1 succès, >=2 pending (l'async est supporté nativement). [S1][S2][S3]
4. **PMW (Protocol Managed Wallets)**: application système de FCC, signature programmable de tx sur chaînes externes (XRPL, BTC), multisig k-of-n, gestion de nonces, reissuance/nullification, "Execution Proofs" via FDC. Statut affiché sur le hub dev: "In development". Donc PAS d'API PMW publique utilisable pour nous d'ici le 14. On construit la version app-layer avec le pattern fce-sign, et on livre un adaptateur PMW-ready (section 4.6). [S1][S4]
5. **STP.13** (déploiement FCC sur Songbird): vote clôturé le 12 juillet 2026. Phase initiale: machines TEE opérées par la Flare Foundation sur Google confidential compute. [S5][S6]
6. **FDC**: 7 types d'attestation. `Payment` couvre BTC, DOGE, **XRP**. `Web2Json` seulement sur Coston et Coston2. Flow: `FdcHub.requestAttestation` + fee minimum (fee brûlée si non confirmée), round de vote, merkle root sur `Relay`, preuve via DA Layer, vérification via `FdcVerification`. Age max des données chain: 14 jours. [S7]
7. **FTSOv2**: feeds block-latency mis à jour à chaque bloc (~1,8 s), **gratuits onchain**, jusqu'à 1000 feeds, anchor feeds (Scaling) toutes les 90 s, volatility incentives permissionless. [S8]
8. **Coston2**: chain id 114, RPC `https://coston2-api.flare.network/ext/C/rpc`, faucet donne C2FLR + FXRP + USDT0, explorer `coston2-explorer.flare.network`. [S4]
9. **Dépendance externe bloquante**: le `ext-proxy` local a besoin des credentials read-only de l'indexer C-chain de Flare. À demander via le support Flare ou @FlareDevs en expliquant ce qu'on build. Coston2 accessible sans VPN. C'EST L'ACTION #1 DU JOUR 0. [S2][S3]
10. **Docs agent-ready**: chaque page docs dispo en `.md` (suffixe `.md` sur l'URL), index `llms.txt`, "Flare AI Skills" pour Claude Code, serveur MCP. À brancher direct dans le pipeline. [S4]
11. **Flare Smart Accounts**: nouveau module "account abstraction for XRPL users on Flare". Optionnel, section 11. [S4]

Connaissance stable (docs xrpl.org, à re-vérifier vite fait au J2): DEX natif XRPL via `OfferCreate`/`OfferCancel`, IOU + trustlines, autobridging par XRP, flags `tfImmediateOrCancel`/`tfFillOrKill`/`tfSell`/`tfPassive`, testnet `wss://s.altnet.rippletest.net:51233` + faucet, lib `xrpl.js`, clés ed25519 ou secp256k1, reserve de base ~1 XRP + ~0,2 XRP par objet.

---

## 1. DÉCISION D'ARCHITECTURE

**Kerb = une vraie Flare Compute Extension**, déployée sur **Coston2** (autorisé par le règlement: Coston2, Songbird ou mainnet). Pas un enclave maison à côté de Flare: le framework FCC officiel, avec son registre onchain, son relais par data providers et son cycle d'attestation. C'est ça qui score sur "Flare integration quality": on utilise l'infra FCC elle-même, pas juste un TEE qui lit un RPC.

Langage extension: **TypeScript** (le framework fce-sign le supporte officiellement) pour avoir `xrpl.js`, la lib XRPL la plus mature. Le tooling de deploy reste en Go (fourni, on n'y touche pas).

Mode TEE: `SIMULATED_TEE=true` + `LOCAL_MODE=false` (chaîne Coston2 réelle, attestation simulée), le chemin documenté officiellement. Tentative de déploiement Confidential Space réel (GCP) en stretch J8, via le `DEPLOYMENT_STEPS.md` du repo fce-sign. Honnêteté totale dans le README sur ce qui est simulé: les juges notent "credible and understandable", pas "magique".

---

## 2. LE PRODUIT

**User cible**: le holder XRPL. Le DEX natif XRPL existe depuis 2012 et n'a toujours ni stop-loss, ni ordres conditionnels, ni DCA non-custodial. Aujourd'hui ses options: laisser tourner un bot custodial (confiance totale), ou rien.

**Ce que Kerb donne**:
- Stop-loss: vendre X XRP si FTSO XRP/USD passe sous P.
- Limit: acheter/vendre à partir d'un seuil, avec borne de slippage.
- DCA: acheter N XRP toutes les H heures pendant D jours.
- Exécution en tranches avec jitter (taille et timing randomisés) pour ne pas télégraphier l'ordre.

**Ce qui est confidentiel** (dans l'enclave, chiffré ECIES vers la pubkey du TEE):
- le type d'ordre, le prix de déclenchement, les tailles de tranches, l'expiry, la borne de slippage, l'adresse de payout.

**Ce qui reste public** (assumé dans le README): l'existence d'un mandat, le dépôt sur XRPL (chaîne publique), chaque fill au moment où il se produit. La valeur: personne ne peut lire tes niveaux ni ton intention AVANT exécution, donc pas de front-running de ta propre stratégie, pas de chasse aux stops.

---

## 3. FLOW UTILISATEUR (E2E)

1. **Create.** Sur la dApp (Coston2), l'utilisateur compose son mandat. Le front récupère la pubkey du TEE sur `GET /info` du proxy, chiffre le mandat en ECIES, appelle `KerbSender.createMandate(encryptedBlob)` (payable, fee d'instruction). `claimBackAddress = msg.sender`.
2. **Provision.** Le TEE décrypte via le endpoint `/decrypt` du node, valide le schéma, dérive une adresse XRPL de dépôt dédiée au mandat, et retourne en résultat: `mandateId`, `depositAddress`, hash du mandat. Le contrat stocke le mandat en statut `CREATED`.
3. **Fund.** L'utilisateur envoie ses XRP (testnet) à `depositAddress` avec un memo/destination tag = mandateId. Un script (ou le front) demande une attestation FDC `Payment` de ce dépôt, soumet la preuve au contrat: statut `FUNDED`. Le funding est donc prouvé par le protocole enshrined, pas déclaré par le TEE.
4. **Arm & watch.** Le watcher dans l'enclave polle le feed FTSOv2 XRP/USD (block-latency, ~1,8 s, gratuit) via le RPC Coston2. Hystérésis anti-flapping (le trigger doit tenir K lectures consécutives).
5. **Execute.** Trigger atteint: l'enclave construit `OfferCreate` (avec `tfImmediateOrCancel` + qualité bornée par le slippage max), signe EN ENCLAVE, soumet sur XRPL testnet. Tranches + jitter si configuré. Chaque fill est loggé en résultat async (`status >= 2` pending puis final), écrit onchain avec les tx hashes XRPL.
6. **Settle.** Fin du mandat (rempli, expiré ou annulé): l'enclave paie le produit (ou le reliquat) à l'adresse XRPL de payout de l'utilisateur. Une attestation FDC `Payment` de ce virement est vérifiée par le contrat pour clôturer le mandat: statut `SETTLED`, prouvé onchain. Miroir exact du concept "Execution Proofs" documenté pour PMW. [S1]
7. **Cancel.** À tout moment: `cancelMandate(id)` onchain. Règle dure côté enclave: aucune exécution sans relecture du statut onchain du mandat juste avant de signer.

---

## 4. ARCHITECTURE TECHNIQUE

### 4.1 Composants
```
[dApp Next.js]                          [XRPL Testnet]
    |  createMandate(blob ECIES)             ^  OfferCreate / Payment signés en enclave
    v                                        |
[KerbSender.sol] --sendInstructions--> [TeeExtensionRegistry]
[MandateRegistry state]                      |  relay data providers (50%+ poids)
[FdcProofGate.sol]  <---preuves FDC---      v
    ^                                   [ext-proxy] <-> [extension-tee (TS) + redis]
    |                                        |  watcher FTSOv2 (RPC Coston2, poll ~2s)
[FdcHub / FdcVerification / Relay]           |  xrpl.js client (wss altnet)
```

### 4.2 Contrats (Coston2, Foundry)
- `KerbSender.sol` (fork de l'InstructionSender du scaffold, on garde constructor/setExtensionId intacts):
  - `OP_TYPE = bytes32("KERB")`
  - `OP_CMD_CREATE = bytes32("CREATE_MANDATE")` : message = blob ECIES
  - `OP_CMD_CANCEL = bytes32("CANCEL_MANDATE")` : message = abi.encode(mandateId)
  - `OP_CMD_REPORT = bytes32("REPORT")` : réservé aux résultats d'exécution
  - `getRandomTeeIds(extensionId, 1)`, `cosigners = []`, `cosignersThreshold = 0` pour le MVP (voir 4.7)
- `MandateRegistry` (peut vivre dans le même contrat): `struct Mandate { address owner; bytes32 blobHash; string depositAddr; uint8 status; uint64 createdAt; }` + events `MandateCreated/Funded/Executed/Settled/Cancelled`.
- `FdcProofGate`: fonctions `proveDeposit(proof)` et `proveSettlement(proof)` qui appellent `FdcVerification` (type `Payment`, source XRPL) et font transitionner le statut. Vérifier l'id de source exact pour XRPL testnet sur la page Attestation Types (attendu: `testXRP` sur Coston2). [S7]

### 4.3 Extension TEE (TypeScript, fork de fce-sign/typescript)
- `config.ts`: constantes OPType/OPCommand IDENTIQUES aux bytes32 Solidity (cause #1 d'échec documentée: mismatch). [S2]
- `handlers.ts`:
  - `CREATE_MANDATE`: decrypt via node `/decrypt` (SIGN_PORT 7701), validation stricte du schéma (voir 4.4), dérivation du wallet XRPL du mandat, persistance en mémoire enclave + snapshot chiffré, retour `{mandateId, depositAddress, blobHash}`.
  - `CANCEL_MANDATE`: flag cancelled, déclenche le flow settle.
- `engine.ts` (boucle de fond, hors chemin instruction):
  - `FtsoWatcher`: viem/ethers sur RPC Coston2, `FtsoV2.getFeedById(0x015852502f55534400000000000000000000000000)` (XRP/USD, format bytes21 catégorie 01, à confirmer sur la page Block-Latency Feeds), poll 2 s, hystérésis K=3.
  - `XrplExecutor`: xrpl.js sur `wss://s.altnet.rippletest.net:51233`. `OfferCreate` avec `tfImmediateOrCancel`, `TakerGets/TakerPays` bornés par le slippage max, retry avec gestion de `Sequence`, idempotence par mandat+tranche. `Payment` pour le settlement.
  - State machine mandat: `CREATED -> FUNDED -> ARMED -> EXECUTING -> (FILLED | EXPIRED | CANCELLED) -> SETTLED`. Relecture du statut onchain avant CHAQUE signature.
  - Reporting: résultats async postés au node (pattern status pending puis final), payload = `{mandateId, txHashes[], filledAmount, avgPrice}`.
- Recovery: au boot, re-scan des events onchain + snapshot local pour reconstruire l'état. Aucun secret hors enclave.

### 4.4 Schéma de mandat (v1, JSON chiffré ECIES)
```json
{
  "v": 1,
  "pair": "XRP/USD",
  "side": "sell",
  "kind": "stop",
  "trigger": { "feedId": "0x0158...", "op": "lte", "price": "2.85" },
  "size": { "total": "250", "slice": "50", "jitterPct": 20 },
  "bound": { "maxSlippagePct": 1.0 },
  "dca": { "everySec": 3600, "times": 24 },
  "expiry": 1755993600,
  "payout": { "xrplAddress": "r..." }
}
```
Validation: rejeter tout champ inconnu, borner tailles/durées, expiry max 30 jours.

### 4.5 La paire côté XRPL testnet
Le carnet du DEX testnet est vide. On l'assume et on le fournit:
- un compte issuer émet `CUSD` (IOU de test), trustlines pour les comptes de démo,
- un **bot market-maker** (script séparé, hors TEE) pose des offres au niveau du prix FTSO +/- spread, refresh 10 s.
Résultat: les fills de la démo sont déterministes. Dit tel quel dans le README (les juges détestent la magie, pas les testnets).

### 4.6 Adaptateur PMW (l'argument roadmap qui tue)
Interface `ISigner` dans l'extension: `{ getAddress(mandateId), signAndSubmit(tx), settle(payment) }`.
- Impl 1 (livrée): `EnclaveSigner` (clé en enclave, pattern fce-sign).
- Impl 2 (stub + doc): `PmwSigner` qui mappe les mêmes appels vers des instructions PMW (multisig k-of-n, nonces, reissuance) dès ouverture de l'API. [S1]
Une page `docs/PMW_MIGRATION.md` qui montre le mapping champ par champ. C'est la démonstration que Kerb est l'app-layer NÉ pour PMW.

### 4.7 Modèle de sécurité (assumé dans le README)
- La clé XRPL n'existe qu'en enclave (en simulé: c'est le POINT documenté comme simulé).
- Le mandat chiffré transite onchain: pattern démontré par fce-sign, avec leur warning officiel repris tel quel (en prod: livraison offchain du blob via le proxy, hash seul onchain). On implémente l'option offchain si le temps le permet (J7).
- Anti-rug du TEE: settlement prouvé par FDC `Payment` sinon le mandat ne clôture pas; roadmap: `cosigners` de TeeInstructionParams avec l'utilisateur comme cosigner des retraits, et `ReferencedPaymentNonexistence` pour prouver un défaut de settlement et slasher un bond opérateur.
- Fuites résiduelles: montant du dépôt, timing des fills. Mitigation: tranches + jitter. Dit honnêtement.

---

## 5. PLANNING 10 JOURS (J0 = aujourd'hui 4 août)

**J0 (2-3 h, ce soir)**
- Demander les credentials indexer Coston2: support Flare + DM @FlareDevs + message dans le Telegram du hackathon (lien dans le règlement), en décrivant Kerb. BLOQUANT, donc premier.
- Cloner `fce-extension-scaffold` + `fce-sign`. Lire le README + `DEPLOYMENT_STEPS.md` + `docs/manual-setup.md`.
- Faucet C2FLR, réserver le domaine ngrok (free tier = 1 domaine stable), installer Docker/Foundry/Go/Node.
- Brancher les docs Flare au pipeline: `llms.txt` + pages `.md` + Flare AI Skills pour Claude Code. [S4]

**J1**: fce-sign E2E VERT sur Coston2 (use-chain local coston2 typescript, pre-build, start-services, post-build, test.sh). Ne rien coder avant ce vert. Ensuite fork en `kerb`, renommer OPTypes, `pre-build.sh` propre (attention au piège documenté: jamais de `--force` casuel, sinon `MachineManager.TooMany()`). [S2][S3]
**J2**: XRPL: wallet en enclave, adresse de dépôt par mandat, `OfferCreate` signé+soumis à la main, issuer CUSD + trustlines + bot MM. Re-vérifier les détails XRPL sur xrpl.org.
**J3**: FtsoWatcher + state machine + exécution en tranches avec jitter + hystérésis. Premier stop-loss automatique de bout en bout (sans FDC).
**J4**: Contrats complets (MandateRegistry, events, cancel, relecture statut avant signature). Résultats async REPORT écrits onchain.
**J5**: FDC x2: preuve du dépôt et preuve du settlement (`Payment`, guides Hardhat/`FDC by hand`). C'est la journée la plus technique: round de vote ~90 s + DA Layer + `FdcVerification`. [S7]
**J6**: dApp Next.js: create (ECIES côté client: réutiliser l'helper de chiffrement du repo fce-sign pour garantir la compatibilité du schéma, ne pas improviser une lib), dashboard mandats, chart FTSO live avec ligne de trigger, log d'exécution avec liens explorers Coston2 + XRPL testnet. UI sous ANTI_SLOP.md, un artefact signature: le ticket d'ordre kerb.
**J7**: Hardening: expiry, refunds, restart recovery, idempotence Sequence, chemins d'erreur, option blob offchain. Tests E2E scriptés reproductibles (`make demo`).
**J8**: Stretch: déploiement Confidential Space réel (GCP) selon DEPLOYMENT_STEPS.md. Si ça résiste plus d'une demi-journée: on reste en simulé et on le documente. Diagramme d'archi + README complet.
**J9**: Vidéo démo 3 min (script section 7), déploiement final figé, soumission DoraHacks remplie à blanc.
**J10 (14 août)**: buffer + submit AVANT 15:59. Jamais à la dernière heure.

Règle de coupe si retard: on sacrifie dans l'ordre 1) TEE réel, 2) DCA (garder stop + limit), 3) blob offchain. On ne sacrifie JAMAIS: le E2E FCE, les deux preuves FDC, le trigger FTSO, la vidéo.

---

## 6. MAPPING CRITÈRES DU JURY -> CHOIX DU PLAN

- **Product usefulness**: un vrai manque du DEX XRPL depuis 2012, un user nommable (le holder XRPL), un problème que le jury Flare connaît par coeur.
- **Flare integration quality**: FCE officielle enregistrée dans TeeExtensionRegistry + FTSOv2 block-latency comme trigger + FDC Payment en double preuve (funding et settlement) + positionnement PMW documenté. Quatre briques Flare, toutes structurelles, zéro cosmétique.
- **Technical execution**: démo scriptée reproductible (`make demo`), state machine claire, honnêteté simulé vs réel, liens explorers pour chaque étape.
- **Evidence of new work**: 100% construit pendant le programme, commit history propre, `docs/WHATS_NEW.md` explicite (règle du règlement pour les projets existants retournée en avantage: "rien n'existait avant, tout est daté").
- **Clarity and future potential**: README qui tient en une page, roadmap = migration PMW + Songbird/mainnet + cosigners + paires FAssets (FXRP côté Flare). Le produit survit au hackathon parce qu'il est l'app cliente naturelle de PMW.

---

## 7. SCRIPT VIDÉO (3 min)
1. (0:00) Le problème en une phrase: le DEX XRPL n'a jamais eu de stop-loss non-custodial. Écran: le DEX vide d'outils.
2. (0:20) Créer un mandat stop-loss dans la dApp. Montrer le blob chiffré qui part onchain: personne ne peut lire le niveau.
3. (0:50) Dépôt XRP testnet, preuve FDC Payment, statut FUNDED onchain.
4. (1:20) Le prix FTSO descend (bot MM le suit), split screen: chart FTSO + explorer XRPL. Le trigger tape, les tranches partent, les fills apparaissent.
5. (2:10) Settlement payé sur XRPL, preuve FDC, mandat SETTLED. Chaîne de preuves complète à l'écran.
6. (2:30) Archi en un schéma: FCE + FTSO + FDC, et le slide PMW: "quand PMW ouvre, on branche le même produit dessus".
7. (2:50) Roadmap 3 lignes, fin.

---

## 8. CHECKLIST SOUMISSION (règlement)
- [ ] Nom: Kerb. Bounty: Confidential Compute Apps.
- [ ] Description courte + target user (holder XRPL).
- [ ] Lien démo live (dApp) + vidéo.
- [ ] Repo GitHub public, README une page, ARCHITECTURE.md, WHATS_NEW.md, PMW_MIGRATION.md.
- [ ] "How the project uses Flare": FCE/TeeExtensionRegistry + FTSOv2 + FDC Payment x2, avec adresses.
- [ ] Adresses de déploiement Coston2 + comptes XRPL testnet de démo.
- [ ] Roadmap / next steps.
- [ ] Encouragé: réseau de déploiement (Coston2), retours utilisateurs si possible (poster la démo dans le Telegram Flare avant la deadline et citer les retours = signal de traction gratuit).

---

## 9. RISQUES

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Credentials indexer lents à arriver | moyenne | bloque ext-proxy | demande J0 par 3 canaux; en attendant: dev en LOCAL_MODE, contrats, XRPL, watcher, UI n'en dépendent pas |
| Stack FCE instable (produit en dev) | moyenne | perte de jours | J1 = Hello World vert AVANT tout; page Troubleshooting officielle; pièges connus: mismatch OPType, `--force`, `ChallengeExpired` (re-run post-build), restart ext-proxy |
| FDC Payment XRPL testnet: source id / verifier | faible | J5 glisse | confirmer `testXRP` sur la page Attestation Types dès J0; fallback: prouver le dépôt seul et documenter le settlement proof en roadmap |
| Confidential Space réel trop long | haute | zéro (stretch) | rester en simulé, l'assumer, c'est le chemin documenté |
| Carnet XRPL testnet vide | certaine | démo plate | bot MM + IOU CUSD fournis (section 4.5) |
| ECIES front incompatible avec le node | moyenne | create cassé | réutiliser l'outil de chiffrement du repo fce-sign, pas de lib improvisée |

---

## 10. COMPTES ET OUTILS À PRÉPARER
Docker Desktop, Foundry, Go, Node 20+, ngrok (compte free, domaine réservé), wallet Coston2 fundé (faucet), 3 wallets XRPL testnet (user, issuer, MM) via faucet altnet, credentials indexer Flare (J0), compte GCP (stretch J8 uniquement).

---

## 11. OPTIONNEL SI AVANCE (ne pas commencer avant J7 fini)
- **Flare Smart Accounts**: onboarding des users XRPL sans wallet EVM pour créer le mandat. Grosse valeur jury, mais nouveau module: uniquement si le core est gelé. [S4]
- Feed secondaire (BTC/USD) pour montrer que le moteur est multi-paires.
- Blob offchain (hash onchain) en mode par défaut.

---

## SOURCES (vérifiées le 2026-08-04)
- [S1] FCC Overview (archi, FCE, PMW, warning statut): https://dev.flare.network/fcc/overview
- [S2] Build Your First Extension (scaffold, Coston2, SIMULATED_TEE, indexer, ngrok, troubleshooting): https://dev.flare.network/fcc/guides/getting-started
- [S3] Private Key Extension fce-sign (ECIES, /decrypt, /info, TS/Py/Go, DEPLOYMENT_STEPS): https://dev.flare.network/fcc/guides/sign-extension et https://github.com/flare-foundation/fce-sign
- [S4] Flare Developer Hub (Coston2, faucet FXRP/USDT0, PMW "in development", Smart Accounts, llms.txt, AI Skills, MCP): https://dev.flare.network/
- [S5] Vote STP.13 clôturé le 12 juillet 2026: https://www.tradingview.com/news/coindar:c15b5500f094b:0-flare-to-close-stp-13-vote-on-july-12th/
- [S6] FCC sur Songbird, Foundation opère les TEE en phase initiale: https://www.gncrypto.news/news/flare-xrpl-songbird-vote-july-6-fcc/
- [S7] FDC Overview (7 types, Payment = BTC/DOGE/XRP, Web2Json Coston/Coston2, workflow, fees): https://dev.flare.network/fdc/overview
- [S8] FTSOv2 Overview (~1,8 s, gratuit onchain, anchor 90 s, volatility incentives): https://dev.flare.network/ftso/overview
- Guides FDC pratiques: https://dev.flare.network/fdc/guides/hardhat et https://dev.flare.network/fdc/guides/fdc-by-hand
- Attestation Types (confirmer source XRPL testnet): https://dev.flare.network/fdc/attestation-types
- Feeds block-latency (confirmer feed id XRP/USD): https://dev.flare.network/ftso/feeds
- Exemple complémentaire: Weather Insurance Extension: https://dev.flare.network/fcc/guides/weather-insurance-extension
- Scaffold: https://github.com/flare-foundation/fce-extension-scaffold
- Règlement et exigences de soumission: page DoraHacks Flare Summer Signal (fournie par Thierno, deadline 2026-08-14 15:59)
