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
