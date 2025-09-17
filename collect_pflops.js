#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = 'https://nodes.amadeus.bot/api/chain/stats';
const DATA_FILE = path.join(__dirname, 'pflops_data.json');

// Fonction pour faire une requête HTTPS
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error('Failed to parse JSON response'));
                }
            });
        }).on('error', reject);
    });
}

// Fonction pour charger les données existantes
function loadExistingData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading existing data:', error.message);
    }
    return { data: [] };
}

// Fonction pour sauvegarder les données
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`Data saved successfully. Total entries: ${data.data.length}`);
    } catch (error) {
        console.error('Error saving data:', error.message);
        process.exit(1);
    }
}

// Fonction principale
async function collectPFLOPS() {
    try {
        console.log(`[${new Date().toISOString()}] Collecting PFLOPS data...`);

        // Récupérer les statistiques de la chaîne
        const response = await makeRequest(API_URL);
        const stats = response.stats;

        if (!stats || !stats.pflops) {
            console.error('PFLOPS data not found in API response');
            process.exit(1);
        }

        // Charger les données existantes
        const existingData = loadExistingData();

        // Créer une nouvelle entrée
        const newEntry = {
            timestamp: Date.now(),
            date: new Date().toISOString(),
            pflops: stats.pflops,
            epoch: Math.floor(stats.height / 100000), // Calculer l'epoch
            height: stats.height || null,
            circulating: stats.circulating || null
        };

        // Ajouter la nouvelle entrée
        existingData.data.push(newEntry);

        // Garder seulement les 30 derniers jours (24 * 30 = 720 entrées max)
        if (existingData.data.length > 720) {
            existingData.data = existingData.data.slice(-720);
        }

        // Sauvegarder
        saveData(existingData);

        console.log(`PFLOPS: ${stats.pflops}, Epoch: ${stats.epoch || 'N/A'}, Height: ${stats.height || 'N/A'}`);

    } catch (error) {
        console.error('Error collecting PFLOPS:', error.message);
        process.exit(1);
    }
}

// Exécuter la collecte
collectPFLOPS();