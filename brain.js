const video = document.querySelector('video');
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');

// --- Global Matchers & Constants ---
const MAX_VIDEO_FEATURES = 1024;
const MAX_AUDIO_FEATURES = 1024;

let videoMatcher;
let audioMatcher;

// Video State
let videoFeatureCount = 0;
let learnedVideoFeatures = [];

// Audio State
let audioFeatureCount = 0;
let learnedAudioFeatures = [];

let vidWindow = []
let audWindow = []

let pairs = []
let pairsPmi = []
let vidcounts = []
let audcounts = []

let toHighlight = []

// --- Main Initialization ---
async function start() {

  // 1. Initialize Global WebGPU Device & Matchers
  await initGlobalWebGPU();

  // Create video matcher: max 4096 features, max 1024 patches per frame, 243 elements per patch (9x9x3)
  videoMatcher = new FeatureMatcher(MAX_VIDEO_FEATURES, 1024, 243);
  videoMatcher.init();

  // Create audio matcher: max 4096 features, 1 vector per frame, 255 elements per vector
  audioMatcher = new FeatureMatcher(MAX_AUDIO_FEATURES, 1, 255);
  audioMatcher.init();

  await loadState();

  setInterval(saveState, 30000)

  // 2. Start Video Stream
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      video.srcObject = stream;
      video.play().then(() => {
        drawVideo();
      });
    })
    .catch(err => console.error(`A video error occurred: ${err}`));

  // 3. Start Audio Stream
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(audioCtx.destination);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      let cnvs = document.getElementById("canvas2");
      cnvs.width = cnvs.clientWidth || 800;
      cnvs.height = cnvs.clientHeight || 400;

      // Start the visualizer (from audio.js)
      drawLiveSpectrogram(analyser, cnvs);

      // Start the audio feature recognition loop
      processAudioFeatures(analyser);
    })
    .catch(err => console.error(`An audio error occurred: ${err}`));
}

// --- Video Processing Loop ---
async function drawVideo() {
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  // format is rgba with no delineator
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  let matrix = frame2matrix(canvas);
  let vectors = extractSections(matrix, 9, true);

  if (vectors.length === 0) {
    requestAnimationFrame(drawVideo);
    return;
  }

  // Initialize the first video feature
  if (learnedVideoFeatures.length == 0) {
    videoMatcher.learnFeature(0, vectors[0]);
    videoFeatureCount++;
    learnedVideoFeatures.push(vectors[0]);
    paintVector(learnedVideoFeatures[0], true, 0, 0, 0, true);

  }

  let pool = [];

  // Capture static frame count
  let frameFeatureCount = videoFeatureCount;

  // GPU DO THE HEAVY LIFTING (Returns [score, idx, score, idx...])
  let bestMatches = await videoMatcher.processVectors(vectors, frameFeatureCount);

  // SYNCHRONOUSLY PARSE THE RESULTS
  for (let vi = 0; vi < vectors.length; vi++) {
    let vector = vectors[vi];

    // The array is paired, so multiply vector index by 2
    let best = bestMatches[vi * 2];
    let bestIndex = bestMatches[vi * 2 + 1];

    if (best > 5000 || bestIndex === -1) {
      if (videoFeatureCount < MAX_VIDEO_FEATURES) {

        videoMatcher.learnFeature(videoFeatureCount, vector);
        paintVector(vector, true, 0, 0, videoFeatureCount, true);
        learnedVideoFeatures.push(vector);
        pool.push(videoFeatureCount);
        vidWindow.push(videoFeatureCount)
        videoFeatureCount++;
      

      } else {
        if (bestIndex !== -1 && learnedVideoFeatures[bestIndex]) {
          modFeature(learnedVideoFeatures[bestIndex], vector);
          videoMatcher.learnFeature(bestIndex, learnedVideoFeatures[bestIndex]);
          pool.push(bestIndex);
          vidWindow.push(bestIndex)
          paintVector(learnedVideoFeatures[bestIndex], true, 0, 0, bestIndex, false);
        }
      }
    } else {
      pool.push(bestIndex);
      vidWindow.push(bestIndex)
    }
  }

  let poolRows = [];
  for (let i = 0; i < pool.length; i += 22) {
    poolRows.push(pool.slice(i, i + 22));
  }

  let poolVectors = extractSections(poolRows, 2, false);
  paintPool(poolVectors, learnedVideoFeatures);

  // Update UI Stats
  document.getElementById("vistats").innerText =
    `Video Features: ${videoFeatureCount} | Audio Features: ${audioFeatureCount}`;

  computePmi()
  toHighlight =  []

  requestAnimationFrame(drawVideo);
}

// --- Audio Processing Loop ---
async function processAudioFeatures(analyser) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  // Rolling buffer to hold the last 5 time slices
  let slidingWindow = [];

  async function analyzeAudio() {

    analyser.getByteFrequencyData(dataArray);

    // Reduce current frame to 51 bins
    let currentSlice = reduceFrequencyData(dataArray, 51);

    // Manage the rolling time window
    slidingWindow.push(currentSlice);
    if (slidingWindow.length > 5) {
      slidingWindow.shift(); // Remove the oldest slice
    }

    // Wait until the buffer is full before trying to match
    if (slidingWindow.length < 5) {
      requestAnimationFrame(analyzeAudio);
      return;
    }

    // Flatten the 5 slices (5 x 51) into a single 255-byte vector
    let combinedVector = new Uint8Array(255);
    for (let i = 0; i < 5; i++) {
      combinedVector.set(slidingWindow[i], i * 51);
    }

    // NOISE GATE: Check if the rolling window is mostly quiet
    let totalVolume = 0;
    for (let i = 0; i < combinedVector.length; i++) {
      totalVolume += combinedVector[i];
    }
    let averageVolume = totalVolume / combinedVector.length;

    if (averageVolume < 8) {
      // We still tick the frame forward, but we don't learn/match silence
      requestAnimationFrame(analyzeAudio);
      return;
    }

    // NORMALIZE: Make the GPU match the sound's shape, not its volume
    normalize(combinedVector);

    let vectors = [combinedVector];

    if (learnedAudioFeatures.length === 0) {
      audioMatcher.learnFeature(0, vectors[0]);
      pairs[0] = {}
      pairsPmi[0] = {}
      audioFeatureCount++;
      learnedAudioFeatures.push(vectors[0]);
      audWindow.push(0)
    }

    let frameFeatureCount = audioFeatureCount;
    let bestMatches = await audioMatcher.processVectors(vectors, frameFeatureCount);

    let best = bestMatches[0];
    let bestIndex = bestMatches[1];

    if (best > 3000 || bestIndex === -1) {
      if (audioFeatureCount < MAX_AUDIO_FEATURES) {
        audioMatcher.learnFeature(audioFeatureCount, vectors[0]);
        learnedAudioFeatures.push(vectors[0]);
        audWindow.push(audioFeatureCount)
        pairs[audioFeatureCount] = {}
        pairsPmi[audioFeatureCount] = {}
        audioFeatureCount++;
      } else {
        if (bestIndex !== -1 && learnedAudioFeatures[bestIndex]) {
          modFeature(learnedAudioFeatures[bestIndex], vectors[0]);
          audioMatcher.learnFeature(bestIndex, learnedAudioFeatures[bestIndex]);
          audWindow.push(bestIndex)
        }
      }
    }
    else {
      audWindow.push(bestIndex)
    }

    toHighlight =  getNBest(12,audWindow[audWindow.length-1])

    requestAnimationFrame(analyzeAudio);
  }

  analyzeAudio();
}

