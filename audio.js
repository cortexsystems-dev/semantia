/**
 * Visualizes an AudioBuffer as a scrolling spectrogram on a canvas.
 * * @param {AudioContext} audioCtx - Your active Web Audio Context
 * @param {AudioBuffer} audioBuffer - The audio buffer to visualize
 * @param {HTMLCanvasElement} canvas - The canvas element to draw on
 */
/**
 * Visualizes a LIVE Audio stream as a scrolling spectrogram on a canvas.
 * @param {AnalyserNode} analyser - The Web Audio Analyser connected to the mic
 * @param {HTMLCanvasElement} canvas - The canvas element to draw on
 */
function drawLiveSpectrogram(analyser, canvas) {
  const canvasCtx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  const bufferLength = analyser.frequencyBinCount;
  // We use Uint8Array here (0-255) because it's much easier to map to colors 
  // than the Float32Array (-120 to 0) you use for your phoneme logic.
  const dataArray = new Uint8Array(bufferLength);

  // Fill background with black
  canvasCtx.fillStyle = '#000000';
  canvasCtx.fillRect(0, 0, width, height);

  let currentX = 0;

  function getHeatmapColor(value) {
    if (value < 1) return '#000000'; // Noise gate for visual cleanliness
    const percent = value / 255;
    const hue = (1.0 - percent) * 255;
    const lightness = percent < 0.01 ? percent * 500 : 50;
    return `hsl(${hue}, 100%, ${lightness}%)`;
  }

  let slidingWindow = []

  // The Drawing Loop
  function draw() {
    requestAnimationFrame(draw);

    // Grab the current frequency data as 0-255 integers
    analyser.getByteFrequencyData(dataArray);

    let reduced = reduceFrequencyData(dataArray, 64)



    // Wrap around when reaching the right edge
    if (currentX >= width) {
      currentX = 0;
      // Uncomment the next line if you want it to wipe clean when it loops
      canvasCtx.fillRect(0, 0, width, height);
    }

    // Draw the bottom half of the frequencies (usually where the human voice sits)
    const maxBinToDraw = Math.floor(reduced.length * 1);
    const sliceHeight = height / maxBinToDraw;



    for (let i = 0; i < maxBinToDraw; i++) {
      const value = reduced[i];
      slidingWindow.push(value)
      while (slidingWindow.length > 255) {
        slidingWindow.shift()
      }

      const y = height - (i * sliceHeight);

      canvasCtx.fillStyle = getHeatmapColor(value);
      canvasCtx.fillRect(currentX, y - sliceHeight, 1, Math.ceil(sliceHeight));
    }

    currentX += 1;
  }

  // Start drawing
  draw();
}


/**
 * Reduces an audio frequency data array to a specific target size.
 * * @param {Uint8Array|Array} dataArray - The original frequency data from the analyser.
 * @param {number} targetSize - The desired size of the output array (default is 51).
 * @returns {Uint8Array} A new array containing the averaged frequency bins.
 */
function reduceFrequencyData(dataArray, targetSize = 51) {
  const reducedArray = new Uint8Array(targetSize);

  // Calculate how many elements from the original array go into each new bin
  const step = dataArray.length / targetSize;

  for (let i = 0; i < targetSize; i++) {
    // Find the start and end indices in the original array for the current bin
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);

    let sum = 0;
    let count = 0;

    // Loop through the chunk and sum the values
    for (let j = start; j < end; j++) {
      sum += dataArray[j];
      count++;
    }

    // Calculate the average for this bin, avoiding division by zero
    reducedArray[i] = count > 0 ? Math.round(sum / count) : 0;
  }

  return reducedArray;
}