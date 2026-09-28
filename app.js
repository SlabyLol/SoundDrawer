(() => {
  // ---------- DOM ----------
  const imageDrop = document.getElementById("image-drop");
  const imageInput = document.getElementById("image-input");
  const imageCanvas = document.getElementById("image-canvas");
  const imageCtx = imageCanvas.getContext("2d");

  const durationInput = document.getElementById("duration");
  const minFreqInput = document.getElementById("min-freq");
  const maxFreqInput = document.getElementById("max-freq");
  const sampleRateSelect = document.getElementById("sample-rate");

  const generateBtn = document.getElementById("generate-btn");
  const playBtn = document.getElementById("play-btn");
  const stopBtn = document.getElementById("stop-btn");
  const exportBtn = document.getElementById("export-btn");

  const audioDrop = document.getElementById("audio-drop");
  const audioInput = document.getElementById("audio-input");
  const drawWaveformBtn = document.getElementById("draw-waveform-btn");
  const drawSpectrogramBtn = document.getElementById("draw-spectrogram-btn");
  const drawImageBtn = document.getElementById("draw-image-btn");
  const playImportedBtn = document.getElementById("play-imported-btn");
  const drawCanvas = document.getElementById("draw-canvas");
  const drawCtx = drawCanvas.getContext("2d");

  // ---------- State ----------
  let imageData = null;          // ImageData from uploaded image
  let generatedBuffer = null;    // AudioBuffer from image
  let importedBuffer = null;     // AudioBuffer from imported WAV
  let audioCtx = null;
  let currentSource = null;

  // ---------- Helpers ----------
  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function stopPlayback() {
    if (currentSource) {
      try { currentSource.stop(); } catch (_) {}
      currentSource = null;
    }
  }

  function playBuffer(buffer) {
    stopPlayback();
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    currentSource = source;
    source.onended = () => { currentSource = null; };
  }

  function getActiveBuffer() {
    return importedBuffer || generatedBuffer;
  }

  // ---------- Image loading ----------
  function loadImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Fit into canvas while keeping aspect
      const maxW = 320;
      const maxH = 240;
      let w = img.width;
      let h = img.height;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);

      imageCanvas.width = w;
      imageCanvas.height = h;
      imageCtx.drawImage(img, 0, 0, w, h);
      imageData = imageCtx.getImageData(0, 0, w, h);
      generateBtn.disabled = false;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  imageDrop.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });
  imageDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    imageDrop.classList.add("dragover");
  });
  imageDrop.addEventListener("dragleave", () => imageDrop.classList.remove("dragover"));
  imageDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    imageDrop.classList.remove("dragover");
    if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
  });

  // ---------- Image → Sound (spectrogram style) ----------
  function generateSoundFromImage() {
    if (!imageData) return;

    const duration = parseFloat(durationInput.value) || 4;
    const minFreq = parseFloat(minFreqInput.value) || 200;
    const maxFreq = parseFloat(maxFreqInput.value) || 8000;
    const sampleRate = parseInt(sampleRateSelect.value, 10) || 44100;

    const width = imageData.width;
    const height = imageData.height;
    const samples = Math.floor(duration * sampleRate);
    const samplesPerColumn = samples / width;

    // Convert to grayscale brightness (0–1)
    const pixels = imageData.data;
    const brightness = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      brightness[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // Additive synthesis: each row = frequency, each column = time
    const audio = new Float32Array(samples);
    const logMin = Math.log(minFreq);
    const logMax = Math.log(maxFreq);

    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerColumn);
      const endSample = Math.floor((x + 1) * samplesPerColumn);

      for (let y = 0; y < height; y++) {
        const amp = brightness[y * width + x];
        if (amp < 0.02) continue; // skip nearly black

        // Map y (top=high freq) to frequency
        const t = 1 - y / (height - 1); // 0 bottom → 1 top
        const freq = Math.exp(logMin + t * (logMax - logMin));
        const phaseInc = (2 * Math.PI * freq) / sampleRate;

        for (let s = startSample; s < endSample; s++) {
          const local = s - startSample;
          // Simple fade in/out per column to reduce clicks
          let env = 1;
          const fade = Math.min(64, (endSample - startSample) / 4);
          if (local < fade) env = local / fade;
          else if (s > endSample - fade) env = (endSample - s) / fade;

          audio[s] += amp * env * Math.sin(phaseInc * s);
        }
      }
    }

    // Normalize
    let max = 0;
    for (let i = 0; i < samples; i++) {
      const a = Math.abs(audio[i]);
      if (a > max) max = a;
    }
    if (max > 0) {
      const scale = 0.9 / max;
      for (let i = 0; i < samples; i++) audio[i] *= scale;
    }

    // Create AudioBuffer
    const ctx = getAudioContext();
    generatedBuffer = ctx.createBuffer(1, samples, sampleRate);
    generatedBuffer.copyToChannel(audio, 0);

    playBtn.disabled = false;
    stopBtn.disabled = false;
    exportBtn.disabled = false;

    // Also enable draw buttons for the generated sound (no need to re-import)
    drawWaveformBtn.disabled = false;
    drawSpectrogramBtn.disabled = false;
    drawImageBtn.disabled = false;
    playImportedBtn.disabled = false;

    // Auto-draw the reconstructed image from the generated sound
    drawImageFromSound(generatedBuffer);
  }

  generateBtn.addEventListener("click", () => {
    generateBtn.textContent = "Generating…";
    generateBtn.disabled = true;
    // Allow UI to update
    setTimeout(() => {
      generateSoundFromImage();
      generateBtn.textContent = "Generate Sound";
      generateBtn.disabled = false;
    }, 30);
  });

  playBtn.addEventListener("click", () => {
    if (generatedBuffer) playBuffer(generatedBuffer);
  });
  stopBtn.addEventListener("click", stopPlayback);

  // ---------- Export WAV ----------
  function exportWAV(buffer, filename = "sounddrawer.wav") {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // PCM
    view.setUint16(20, 1, true);  // format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Interleave samples
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = buffer.getChannelData(ch)[i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  exportBtn.addEventListener("click", () => {
    if (generatedBuffer) exportWAV(generatedBuffer, "sounddrawer-from-image.wav");
  });

  // ---------- Import Sound ----------
  function loadAudio(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const ctx = getAudioContext();
        importedBuffer = await ctx.decodeAudioData(e.target.result.slice(0));
        drawWaveformBtn.disabled = false;
        drawSpectrogramBtn.disabled = false;
        drawImageBtn.disabled = false;
        playImportedBtn.disabled = false;
        // Auto-draw reconstructed image from sound
        drawImageFromSound(importedBuffer);
      } catch (err) {
        console.error(err);
        alert("Could not decode audio file. Please use a valid WAV or other supported format.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  audioDrop.addEventListener("click", () => audioInput.click());
  audioInput.addEventListener("change", (e) => {
    if (e.target.files[0]) loadAudio(e.target.files[0]);
  });
  audioDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    audioDrop.classList.add("dragover");
  });
  audioDrop.addEventListener("dragleave", () => audioDrop.classList.remove("dragover"));
  audioDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    audioDrop.classList.remove("dragover");
    if (e.dataTransfer.files[0]) loadAudio(e.dataTransfer.files[0]);
  });

  playImportedBtn.addEventListener("click", () => {
    const buf = getActiveBuffer();
    if (buf) playBuffer(buf);
  });

  // ---------- Draw Waveform ----------
  function drawWaveform(buffer) {
    const width = drawCanvas.width;
    const height = drawCanvas.height;
    drawCtx.fillStyle = "#000";
    drawCtx.fillRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    drawCtx.strokeStyle = "#74b9ff";
    drawCtx.lineWidth = 1.5;
    drawCtx.beginPath();

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const sample = data[i * step + j] || 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      const y1 = (1 + min) * amp;
      const y2 = (1 + max) * amp;
      drawCtx.moveTo(i, y1);
      drawCtx.lineTo(i, y2);
    }
    drawCtx.stroke();

    // Center line
    drawCtx.strokeStyle = "rgba(255,255,255,0.15)";
    drawCtx.beginPath();
    drawCtx.moveTo(0, amp);
    drawCtx.lineTo(width, amp);
    drawCtx.stroke();
  }

  drawWaveformBtn.addEventListener("click", () => {
    const buf = getActiveBuffer();
    if (buf) drawWaveform(buf);
  });

  // ---------- Draw Spectrogram (simple STFT magnitude) ----------
  function drawSpectrogram(buffer) {
    const width = drawCanvas.width;
    const height = drawCanvas.height;
    drawCtx.fillStyle = "#000";
    drawCtx.fillRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const fftSize = 1024;
    const hop = 256;
    const numFrames = Math.floor((data.length - fftSize) / hop);

    // Simple magnitude spectrogram
    const spectro = [];
    for (let f = 0; f < numFrames; f++) {
      const frame = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        // Hann window
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
        frame[i] = (data[f * hop + i] || 0) * w;
      }
      // Real FFT magnitude (naive DFT for simplicity – fine for small demo)
      const mags = new Float32Array(fftSize / 2);
      for (let k = 0; k < fftSize / 2; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < fftSize; n++) {
          const angle = (2 * Math.PI * k * n) / fftSize;
          re += frame[n] * Math.cos(angle);
          im -= frame[n] * Math.sin(angle);
        }
        mags[k] = Math.sqrt(re * re + im * im);
      }
      spectro.push(mags);
    }

    // Find max for normalization
    let maxMag = 0;
    for (const m of spectro) {
      for (const v of m) if (v > maxMag) maxMag = v;
    }
    if (maxMag === 0) maxMag = 1;

    // Draw
    const imgData = drawCtx.createImageData(width, height);
    for (let x = 0; x < width; x++) {
      const frameIdx = Math.floor((x / width) * spectro.length);
      const mags = spectro[frameIdx] || spectro[spectro.length - 1];
      for (let y = 0; y < height; y++) {
        // Map y (bottom = low freq)
        const bin = Math.floor(((height - 1 - y) / height) * mags.length);
        const val = mags[bin] / maxMag;
        // Color map: black → purple → cyan → white
        const v = Math.min(1, val * 3);
        let r, g, b;
        if (v < 0.33) {
          r = Math.floor(v * 3 * 80);
          g = 0;
          b = Math.floor(v * 3 * 180);
        } else if (v < 0.66) {
          const t = (v - 0.33) * 3;
          r = Math.floor(80 + t * 100);
          g = Math.floor(t * 180);
          b = Math.floor(180 + t * 75);
        } else {
          const t = (v - 0.66) * 3;
          r = Math.floor(180 + t * 75);
          g = Math.floor(180 + t * 75);
          b = 255;
        }
        const idx = (y * width + x) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    drawCtx.putImageData(imgData, 0, 0);
  }

  drawSpectrogramBtn.addEventListener("click", () => {
    const buf = getActiveBuffer();
    if (!buf) return;
    drawSpectrogramBtn.textContent = "Drawing…";
    drawSpectrogramBtn.disabled = true;
    setTimeout(() => {
      drawSpectrogram(buf);
      drawSpectrogramBtn.textContent = "Draw Spectrogram";
      drawSpectrogramBtn.disabled = false;
    }, 30);
  });

  // ---------- Draw Image from Sound (reconstruct spectrogram as grayscale image) ----------
  function drawImageFromSound(buffer) {
    const sampleRate = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const minFreq = parseFloat(minFreqInput.value) || 200;
    const maxFreq = parseFloat(maxFreqInput.value) || 8000;

    // Use same STFT parameters as spectrogram for consistency
    const fftSize = 512;
    const hop = 128;
    const numFrames = Math.max(1, Math.floor((data.length - fftSize) / hop));
    const numBins = fftSize / 2;

    // Frequency range we care about (match generation mapping)
    const logMin = Math.log(minFreq);
    const logMax = Math.log(maxFreq);

    // Collect magnitude for each frame × bin in the relevant frequency range
    const magnitudes = [];
    let globalMax = 0;

    for (let f = 0; f < numFrames; f++) {
      const frame = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
        frame[i] = (data[f * hop + i] || 0) * w;
      }

      // Magnitude spectrum (naive real DFT – ok for short clips)
      const mags = new Float32Array(numBins);
      for (let k = 0; k < numBins; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < fftSize; n++) {
          const angle = (2 * Math.PI * k * n) / fftSize;
          re += frame[n] * Math.cos(angle);
          im -= frame[n] * Math.sin(angle);
        }
        mags[k] = Math.sqrt(re * re + im * im);
      }
      magnitudes.push(mags);
    }

    // Map frequency bins to image rows using log scale (same as generation)
    const imgW = Math.min(800, numFrames);
    const imgH = 256;
    drawCanvas.width = imgW;
    drawCanvas.height = imgH;

    const imgData = drawCtx.createImageData(imgW, imgH);

    // Precompute which bin corresponds to each image row (top = high freq)
    const binForRow = new Int32Array(imgH);
    for (let y = 0; y < imgH; y++) {
      const t = 1 - y / (imgH - 1); // 1 at top, 0 at bottom
      const targetFreq = Math.exp(logMin + t * (logMax - logMin));
      const bin = Math.round((targetFreq / (sampleRate / 2)) * (numBins - 1));
      binForRow[y] = Math.max(0, Math.min(numBins - 1, bin));
    }

    // Find max magnitude in the used bins for normalization
    for (let x = 0; x < imgW; x++) {
      const frameIdx = Math.floor((x / imgW) * numFrames);
      const mags = magnitudes[frameIdx];
      for (let y = 0; y < imgH; y++) {
        const v = mags[binForRow[y]];
        if (v > globalMax) globalMax = v;
      }
    }
    if (globalMax < 1e-8) globalMax = 1;

    // Draw grayscale image (bright = strong energy at that frequency/time)
    for (let x = 0; x < imgW; x++) {
      const frameIdx = Math.floor((x / imgW) * numFrames);
      const mags = magnitudes[frameIdx];
      for (let y = 0; y < imgH; y++) {
        let val = mags[binForRow[y]] / globalMax;
        // Mild gamma to improve contrast
        val = Math.pow(Math.min(1, val), 0.55);
        const gray = Math.floor(val * 255);
        const idx = (y * imgW + x) * 4;
        imgData.data[idx] = gray;
        imgData.data[idx + 1] = gray;
        imgData.data[idx + 2] = gray;
        imgData.data[idx + 3] = 255;
      }
    }

    drawCtx.putImageData(imgData, 0, 0);
  }

  drawImageBtn.addEventListener("click", () => {
    const buf = getActiveBuffer();
    if (!buf) return;
    drawImageBtn.textContent = "Drawing…";
    drawImageBtn.disabled = true;
    setTimeout(() => {
      drawImageFromSound(buf);
      drawImageBtn.textContent = "Draw Image from Sound";
      drawImageBtn.disabled = false;
    }, 30);
  });
})();
