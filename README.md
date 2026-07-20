# Semantia

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WebGPU](https://img.shields.io/badge/Accelerated_by-WebGPU-blueviolet.svg)](#)
[![WebAudio](https://img.shields.io/badge/Audio-Web_Audio_API-blue.svg)](#)

Semantia is a browser-native, real-time multimodal feature extraction, learning, and matching engine. Powered by **WebGPU** for massive parallel acceleration and the **Web Audio API**, it continuously analyzes live camera and microphone streams, builds a dynamic dictionary of sensory features on the fly, and calculates their cross-modal correlations.

---

## Table of Contents

- [Core Architecture](#core-architecture)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
  - [Video Pipeline](#video-pipeline)
  - [Audio Pipeline](#audio-pipeline)
  - [Multimodal Association](#multimodal-association)
- [Installation & Setup](#installation--setup)
- [API & Core State Reference](#api--core-state-reference)
- [License](#license)

---

## Core Architecture

Semantia optionaly computes high-dimensional vector similarity entirely on GPU. It maps raw, unstructured physical inputs (pixels and audio frequencies) into compact mathematical representations, then passes them to a unified WebGPU-powered matching system.

---

## Key Features

- **Real-Time WebGPU Acceleration:** Offloads computationally expensive high-dimensional distance matching to the GPU, evaluating thousands of incoming patches against a massive feature pool inside a single animation frame loop.
- **Dynamic Feature Learning:** Automatically discovers and categorizes novel visual and acoustic structures without pre-training.
- **Adaptive Memory Management:** Supports constraint-bounded memory (up to 1,024 video features and 1,024 audio features). When the memory reaches capacity, it dynamically modulates existing features to accommodate incremental environmental changes.
- **Advanced Audio Normalization & Noise Gating:** Filters out silent frames through a volume threshold and prioritizes spectral *shape* over mere *amplitude* through normalization.
- **Cross-Modal Semantic Association:** Evaluates rolling temporal buffers to uncover patterns where specific visual structures consistently co-occur with specific acoustic patterns.

---

## How It Works

### Video Pipeline
1. **Frame Capture:** Live webcam streams feed into an HTML5 `<video>` element.
2. **Patch Extraction:** The frame is decomposed into regional matrix segments (such as 9x9 pixel blocks with 3 color channels, creating a 243-dimensional vector).
3. **GPU Distance Evaluation:** The WebGPU `FeatureMatcher` calculates matching scores across the pool.
4. **Learn vs. Modulate:**
   - If the matching score exceeds a strict distance threshold (e.g., `> 5000`), the block is classified as completely novel and learned as a new feature.
   - If the feature library is full, the engine subtly shifts (modulates) the closest existing learned match to adjust to the new observation.

### Audio Pipeline
1. **Spectral Capture:** The microphone input feeds into an HTML5 `AnalyserNode` running a 2,048-point Fast Fourier Transform (FFT).
2. **Dimensionality Reduction:** The frequency bin array is downsampled to 51 high-impact bins.
3. **Rolling Time Window:** A sliding buffer aggregates the 5 most recent time-slices, flattening them into a single 255-byte temporal-frequency footprint vector (5 slices × 51 bins).
4. **Noise Gate & Shape Normalization:** A noise gate discards signatures dropping below a baseline volume threshold. Surviving vectors are normalized to isolate purely spectral properties.
5. **GPU Evaluation:** The composite audio vector is sent to the WebGPU instance to categorize the acoustic signature (distance threshold `> 2000`).

### Multimodal Association
The engine records every matched feature index into parallel rolling temporal arrays (`vidWindow` and `audWindow`). On every animation frame, `computePmi()` analyzes these arrays to compute the statistical probability of a video feature and audio feature occurring together vs. occurring independently. 

---

## Installation & Setup

Because Semantia relies on advanced, browser-native hardware acceleration APIs, it must be delivered via a secure context (`https://`) or a local loopback domain (`http://localhost`).

### Prerequisites
- A browser with native WebGPU support (e.g., Google Chrome v113+, Microsoft Edge v113+, or Opera).
- A lightweight local web server to serve the codebase.

### Quick Start

1. Clone the repository to your machine:
```bash
   git clone [https://github.com/cortexsystems-dev/semantia.git](https://github.com/cortexsystems-dev/semantia.git)
   cd semantia
```

2. Start a local HTTP server using Python:

```bash
python3 -m http.server 8000
```


*(Alternatively, you can use Node's `npx http-server -p 8000`)*
3. Open your browser and navigate to:

```
http://localhost:8000
```


4. Grant the web application permission to access your **Camera** and **Microphone** when prompted by the browser dialog.

---

## API & Core State Reference

The execution state is governed by a series of global primitives and structural indices:

| Identifier | Type | Description |
| --- | --- | --- |
| `MAX_VIDEO_FEATURES` | `Constant` | Bound ceiling for learned video features (Default: `1024`). |
| `MAX_AUDIO_FEATURES` | `Constant` | Bound ceiling for learned audio features (Default: `1024`). |
| `videoMatcher` / `audioMatcher` | `FeatureMatcher` | Instances of the WebGPU interface processing parallel similarity pipelines. |
| `learnedVideoFeatures` | `Array` | Store of raw extracted 243-dimensional video structural patches. |
| `learnedAudioFeatures` | `Array` | Store of raw extracted 255-dimensional flattened audio frequency arrays. |
| `vidWindow` / `audWindow` | `Array` | Sequential histories tracking historical indices for temporal cross-correlation. |
| `pairsPmi` | `Object` | Key-value mapping matrix holding computed associative scores. |

---

## License

This project is licensed under the [MIT License](https://www.google.com/search?q=LICENSE). Feel free to modify and distribute for research, personal, or commercial application.
