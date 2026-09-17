# SoukEnLigne — Plateforme E-commerce pour le Tchad

## 🛒 Description
SoukEnLigne est une plateforme e-commerce conçue pour le marché tchadien. Elle permet de vendre des produits en ligne avec paiement à la livraison et communication WhatsApp intégrée.

## ✨ Fonctionnalités
- **Boutique en ligne** complète avec navigation par catégories et recherche
- **Pages produit** optimisées pour les réseaux sociaux (Open Graph)
- **Panier d'achat** sans inscription requise
- **Checkout** avec paiement à la livraison (Cash on Delivery)
- **WhatsApp** intégré pour commander ou contacter le vendeur
- **Comptes clients** avec suivi des commandes
- **Panneau d'administration** complet :
  - Gestion des produits (images, prix, promotions, stock)
  - Gestion des catégories
  - Gestion des commandes (statuts, notes)
  - Vue clients
  - Configuration de la boutique et zones de livraison
  - Statistiques de vente

## 🚀 Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
npm start
```

Le serveur démarre sur **http://localhost:3000**

## 🔐 Accès Admin

- URL : http://localhost:3000/admin
- Email : `admin@soukenligne.td`
- Mot de passe : `admin123`

> ⚠️ Changez le mot de passe admin en production !

## 💰 Devise
- Devise par défaut : **FCFA (XAF)** — Franc CFA d'Afrique centrale

## 📱 Mobile-first
Le site est conçu en priorité pour les smartphones. Tous les boutons d'achat et de contact WhatsApp sont optimisés pour le mobile.

## 🛠 Stack technique
- **Backend** : Node.js, Express.js
- **Base de données** : SQLite (via better-sqlite3)
- **Templating** : EJS
- **Auth** : Sessions + bcrypt
- **Upload** : Multer

## 📂 Structure du projet
```
soukenligne/
├── server.js              # Point d'entrée
├── db/
│   ├── init.js            # Initialisation DB + schéma
│   └── seed.js            # Données de démonstration
├── middleware/
│   ├── auth.js            # Authentification
│   ├── cart.js             # Panier
│   └── helpers.js          # Fonctions utilitaires
├── routes/
│   ├── shop.js             # Pages boutique
│   ├── cart.js             # Panier
│   ├── auth.js             # Connexion / inscription
│   ├── checkout.js         # Commandes
│   └── admin.js            # Administration
├── views/                  # Templates EJS
├── public/                 # Fichiers statiques (CSS, JS, images)
└── data/                   # Base de données SQLite (auto-créé)
```

## 🔮 Vision future
SoukEnLigne est conçu pour évoluer vers une plateforme multi-vendeurs (type Shopify) pour le marché tchadien et africain.
