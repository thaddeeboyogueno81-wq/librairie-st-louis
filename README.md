# Librairie Papeterie Saint Louis — Version Netlify

Version adaptée à Netlify de la boutique de la Librairie Papeterie Saint Louis, Yaoundé.

## Fonctionnalités

- Site public responsive
- Catalogue dynamique
- Recherche et catégories
- Panier
- Commande en ligne
- Livraison ou retrait en boutique
- Paiement à la livraison / paiement au retrait
- Suivi par code de commande
- Confirmation de réception
- Espace gérant `/admin.html`
- Ajout, modification et masquage des produits
- Modification des prix et stocks en ligne
- Gestion des horaires
- Paramètres WhatsApp, téléphone, adresse et livraison
- Changement du mot de passe admin
- Sauvegarde JSON depuis l'administration
- SEO, sitemap et robots dynamiques via la Function
- Stock persistant
- Commandes persistantes
- Stockage persistant avec Netlify Blobs

## Architecture

Le frontend est servi comme site statique par Netlify.
Le backend est une Netlify Function : `netlify/functions/api.mjs`.
Les données persistantes utilisent `@netlify/blobs` dans le store `saint-louis-data`.

Cette version ne dépend plus de `server.js` ni d'une base SQLite locale. Elle est donc adaptée au modèle serverless de Netlify.

Netlify Blobs impose une limite de 5 Mo par valeur stockée. Les images importées depuis l'administration sont donc limitées à 2 Mo côté interface et contrôlées côté serveur.

## Déploiement Netlify

1. Décompresser le ZIP.
2. Mettre le dossier dans GitHub (racine du dépôt).
3. Dans Netlify : Add new project → Import an existing project → GitHub.
4. Sélectionner le dépôt.
5. Les paramètres sont déjà dans `netlify.toml` :
   - Publish directory : `public`
   - Functions directory : `netlify/functions`
   - Node : 22
6. Dans Netlify → Project configuration → Environment variables, créer :
   - `ADMIN_USER` = `admin` (ou un autre identifiant)
   - `ADMIN_PASSWORD` = un mot de passe fort d'au moins 10 caractères
7. Déployer.

## Espace gérant

Après le déploiement :

`https://TON-SITE.netlify.app/admin.html`

Identifiant : valeur de `ADMIN_USER`
Mot de passe : valeur de `ADMIN_PASSWORD`

Le gérant peut ensuite ajouter les produits et leurs prix directement en ligne.

## Important sur les données

Les produits, stocks, commandes, paramètres et sessions sont stockés dans Netlify Blobs, un stockage persistant accessible aux Functions et conservé entre les déploiements.

Pour une boutique avec beaucoup de produits, de commandes ou des besoins relationnels avancés, une vraie base PostgreSQL sera préférable. Cette version est conçue pour démarrer simplement sur Netlify sans serveur Node permanent.

## Paiements

La version actuelle fonctionne avec paiement à la livraison et paiement au retrait. Orange Money / MTN MoMo ne sont pas encore connectés à leurs API officielles.

## Crédit

Site réalisé par Thaddée Isaac Boyoguéno.
