// src/infrastructure/cache.js

import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.resolve('vuln-cache.json');
let sentVulnsCache = new Set();

/**
 * Gera uma chave única para a vulnerabilidade.
 * Prioriza o cveId, mas usa o link como fallback.
 * @param {Vulnerability} vuln
 * @returns {string} A chave única.
 */
function getCacheKey(vuln) {
    return vuln.cveId || vuln.link;
}

/**
 * Carrega o cache do arquivo JSON para a memória.
 * Deve ser chamado na inicialização do aplicativo.
 */
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const fileContent = fs.readFileSync(CACHE_FILE, 'utf-8');
            const cachedItems = JSON.parse(fileContent);
            sentVulnsCache = new Set(cachedItems);
            console.log(`[Cache] Cache carregado com ${sentVulnsCache.size} itens.`);
        } else {
            console.log('[Cache] Nenhum arquivo de cache encontrado. Iniciando um novo.');
        }
    } catch (error) {
        console.error('[Cache] Falha ao carregar o arquivo de cache:', error);
    }
}

/**
 * Salva o cache da memória para o arquivo JSON.
 */
function saveCache() {
    try {
        const cacheArray = Array.from(sentVulnsCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheArray, null, 2));
        console.log(`[Cache] Cache salvo com ${sentVulnsCache.size} itens.`);
    } catch (error) {
        console.error('[Cache] Falha ao salvar o arquivo de cache:', error);
    }
}

/**
 * Verifica se uma vulnerabilidade já está no cache.
 * @param {Vulnerability} vuln
 * @returns {boolean}
 */
function has(vuln) {
    return sentVulnsCache.has(getCacheKey(vuln));
}

/**
 * Adiciona uma vulnerabilidade ao cache.
 * @param {Vulnerability} vuln
 */
function add(vuln) {
    sentVulnsCache.add(getCacheKey(vuln));
}

export { loadCache, saveCache, has, add };