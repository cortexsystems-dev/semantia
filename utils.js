function poolCompare(v, learned) {
    let scores = []

    learned.forEach(pv => {
        let score = 0
        for (let i = 0; i < pv.length; i++) {
            if (pv[i] !== v[i]) { score++ }
        }
        scores.push(score)
    })

    return scores

}

function modFeature(a, b) {
    for (let i = 0; i < a.length; i++) {
        a[i] += ((b[i] - a[i]) * 0.02)
    }
}

function modPool(a, b) {
    let rand = Math.floor(Math.random() * a.length)
    a[rand] = b[rand]
}

function normalize(data) {

    let min = 256
    let max = 0

    for (let i = 0; i < data.length; i++) {
        if (data[i] > max) { max = data[i] } else {
            if (data[i] < min) {
                min = data[i]
            }
        }
    }

    let scale = max - min

    for (let i = 0; i < data.length; i++) {
        data[i] = Math.round(((data[i] - min) / scale) * 255)

    }


}

// Global Configuration
const DECAY = 0.999; // Retains memory across roughly 1,000 frame-blocks to find stable linguistic rules
const SMOOTHING = 1.0; // Stabilizes rare pairings from blowing up early on

function computePmi() {
    // 10 frame-block token accumulation boundary
    if (vidWindow.length > 4840) {
        if (audWindow.length > 0) {

            // 1. Decay token histories gently so the system is slightly weighted toward recent semantics
            for (let key in audcounts) audcounts[key] *= DECAY;
            for (let key in vidcounts) vidcounts[key] *= DECAY;
            for (let aKey in pairs) {
                for (let vKey in pairs[aKey]) {
                    pairs[aKey][vKey] *= DECAY;
                }
            }

            // 2. Identify unique structural tokens present in this temporal slice
            const uniqueAud = [...new Set(audWindow)];
            const uniqueVid = [...new Set(vidWindow)];

            // 3. Increment historical contexts
            uniqueAud.forEach(audIndex => audcounts[audIndex] = (audcounts[audIndex] || 0) + 1);
            uniqueVid.forEach(vidIndex => vidcounts[vidIndex] = (vidcounts[vidIndex] || 0) + 1);

            // 4. Map cross-modal pairs and calculate Sørensen-Dice correlation
            uniqueAud.forEach(audIndex => {
                uniqueVid.forEach(vidIndex => {
                    let key = String(vidIndex);

                    if (!pairs[audIndex]) pairs[audIndex] = {};
                    if (!pairsPmi[audIndex]) pairsPmi[audIndex] = {};

                    pairs[audIndex][key] = (pairs[audIndex][key] || 0) + 1;

                    let a = audcounts[audIndex];
                    let b = vidcounts[vidIndex];
                    let c = pairs[audIndex][key];

                    // 5. Normalization bounded explicitly between 0.0 and 1.0
                    // Perfect alignment yields 1.0; unaligned noise drops near 0
                    let diceScore = (2 * c) / (a + b + SMOOTHING);

                    pairsPmi[audIndex][key] = Number(diceScore.toFixed(5))
                });
            });
        }

        // Reset buffers for the next observation window
        vidWindow = [];
        audWindow = [];
    }
}



function getNBest(n, id) {

    let valObj = JSON.parse(JSON.stringify(pairsPmi[id]))

    let best = []

    for (let i = 0; i < n; i++) {
        let max = -10
        let winner = undefined

        Object.keys(valObj).forEach(vId => {
            if (valObj[vId] >= max) {
                winner = Number(vId)
                max = valObj[vId]
            }
        })

        best.push(winner)

        delete valObj[String(winner)]

    }
    return best


}

function highlight(id, x, y, cnvs) {
    let ctx = cnvs.getContext("2d")
    // Set the border (stroke) color
    ctx.strokeStyle = '#00FF00'; // Bright green
    ctx.lineWidth = 1;

    // Draw an unfilled square
    ctx.strokeRect(x, y, 9, 9);
}

/**
 * Promisified database initializer. 
 * Guarantees the database and tables exist before resolving.
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CognitiveSystemDB_v3', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('systemState')) {
                db.createObjectStore('systemState');
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Helper to safely wrap IndexedDB store operations in clean Promises.
 */
function getStorageItem(store, key) {
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Saves the entire application state comprehensively to IndexedDB.
 */
async function saveState() {
    try {
        const db = await initDatabase();
        const tx = db.transaction('systemState', 'readwrite');
        const store = tx.objectStore('systemState');

        // IndexedDB natively stores binary Uint8Arrays without stringifying them
        store.put(videoFeatureCount, 'videoFeatureCount');
        store.put(audioFeatureCount, 'audioFeatureCount');
        store.put(learnedVideoFeatures, 'learnedVideoFeatures');
        store.put(learnedAudioFeatures, 'learnedAudioFeatures');
        store.put(vidcounts, 'vidcounts');
        store.put(audcounts, 'audcounts');
        store.put(pairs, 'pairs');
        store.put(pairsPmi, 'pairsPmi');

        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        console.log("System state safely saved to IndexedDB.");
    } catch (error) {
        console.error("Failed to save state:", error);
    }
}

/**
 * Loads the complete system state sequentially from IndexedDB.
 */
/**
 * Loads the complete system state sequentially from IndexedDB.
 */
async function loadState() {
    try {
        const db = await initDatabase();
        const tx = db.transaction('systemState', 'readonly');
        const store = tx.objectStore('systemState');

        const savedVideoCount = await getStorageItem(store, 'videoFeatureCount');

        if (savedVideoCount === undefined) {
            console.log("Database active. No previous records found. Starting fresh.");
            return;
        }

        videoFeatureCount = savedVideoCount;
        audioFeatureCount = await getStorageItem(store, 'audioFeatureCount') || 0;
        learnedVideoFeatures = await getStorageItem(store, 'learnedVideoFeatures') || [];
        learnedAudioFeatures = await getStorageItem(store, 'learnedAudioFeatures') || [];
        vidcounts = await getStorageItem(store, 'vidcounts') || [];
        audcounts = await getStorageItem(store, 'audcounts') || [];
        pairs = await getStorageItem(store, 'pairs') || {};
        pairsPmi = await getStorageItem(store, 'pairsPmi') || {};

        const fastModeCheckbox = document.getElementById('fastModeCheckbox');
        const isFastMode = fastModeCheckbox ? fastModeCheckbox.checked : false;

        // Sync GPU Memory and rebuild UI elements for Video
        for (let i = 0; i < videoFeatureCount; i++) {
            if (learnedVideoFeatures[i]) {
                videoMatcher.learnFeature(i, learnedVideoFeatures[i]);
                // Only paint to the DOM automatically if Fast Mode is off
                if (!isFastMode) {
                    paintVector(learnedVideoFeatures[i], true, 0, 0, i, true);
                }
            }
        }

        // Sync GPU Memory for Audio
        for (let i = 0; i < audioFeatureCount; i++) {
            if (learnedAudioFeatures[i]) {
                audioMatcher.learnFeature(i, learnedAudioFeatures[i]);
            }
        }

        console.log(`Successfully restored state: ${videoFeatureCount} video & ${audioFeatureCount} audio features.`);
    } catch (error) {
        console.error("Failed to restore state from IndexedDB:", error);
    }
}

/**
 * Completely clears the database store and refreshes the application.
 */
async function reset() {
    if (!confirm("Are you sure you want to reset? This wipes everything.")) {
        return;
    }
    try {
        const db = await initDatabase();
        const tx = db.transaction('systemState', 'readwrite');
        tx.objectStore('systemState').clear();

        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        window.location.reload();
    } catch (error) {
        console.error("Reset failed:", error);
    }
}

/**
 * Exports the complete IndexedDB state to a downloadable JSON file.
 */
async function exportState() {
    try {
        const db = await initDatabase();
        const tx = db.transaction('systemState', 'readonly');
        const store = tx.objectStore('systemState');

        // 1. Fetch the video count first to check if the database is empty
        const savedVideoCount = await getStorageItem(store, 'videoFeatureCount');
        
        if (savedVideoCount === undefined) {
            alert("No data found! Please wait for the system to auto-save (up to 30 seconds) before exporting.");
            return; // Halt the export
        }

        // 2. Fetch the rest of the tracked keys
        const exportData = {
            videoFeatureCount: savedVideoCount,
            audioFeatureCount: await getStorageItem(store, 'audioFeatureCount'),
            learnedVideoFeatures: await getStorageItem(store, 'learnedVideoFeatures'),
            learnedAudioFeatures: await getStorageItem(store, 'learnedAudioFeatures'),
            vidcounts: await getStorageItem(store, 'vidcounts'),
            audcounts: await getStorageItem(store, 'audcounts'),
            pairs: await getStorageItem(store, 'pairs'),
            pairsPmi: await getStorageItem(store, 'pairsPmi')
        };

        // Stringify the data, converting typed arrays to standard arrays
        const jsonString = JSON.stringify(exportData, (key, value) => {
            if (value instanceof Uint8Array || value instanceof Float32Array) {
                return Array.from(value);
            }
            return value;
        });

        // Create a blob and trigger a silent download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `semantia_state_${new Date().getTime()}.json`;
        
        document.body.appendChild(a);
        a.click();
        
        // Clean up the DOM and memory
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log("Database exported successfully.");
    } catch (error) {
        console.error("Export failed:", error);
        alert("Failed to export database. Check console for details.");
    }
}