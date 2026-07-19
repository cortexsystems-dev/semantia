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
        a[i] += ((b[i] - a[i]) * 0.05)
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

function computePmi() {
    //10 frame check

    if (vidWindow.length > 4840) {

        audWindow.forEach(audIndex => {
            vidWindow.forEach(vidIndex => {
                let key = String(audIndex + "," + vidIndex)
                pairs[key] = (pairs[key] || 0) + 1

                let a = audcounts[audIndex]
                let b = vidcounts[vidIndex]
                let c = pairs[key]

                let pmi = calcRelPMI(a, b, c)
                pairsPmi[key] = pmi

            })
        })
        vidWindow = []
        audWindow = []
    }
}

/**
 * Calculates a relative PMI approximation for continuous media streams without needing N.
 * Handles the condition where Audio (A) occurs without Video (B).
 * 
 * @param {number} countA - Total duration or frame count where Audio is present.
 * @param {number} countB - Total duration or frame count where Video feature is present.
 * @param {number} coCountAB - Joint duration/frames where both Audio and Video occur together.
 * @returns {Object} Relative affinity metrics.
 */
function calcRelPMI(countA, countB, coCountAB) {
    // Guard against division by zero
    if (countA === 0 || countB === 0 || coCountAB === 0) {
        return { relativePmi: -Infinity, ratioAWithoutB: 1.0 };
    }

    // 1. Calculate how often Audio appears completely WITHOUT Video
    const countAWithoutB = countA - coCountAB;
    const ratioAWithoutB = Math.abs(countAWithoutB / countA);

    // 2. Approximate PMI by removing N from the core ratio.
    // This represents the raw multiplier of joint presence over independent presence.
    const coreRatio = coCountAB / (countA * countB);
    const relativePmi = Math.log2(coreRatio);

    return {
        relativePmi: parseFloat(relativePmi.toFixed(4)), // Shifted by a constant of -log2(N)
        ratioAWithoutB: parseFloat(ratioAWithoutB.toFixed(4)), // 0 = always together, 1 = never together
        coOccurrenceRateInA: parseFloat((coCountAB / countA).toFixed(4)) // P(B|A)
    };
}


/* 
Output:
{ 
  relativePmi: -13.3896,       <-- Use this to compare against other audio/video pairs
  ratioAWithoutB: 0.8889,      <-- 88.89% of the audio happened without the video
  coOccurrenceRateInA: 0.1111  <-- Only 11.11% of audio co-occurred with video
}
*/

function highlight(id, x, y, canvas) {

    for (let i = 0; i < audWindow.length; i++) {
        let key = String(audWindow[i] + "," + id)

        let pmiInfo = pairsPmi[key]
        if (pmiInfo) {
            let val = pmiInfo.ratioAWithoutB
            if (val < 0.1) {

                let ctx = canvas.getContext("2d")
                // Set the border (stroke) color
                ctx.strokeStyle = '#00FF00'; // Bright green
                ctx.lineWidth = 1;

                // Draw an unfilled square
                ctx.strokeRect(x, y, 9, 9);
                return


            }
        }
    }
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
async function loadState() {
    try {
        const db = await initDatabase();
        const tx = db.transaction('systemState', 'readonly');
        const store = tx.objectStore('systemState');

        // Read the primary check variable inside the active transaction window
        const savedVideoCount = await getStorageItem(store, 'videoFeatureCount');

        if (savedVideoCount === undefined) {
            console.log("Database active. No previous records found. Starting fresh.");
            return;
        }

        // Pull the rest of the payloads sequentially
        videoFeatureCount = savedVideoCount;
        audioFeatureCount = await getStorageItem(store, 'audioFeatureCount') || 0;
        learnedVideoFeatures = await getStorageItem(store, 'learnedVideoFeatures') || [];
        learnedAudioFeatures = await getStorageItem(store, 'learnedAudioFeatures') || [];
        vidcounts = await getStorageItem(store, 'vidcounts') || [];
        audcounts = await getStorageItem(store, 'audcounts') || [];
        pairs = await getStorageItem(store, 'pairs') || {};
        pairsPmi = await getStorageItem(store, 'pairsPmi') || {};

        // Sync GPU Memory and rebuild UI elements for Video
        for (let i = 0; i < videoFeatureCount; i++) {
            if (learnedVideoFeatures[i]) {
                videoMatcher.learnFeature(i, learnedVideoFeatures[i]);
                paintVector(learnedVideoFeatures[i], true, 0, 0, i, true);
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