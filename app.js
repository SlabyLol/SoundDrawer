(() => {
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

  let imageData = null;
  let generatedBuffer = null;
  let importedBuffer = null;
  let audioCtx = null;
  let currentSource = null;
  let lastImgW = 0;
  let lastImgH = 0;
  let animFrameId = null;
  let playStartTime = 0;
  let lastMinFreq = 200;
  let lastMaxFreq = 12000;
  let lastFreqR = null;
  let lastFreqG = null;
  let lastFreqB = null;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function stopPlayback() {
    if (currentSource) {
      try { currentSource.stop(); } catch (_) {}
      currentSource = null;
    }
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function playBuffer(buffer) {
    stopPlayback();
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    playStartTime = ctx.currentTime;
    source.start(0);
    currentSource = source;
    source.onended = () => { currentSource = null; };
    return playStartTime;
  }

  function getActiveBuffer() {
    return importedBuffer || generatedBuffer;
  }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i + j], uIm = im[i + j];
          const vRe = re[i + j + len / 2] * cRe - im[i + j + len / 2] * cIm;
          const vIm = re[i + j + len / 2] * cIm + im[i + j + len / 2] * cRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + len / 2] = uRe - vRe;
          im[i + j + len / 2] = uIm - vIm;
          const nRe = cRe * wRe - cIm * wIm;
          cIm = cRe * wIm + cIm * wRe;
          cRe = nRe;
        }
      }
    }
  }

  function hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    return w;
  }

  function makeBandFreqs(minFreq, maxFreq, height) {
    const span = maxFreq - minFreq;
    const gap = span * 0.04;
    const band = (span - 2 * gap) / 3;
    const r0 = minFreq, r1 = minFreq + band;
    const g0 = r1 + gap, g1 = g0 + band;
    const b0 = g1 + gap, b1 = maxFreq;
    const freqR = new Float32Array(height);
    const freqG = new Float32Array(height);
    const freqB = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      const t = height === 1 ? 0.5 : 1 - y / (height - 1);
      freqR[y] = r0 + t * (r1 - r0);
      freqG[y] = g0 + t * (g1 - g0);
      freqB[y] = b0 + t * (b1 - b0);
    }
    return { freqR, freqG, freqB };
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = 400, maxH = 300;
      let w = img.width, h = img.height;
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

  function generateSoundFromImage() {
    if (!imageData) return;

    const duration = parseFloat(durationInput.value) || 6;
    const minFreq = parseFloat(minFreqInput.value) || 200;
    const maxFreq = parseFloat(maxFreqInput.value) || 12000;
    const sampleRate = parseInt(sampleRateSelect.value, 10) || 44100;
    lastMinFreq = minFreq;
    lastMaxFreq = maxFreq;

    let width = imageData.width;
    let height = imageData.height;
    const maxW = 180;
    const maxH = 140;
    if (width > maxW || height > maxH) {
      const ratio = Math.min(maxW / width, maxH / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      const tmp = document.createElement("canvas");
      tmp.width = width;
      tmp.height = height;
      const tctx = tmp.getContext("2d");
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(imageCanvas, 0, 0, width, height);
      imageData = tctx.getImageData(0, 0, width, height);
      imageCanvas.width = width;
      imageCanvas.height = height;
      imageCtx.putImageData(imageData, 0, 0);
    }
    lastImgW = width;
    lastImgH = height;

    const { freqR, freqG, freqB } = makeBandFreqs(minFreq, maxFreq, height);
    lastFreqR = freqR;
    lastFreqG = freqG;
    lastFreqB = freqB;

    const pixels = imageData.data;
    const samples = Math.floor(duration * sampleRate);
    const samplesPerColumn = samples / width;
    const audio = new Float32Array(samples);

    const incR = new Float32Array(height);
    const incG = new Float32Array(height);
    const incB = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      incR[y] = (2 * Math.PI * freqR[y]) / sampleRate;
      incG[y] = (2 * Math.PI * freqG[y]) / sampleRate;
      incB[y] = (2 * Math.PI * freqB[y]) / sampleRate;
    }

    for (let x = 0; x < width; x++) {
      const startS = Math.floor(x * samplesPerColumn);
      const endS = Math.floor((x + 1) * samplesPerColumn);
      const colLen = endS - startS;
      if (colLen <= 0) continue;
      const fade = Math.min(100, Math.floor(colLen / 4));

      for (let y = 0; y < height; y++) {
        const pi = (y * width + x) * 4;
        const aR = pixels[pi] / 255;
        const aG = pixels[pi + 1] / 255;
        const aB = pixels[pi + 2] / 255;
        if (aR + aG + aB < 0.04) continue;

        for (let s = startS; s < endS; s++) {
          const local = s - startS;
          let env = 1;
          if (local < fade) env = local / fade;
          else if (local > colLen - fade) env = (colLen - local) / fade;
          audio[s] += env * (
            aR * Math.sin(incR[y] * s) +
            aG * Math.sin(incG[y] * s) +
            aB * Math.sin(incB[y] * s)
          );
        }
      }
    }

    let peak = 0;
    for (let i = 0; i < samples; i++) {
      const a = Math.abs(audio[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0) {
      const sc = 0.88 / peak;
      for (let i = 0; i < samples; i++) audio[i] *= sc;
    }

    const ctx = getAudioContext();
    generatedBuffer = ctx.createBuffer(1, samples, sampleRate);
    generatedBuffer.copyToChannel(audio, 0);

    playBtn.disabled = false;
    stopBtn.disabled = false;
    exportBtn.disabled = false;
    drawWaveformBtn.disabled = false;
    drawSpectrogramBtn.disabled = false;
    drawImageBtn.disabled = false;
    playImportedBtn.disabled = false;

    drawImageFromSound(generatedBuffer);
  }

  generateBtn.addEventListener("click", () => {
    generateBtn.textContent = "Generating…";
    generateBtn.disabled = true;
    setTimeout(() => {
      generateSoundFromImage();
      generateBtn.textContent = "Generate Sound";
      generateBtn.disabled = false;
    }, 20);
  });

  playBtn.addEventListener("click", () => {
    if (generatedBuffer) playBuffer(generatedBuffer);
  });
  stopBtn.addEventListener("click", stopPlayback);

  function exportWAV(buffer, filename) {
    filename = filename || "sounddrawer.wav";
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const dataSize = length * numChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    function ws(o, s) {
      for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    }
    ws(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    ws(8, "WAVE");
    ws(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    ws(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
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

  exportBtn.addEventListener("click", () => {
    if (generatedBuffer) exportWAV(generatedBuffer, "sounddrawer-from-image.wav");
  });

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
        if (!lastFreqR) {
          const h = lastImgH > 0 ? lastImgH : 140;
          const bands = makeBandFreqs(
            parseFloat(minFreqInput.value) || 200,
            parseFloat(maxFreqInput.value) || 12000,
            h
          );
          lastFreqR = bands.freqR;
          lastFreqG = bands.freqG;
          lastFreqB = bands.freqB;
          lastImgH = h;
        }
        drawImageFromSound(importedBuffer);
      } catch (err) {
        console.error(err);
        alert("Could not decode audio file.");
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

  function drawWaveform(buffer) {
    const width = 800, height = 200;
    drawCanvas.width = width;
    drawCanvas.height = height;
    drawCtx.fillStyle = "#000";
    drawCtx.fillRect(0, 0, width, height);
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    drawCtx.strokeStyle = "#74b9ff";
    drawCtx.lineWidth = 1.5;
    drawCtx.beginPath();
    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const sample = data[i * step + j] || 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      drawCtx.moveTo(i, (1 + min) * amp);
      drawCtx.lineTo(i, (1 + max) * amp);
    }
    drawCtx.stroke();
  }

  drawWaveformBtn.addEventListener("click", () => {
    const buf = getActiveBuffer();
    if (buf) drawWaveform(buf);
  });

  function drawSpectrogram(buffer) {
    const width = 800, height = 300;
    drawCanvas.width = width;
    drawCanvas.height = height;
    drawCtx.fillStyle = "#000";
    drawCtx.fillRect(0, 0, width, height);
    const data = buffer.getChannelData(0);
    const fftSize = 2048, hop = 256;
    const numFrames = Math.max(1, Math.floor((data.length - fftSize) / hop));
    const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
    const win = hannWindow(fftSize);
    const spectro = [];
    let maxMag = 0;
    for (let f = 0; f < numFrames; f++) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = (data[f * hop + i] || 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      const mags = new Float32Array(fftSize / 2);
      for (let k = 0; k < fftSize / 2; k++) {
        mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        if (mags[k] > maxMag) maxMag = mags[k];
      }
      spectro.push(mags);
    }
    if (maxMag === 0) maxMag = 1;
    const imgData = drawCtx.createImageData(width, height);
    for (let x = 0; x < width; x++) {
      const mags = spectro[Math.min(Math.floor((x / width) * spectro.length), spectro.length - 1)];
      for (let y = 0; y < height; y++) {
        const bin = Math.floor(((height - 1 - y) / height) * mags.length);
        const v = Math.min(1, (mags[bin] / maxMag) * 2.2);
        let r, g, b;
        if (v < 0.25) {
          r = Math.floor(v * 4 * 40); g = 0; b = Math.floor(v * 4 * 140);
        } else if (v < 0.5) {
          const t = (v - 0.25) * 4;
          r = Math.floor(40 + t * 100); g = Math.floor(t * 80); b = Math.floor(140 + t * 60);
        } else if (v < 0.75) {
          const t = (v - 0.5) * 4;
          r = Math.floor(140 + t * 80); g = Math.floor(80 + t * 140); b = Math.floor(200 - t * 40);
        } else {
          const t = (v - 0.75) * 4;
          r = Math.floor(220 + t * 35); g = Math.floor(220 + t * 35); b = Math.floor(160 + t * 95);
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
    }, 20);
  });

  function drawImageFromSound(buffer) {
    stopPlayback();

    const sampleRate = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const duration = buffer.duration;
    const minFreq = lastMinFreq || parseFloat(minFreqInput.value) || 200;
    const maxFreq = lastMaxFreq || parseFloat(maxFreqInput.value) || 12000;

    const imgW = lastImgW > 0 ? lastImgW : 180;
    const imgH = lastImgH > 0 ? lastImgH : 140;

    let freqR = lastFreqR;
    let freqG = lastFreqG;
    let freqB = lastFreqB;
    if (!freqR || freqR.length !== imgH) {
      const bands = makeBandFreqs(minFreq, maxFreq, imgH);
      freqR = bands.freqR;
      freqG = bands.freqG;
      freqB = bands.freqB;
    }

    const fftSize = 8192;
    const hop = Math.max(32, Math.floor(data.length / (imgW * 4)));
    const numFrames = Math.max(1, Math.floor((data.length - fftSize) / hop) + 1);
    const numBins = fftSize / 2;

    const win = hannWindow(fftSize);
    const magnitudes = new Array(numFrames);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hop;
      for (let i = 0; i < fftSize; i++) {
        re[i] = (data[offset + i] || 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      const mags = new Float32Array(numBins);
      for (let k = 0; k < numBins; k++) {
        mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
      magnitudes[f] = mags;
    }

    function freqToBin(freq) {
      return Math.max(1, Math.min(numBins - 1, Math.round((freq / sampleRate) * fftSize)));
    }

    const binR = new Int32Array(imgH);
    const binG = new Int32Array(imgH);
    const binB = new Int32Array(imgH);
    for (let y = 0; y < imgH; y++) {
      binR[y] = freqToBin(freqR[y]);
      binG[y] = freqToBin(freqG[y]);
      binB[y] = freqToBin(freqB[y]);
    }

    let maxR = 1e-8, maxG = 1e-8, maxB = 1e-8;
    for (let x = 0; x < imgW; x++) {
      const fi = Math.min(numFrames - 1, Math.round((x / Math.max(1, imgW - 1)) * (numFrames - 1)));
      const m = magnitudes[fi];
      for (let y = 0; y < imgH; y++) {
        if (m[binR[y]] > maxR) maxR = m[binR[y]];
        if (m[binG[y]] > maxG) maxG = m[binG[y]];
        if (m[binB[y]] > maxB) maxB = m[binB[y]];
      }
    }

    const gamma = 0.5;
    const cols = new Uint8Array(imgW * imgH * 3);
    for (let x = 0; x < imgW; x++) {
      const fi = Math.min(numFrames - 1, Math.round((x / Math.max(1, imgW - 1)) * (numFrames - 1)));
      const m = magnitudes[fi];
      for (let y = 0; y < imgH; y++) {
        let r = Math.pow(Math.min(1, m[binR[y]] / maxR), gamma);
        let g = Math.pow(Math.min(1, m[binG[y]] / maxG), gamma);
        let b = Math.pow(Math.min(1, m[binB[y]] / maxB), gamma);
        const avg = (r + g + b) / 3;
        const sat = 1.15;
        r = Math.min(1, Math.max(0, avg + (r - avg) * sat));
        g = Math.min(1, Math.max(0, avg + (g - avg) * sat));
        b = Math.min(1, Math.max(0, avg + (b - avg) * sat));
        const i = (x * imgH + y) * 3;
        cols[i] = Math.floor(r * 255);
        cols[i + 1] = Math.floor(g * 255);
        cols[i + 2] = Math.floor(b * 255);
      }
    }

    const scale = Math.max(2, Math.floor(Math.min(4, 800 / imgW, 500 / imgH)));
    const canvasW = imgW * scale;
    const canvasH = imgH * scale;
    drawCanvas.width = canvasW;
    drawCanvas.height = canvasH;
    drawCtx.fillStyle = "#000";
    drawCtx.fillRect(0, 0, canvasW, canvasH);

    const ctx = getAudioContext();
    playBuffer(buffer);

    let lastDrawn = -1;

    function paintColumn(x, withHead) {
      for (let y = 0; y < imgH; y++) {
        const i = (x * imgH + y) * 3;
        drawCtx.fillStyle = "rgb(" + cols[i] + "," + cols[i + 1] + "," + cols[i + 2] + ")";
        drawCtx.fillRect(x * scale, y * scale, scale, scale);
      }
      if (withHead) {
        drawCtx.fillStyle = "rgba(255,255,255,0.85)";
        drawCtx.fillRect((x + 1) * scale - 1, 0, 2, canvasH);
      }
    }

    function tick() {
      const elapsed = ctx.currentTime - playStartTime;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const targetCol = Math.min(imgW - 1, Math.floor(progress * imgW));

      for (let x = lastDrawn + 1; x <= targetCol; x++) {
        if (lastDrawn >= 0) paintColumn(lastDrawn, false);
        paintColumn(x, true);
        lastDrawn = x;
      }

      if (progress < 1 && currentSource) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        if (lastDrawn >= 0) paintColumn(lastDrawn, false);
        for (let x = lastDrawn + 1; x < imgW; x++) paintColumn(x, false);
        animFrameId = null;
      }
    }

    animFrameId = requestAnimationFrame(tick);
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
    }, 20);
  });
})();
