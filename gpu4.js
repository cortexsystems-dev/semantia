let globalGpuDevice = null;
let isGpuAvailable = false;

// Call this ONCE at the start of your app
async function initGlobalWebGPU() {
  if (!navigator.gpu) {
    console.warn("WebGPU not supported. Falling back to CPU.");
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No adapter found.");

    globalGpuDevice = await adapter.requestDevice();
    isGpuAvailable = true;
    return true;
  } catch (e) {
    console.error("WebGPU init failed:", e);
    return false;
  }
}

class FeatureMatcher {
  // Added alignedSize to break the 256-byte ceiling
  constructor(maxFeatures = 1024, maxLiveVectors = 1024, vectorSize = 243, alignedSize = 256) {
    this.MAX_FEATURES = maxFeatures;
    this.MAX_LIVE_VECTORS = maxLiveVectors;
    this.VECTOR_SIZE = vectorSize;
    this.ALIGNED_SIZE = alignedSize;
    this.WORDS = Math.ceil(this.ALIGNED_SIZE / 4); // Calculate 32-bit words

    this.cpuDBMatrix = new Uint8Array(this.MAX_FEATURES * this.ALIGNED_SIZE);
    this.isInitialized = false;
  }

  init() {
    if (!isGpuAvailable || !globalGpuDevice) return;

    // Dynamically inject the Word count and Vector size limits into the shader
    const shaderModule = globalGpuDevice.createShaderModule({
      code: `
        struct Params { totalFeatures: u32, totalVectors: u32 }

        @group(0) @binding(0) var<storage, read> liveVectors : array<u32>;
        @group(0) @binding(1) var<storage, read> dbMatrix : array<u32>;
        @group(0) @binding(2) var<storage, read_write> bestMatches : array<f32>;
        @group(0) @binding(3) var<uniform> params : Params;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id : vec3<u32>) {
          let vectorIndex = id.x;
          if (vectorIndex >= params.totalVectors) { return; }
          
          let wordsPerVector = ${this.WORDS}u;
          let liveOffset = vectorIndex * wordsPerVector;
          var minDistance: f32 = 9999999.0;
          var bestIdx: f32 = -1.0;
          
          for (var f = 0u; f < params.totalFeatures; f = f + 1u) {
            let dbOffset = f * wordsPerVector;
            var absoluteDistance : f32 = 0.0;
            
            for (var i = 0u; i < wordsPerVector; i = i + 1u) {
              let livePacked = liveVectors[liveOffset + i];
              let dbPacked = dbMatrix[dbOffset + i];
              
              for (var chunk = 0u; chunk < 4u; chunk = chunk + 1u) {
                if ((i * 4u + chunk) >= ${this.VECTOR_SIZE}u) { break; }
                let shift = chunk * 8u;
                let liveVal = f32((livePacked >> shift) & 0xFFu);
                let dbVal = f32((dbPacked >> shift) & 0xFFu);
                absoluteDistance = absoluteDistance + abs(liveVal - dbVal);
              }
            }
            if (absoluteDistance < minDistance) {
              minDistance = absoluteDistance;
              bestIdx = f32(f);
            }
          }
          let outOffset = vectorIndex * 2u;
          bestMatches[outOffset] = minDistance;
          bestMatches[outOffset + 1u] = bestIdx;
        }
      `
    });

    this.computePipeline = globalGpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this.bufferLive = globalGpuDevice.createBuffer({ size: this.MAX_LIVE_VECTORS * this.ALIGNED_SIZE, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bufferDB = globalGpuDevice.createBuffer({ size: this.MAX_FEATURES * this.ALIGNED_SIZE, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bufferOutput = globalGpuDevice.createBuffer({ size: this.MAX_LIVE_VECTORS * 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.bufferRead = globalGpuDevice.createBuffer({ size: this.MAX_LIVE_VECTORS * 2 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.bufferParams = globalGpuDevice.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.bindGroup = globalGpuDevice.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.bufferLive } },
        { binding: 1, resource: { buffer: this.bufferDB } },
        { binding: 2, resource: { buffer: this.bufferOutput } },
        { binding: 3, resource: { buffer: this.bufferParams } },
      ],
    });

    this.isInitialized = true;
  }

  padTo256Bytes(uint8Array) {
    const padded = new Uint8Array(this.ALIGNED_SIZE);
    padded.set(uint8Array);
    return padded;
  }

  learnFeature(featureIndex, featureVectorUint8) {
    const paddedFeature = this.padTo256Bytes(featureVectorUint8);
    this.cpuDBMatrix.set(paddedFeature, featureIndex * this.ALIGNED_SIZE);

    if (this.isInitialized) {
      globalGpuDevice.queue.writeBuffer(this.bufferDB, featureIndex * this.ALIGNED_SIZE, paddedFeature);
    }
  }

  async processVectors(vectors, currentTotalFeatures) {
    const totalVectors = vectors.length;
    if (currentTotalFeatures === 0 || totalVectors === 0) return new Float32Array(0);

    // Fallback to CPU if GPU failed to init
    if (!this.isInitialized) return this.processVectorsOnCPU(vectors, currentTotalFeatures);

    try {
      const packedLive = new Uint8Array(this.MAX_LIVE_VECTORS * this.ALIGNED_SIZE);
      const vectorsToProcess = Math.min(totalVectors, this.MAX_LIVE_VECTORS);

      for (let v = 0; v < vectorsToProcess; v++) {
        packedLive.set(vectors[v], v * this.ALIGNED_SIZE);
      }

      globalGpuDevice.queue.writeBuffer(this.bufferLive, 0, packedLive);
      globalGpuDevice.queue.writeBuffer(this.bufferParams, 0, new Uint32Array([currentTotalFeatures, vectorsToProcess, 0, 0]));

      const commandEncoder = globalGpuDevice.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.computePipeline);
      passEncoder.setBindGroup(0, this.bindGroup);
      passEncoder.dispatchWorkgroups(Math.ceil(vectorsToProcess / 64));
      passEncoder.end();

      const byteLength = vectorsToProcess * 2 * 4;
      commandEncoder.copyBufferToBuffer(this.bufferOutput, 0, this.bufferRead, 0, byteLength);
      globalGpuDevice.queue.submit([commandEncoder.finish()]);

      await this.bufferRead.mapAsync(GPUMapMode.READ, 0, byteLength);
      const matches = new Float32Array(this.bufferRead.getMappedRange(0, byteLength).slice());
      this.bufferRead.unmap();

      return matches;

    } catch (e) {
      console.error("GPU failed, falling back to CPU:", e);
      return this.processVectorsOnCPU(vectors, currentTotalFeatures);
    }
  }

  processVectorsOnCPU(vectors, currentTotalFeatures) {
    const totalVectors = vectors.length;
    const bestMatches = new Float32Array(totalVectors * 2);

    for (let v = 0; v < totalVectors; v++) {
      const vector = vectors[v];
      let minDistance = 9999999;
      let bestIdx = -1;

      for (let f = 0; f < currentTotalFeatures; f++) {
        const dbOffset = f * this.ALIGNED_SIZE;
        let absoluteDistance = 0;
        for (let i = 0; i < this.VECTOR_SIZE; i++) {
          absoluteDistance += Math.abs(vector[i] - this.cpuDBMatrix[dbOffset + i]);
        }
        if (absoluteDistance < minDistance) {
          minDistance = absoluteDistance;
          bestIdx = f;
        }
      }
      bestMatches[v * 2] = minDistance;
      bestMatches[v * 2 + 1] = bestIdx;
    }
    return bestMatches;
  }
}
