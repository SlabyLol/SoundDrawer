# SoundDrawer

**Turn images into sound and sound into drawings – right in your browser.**

Pure client-side web app. No server, no upload of your files to any backend. Ready for **GitHub Pages**.

## Features

- **Image → Sound**  
  Upload any image. It is interpreted as a spectrogram and converted into audio using additive synthesis (each vertical line of the image becomes a short time slice, each horizontal position maps to a frequency).

- **Play & Export**  
  Listen to the generated sound and download it as a 16-bit WAV file.

- **Import Sound**  
  Load a WAV (or other browser-supported audio file).

- **Draw**  
  - **Waveform** – classic amplitude envelope  
  - **Spectrogram** – frequency content over time (simple STFT visualization)

## Live Demo

https://slabylol.github.io/SoundDrawer/

(Enable GitHub Pages if not already active: Settings → Pages → Deploy from branch `main` / root.)

## How to use locally

Just open `index.html` in a modern browser (Chrome, Firefox, Edge, Safari).  
Or serve the folder with any static server:

```bash
npx serve .
# or
python -m http.server
```

## Project structure

```
SoundDrawer/
├── index.html
├── style.css
├── app.js
└── README.md
```

## Technical notes

- Image-to-sound uses logarithmic frequency mapping and per-column amplitude envelopes to reduce clicks.
- Spectrogram drawing uses a simple real DFT (fine for short demos; for longer files the pure-JS DFT is intentionally basic).
- Everything runs in the browser via the Web Audio API and Canvas.

## License

MIT – do whatever you want.
