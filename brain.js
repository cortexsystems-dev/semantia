const video = document.querySelector('video');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');

// --- OVERLAY CANVAS SETUP ---
const overlayCanvas = document.getElementById('canvasOverlay');
const overlayContext = overlayCanvas.getContext('2d');

const MAX_VIDEO_FEATURES = 1024;
const MAX_AUDIO_FEATURES = 1024;

// Add hit trackers to stabilize feature drift
let videoFeatureHits = new Array(MAX_VIDEO_FEATURES).fill(1);
let audioFeatureHits = new Array(MAX_AUDIO_FEATURES).fill(1);

// FPS throttling constants
let lastVideoFrameTime = 0;
const VIDEO_FPS = 15; // Target 15 FPS to save battery
const VIDEO_FRAME_INTERVAL = 1000 / VIDEO_FPS;

let videoMatcher;
let audioMatcher;

let videoFeatureCount = 0;
let learnedVideoFeatures = [];

let audioFeatureCount = 0;
let learnedAudioFeatures = [];

let vidWindow = []
let audWindow = []

let pairs = []
let pairsPmi = []
let vidcounts = []
let audcounts = []

let toHighlight = []

window.isFastModeActive = true;

window.toggleFastMode = function () {
  const checkbox = document.getElementById('fastModeCheckbox');
  window.isFastModeActive = checkbox ? checkbox.checked : false;

  // 1. Sync the CSS class on the body so the !important rule drops
  if (window.isFastModeActive) {
    document.body.classList.add('fast-mode');
  } else {
    document.body.classList.remove('fast-mode');
  }

  const poolCanvas = document.getElementById('canvas3');
  const poolPanel = poolCanvas ? poolCanvas.closest('.panel') : null;
  const dictPanel = document.querySelector('.learned-features-container');

  if (window.isFastModeActive) {
    if (poolPanel) poolPanel.style.display = 'none';
    if (dictPanel) dictPanel.style.display = 'none';
    document.querySelectorAll('canvas[id]:not(#canvas):not(#canvas2):not(#canvas3):not(#canvasOverlay)').forEach(c => c.style.display = 'none');
    document.querySelectorAll('body > span').forEach(s => s.style.display = 'none');
  } else {
    if (poolPanel) poolPanel.style.display = 'flex';
    if (dictPanel) dictPanel.style.display = 'block';
    document.querySelectorAll('canvas[id]:not(#canvas):not(#canvas2):not(#canvas3):not(#canvasOverlay)').forEach(c => c.style.display = 'inline-block');
    document.querySelectorAll('body > span').forEach(s => s.style.display = 'inline-block');

    if (typeof videoFeatureCount !== 'undefined') {
      for (let i = 0; i < videoFeatureCount; i++) {
        if (learnedVideoFeatures[i] && !document.getElementById(String(i))) {
          paintVector(learnedVideoFeatures[i], true, 0, 0, i, true);
        }
      }
    }
  }
};

async function start() {
  await initGlobalWebGPU();

  videoMatcher = new FeatureMatcher(MAX_VIDEO_FEATURES, 1024, 243, 256);
  videoMatcher.init();

  // 64 frequency bins * 15 temporal slices = 960 bytes (Aligned to 1024 bytes)
  audioMatcher = new FeatureMatcher(MAX_AUDIO_FEATURES, 1, 960, 1024);
  audioMatcher.init();

  await loadState();
  window.toggleFastMode();

  setInterval(saveState, 30000)

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      video.srcObject = stream;
      video.play().then(() => {
        drawVideo();
      });
    })
    .catch(err => console.error(`A video error occurred: ${err}`));

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Disable built-in processing to isolate raw animal calls
  navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })
    .then(stream => {
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(audioCtx.destination);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      let cnvs = document.getElementById("canvas2");
      cnvs.width = cnvs.clientWidth || 800;
      cnvs.height = cnvs.clientHeight || 400;

      drawLiveSpectrogram(analyser, cnvs);
      processAudioFeatures(analyser);
    })
    .catch(err => console.error(`An audio error occurred: ${err}`));
}

// --- Video Processing Loop ---
async function drawVideo() {
  const checkbox = document.getElementById('fastModeCheckbox');
  const isFastMode = checkbox ? checkbox.checked : false;

  // Aspect Ratio Correction
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = canvas.width / canvas.height;
  let drawWidth = canvas.width;
  let drawHeight = canvas.height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > canvasRatio) {
    drawWidth = canvas.height * videoRatio;
    offsetX = (canvas.width - drawWidth) / 2;
  } else {
    drawHeight = canvas.width / videoRatio;
    offsetY = (canvas.height - drawHeight) / 2;
  }

  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  let matrix = frame2matrix(canvas);
  let vectors = extractSections(matrix, 9, true);

  if (vectors.length === 0) {
    requestAnimationFrame(drawVideo);
    return;
  }

  if (learnedVideoFeatures.length == 0) {
    videoMatcher.learnFeature(0, vectors[0]);
    videoFeatureCount++;
    learnedVideoFeatures.push(vectors[0]);
    if (!isFastMode) paintVector(learnedVideoFeatures[0], true, 0, 0, 0, true);
  }

  let pool = [];
  let frameFeatureCount = videoFeatureCount;
  let bestMatches = await videoMatcher.processVectors(vectors, frameFeatureCount);

  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  let xSteps = [];
  let ySteps = [];
  for (let y = 0; y < canvas.height - 9; y += 9) {
    for (let x = 0; x < canvas.width - 9; x += 9) {
      xSteps.push(x);
      ySteps.push(y);
    }
  }

  for (let vi = 0; vi < vectors.length; vi++) {
    let vector = vectors[vi];
    let best = bestMatches[vi * 2];
    let bestIndex = bestMatches[vi * 2 + 1];
    let x = xSteps[vi];
    let y = ySteps[vi];

    if (best > 5000 || bestIndex === -1) {
      if (videoFeatureCount < MAX_VIDEO_FEATURES) {
        videoMatcher.learnFeature(videoFeatureCount, vector);
        if (!isFastMode) paintVector(vector, true, 0, 0, videoFeatureCount, true);
        learnedVideoFeatures.push(vector);
        pool.push(videoFeatureCount);
        vidWindow.push(videoFeatureCount);
        videoFeatureCount++;
      } else {
        if (bestIndex !== -1 && learnedVideoFeatures[bestIndex]) {
          modFeature(learnedVideoFeatures[bestIndex], vector);
          videoMatcher.learnFeature(bestIndex, learnedVideoFeatures[bestIndex]);
          pool.push(bestIndex);
          vidWindow.push(bestIndex);
          if (!isFastMode) paintVector(learnedVideoFeatures[bestIndex], true, 0, 0, bestIndex, false);
        }
      }
    } else {
      pool.push(bestIndex);
      vidWindow.push(bestIndex);
    }

    if (isFastMode && toHighlight.includes(bestIndex)) {
      highlight(bestIndex, x, y, overlayCanvas);
    }
  }

  if (!isFastMode) {
    let poolRows = [];
    for (let i = 0; i < pool.length; i += 22) {
      poolRows.push(pool.slice(i, i + 22));
    }
    let poolVectors = extractSections(poolRows, 2, false);
    paintPool(poolVectors, learnedVideoFeatures);
  }

  document.getElementById("vistats").innerText =
    `Video Features: ${videoFeatureCount} | Audio Features: ${audioFeatureCount}`;

  computeCorrelation();
  requestAnimationFrame(drawVideo);
}

// --- Audio Processing Helper ---
function updateTokenFeed() {
  const feedEl = document.getElementById("audioTokenFeed");
  if (feedEl) {
    feedEl.innerText = audWindow.slice(-150).join("  ");
  }
}

async function processAudioFeatures(analyser) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let slidingWindow = [];

  const TARGET_BINS = 64;
  const TEMPORAL_SLICES = 15;
  const VECTOR_SIZE = TARGET_BINS * TEMPORAL_SLICES;

  let frameCounter = 0; // Add a counter to track frames

  async function analyzeAudio() {
    analyser.getByteFrequencyData(dataArray);
    let currentSlice = reduceFrequencyData(dataArray, TARGET_BINS);

    slidingWindow.push(currentSlice);
    if (slidingWindow.length > TEMPORAL_SLICES) {
      slidingWindow.shift();
    }

    // Only process the match every 5 frames (adjust this number to change the hop size)
    frameCounter++;
    if (slidingWindow.length < TEMPORAL_SLICES || frameCounter % 5 !== 0) {
      requestAnimationFrame(analyzeAudio);
      return;
    }

    let combinedVector = new Uint8Array(VECTOR_SIZE);
    for (let i = 0; i < TEMPORAL_SLICES; i++) {
      combinedVector.set(slidingWindow[i], i * TARGET_BINS);
    }

    let totalVolume = 0;
    for (let i = 0; i < combinedVector.length; i++) {
      totalVolume += combinedVector[i];
    }
    let averageVolume = totalVolume / combinedVector.length;

    if (averageVolume < 4) {
      toHighlight = [];
      requestAnimationFrame(analyzeAudio);
      return;
    }

    normalize(combinedVector);
    let vectors = [combinedVector];

    // ... The rest of the matching logic remains exactly the same ...

    if (learnedAudioFeatures.length === 0) {
      audioMatcher.learnFeature(0, vectors[0]);
      pairs[0] = {};
      pairsPmi[0] = {};
      audioFeatureCount++;
      learnedAudioFeatures.push(vectors[0]);
      audWindow.push(0);
      updateTokenFeed();
    }

    let frameFeatureCount = audioFeatureCount;
    let bestMatches = await audioMatcher.processVectors(vectors, frameFeatureCount);

    let best = bestMatches[0];
    let bestIndex = bestMatches[1];

    if (best > 10000 || bestIndex === -1) {
      if (audioFeatureCount < MAX_AUDIO_FEATURES) {
        audioMatcher.learnFeature(audioFeatureCount, vectors[0]);
        learnedAudioFeatures.push(vectors[0]);
        audWindow.push(audioFeatureCount);
        pairs[audioFeatureCount] = {};
        pairsPmi[audioFeatureCount] = {};
        audioFeatureCount++;
        updateTokenFeed();
      } else {
        if (bestIndex !== -1 && learnedAudioFeatures[bestIndex]) {
          modFeature(learnedAudioFeatures[bestIndex], vectors[0]);
          audioMatcher.learnFeature(bestIndex, learnedAudioFeatures[bestIndex]);
          audWindow.push(bestIndex);
          updateTokenFeed();
        }
      }
    }
    else {
      audWindow.push(bestIndex);
      updateTokenFeed();
    }

    toHighlight = getNBest(8, audWindow[audWindow.length - 1]);
    requestAnimationFrame(analyzeAudio);
  }

  analyzeAudio();
}