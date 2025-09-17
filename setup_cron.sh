#!/bin/bash

# Script pour configurer la collecte automatique de PFLOPS
# Ce script doit être exécuté par l'utilisateur pour configurer cron

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECT_SCRIPT="$SCRIPT_DIR/collect_pflops.js"
CRON_JOB="0 * * * * cd $SCRIPT_DIR && /usr/bin/node collect_pflops.js >> pflops_cron.log 2>&1"

echo "Configuration de la collecte automatique PFLOPS..."
echo "Répertoire: $SCRIPT_DIR"
echo "Script: $COLLECT_SCRIPT"

# Vérifier que le script existe
if [ ! -f "$COLLECT_SCRIPT" ]; then
    echo "Erreur: Script collect_pflops.js non trouvé dans $SCRIPT_DIR"
    exit 1
fi

# Vérifier que Node.js est disponible
if ! command -v node &> /dev/null; then
    echo "Erreur: Node.js n'est pas installé ou pas dans le PATH"
    exit 1
fi

# Tester le script une fois
echo "Test du script de collecte..."
cd "$SCRIPT_DIR"
if node collect_pflops.js; then
    echo "✓ Script testé avec succès"
else
    echo "✗ Erreur lors du test du script"
    exit 1
fi

# Ajouter la tâche cron
echo "Ajout de la tâche cron (toutes les heures)..."
echo "Commande cron: $CRON_JOB"

# Sauvegarder le crontab actuel
crontab -l > /tmp/current_cron 2>/dev/null || true

# Vérifier si la tâche existe déjà
if grep -q "collect_pflops.js" /tmp/current_cron 2>/dev/null; then
    echo "La tâche cron existe déjà. Voulez-vous la remplacer ? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        # Supprimer l'ancienne tâche et ajouter la nouvelle
        grep -v "collect_pflops.js" /tmp/current_cron > /tmp/new_cron
        echo "$CRON_JOB" >> /tmp/new_cron
        crontab /tmp/new_cron
        echo "✓ Tâche cron mise à jour"
    else
        echo "Configuration annulée"
        exit 0
    fi
else
    # Ajouter la nouvelle tâche
    echo "$CRON_JOB" >> /tmp/current_cron
    crontab /tmp/current_cron
    echo "✓ Tâche cron ajoutée"
fi

# Nettoyer les fichiers temporaires
rm -f /tmp/current_cron /tmp/new_cron

echo ""
echo "Configuration terminée !"
echo ""
echo "La collecte PFLOPS se fera automatiquement toutes les heures."
echo "Fichier de log: $SCRIPT_DIR/pflops_cron.log"
echo "Fichier de données: $SCRIPT_DIR/pflops_data.json"
echo ""
echo "Pour vérifier les tâches cron actives:"
echo "  crontab -l"
echo ""
echo "Pour désactiver la collecte automatique:"
echo "  crontab -e"
echo "  # puis supprimer la ligne contenant 'collect_pflops.js'"
echo ""