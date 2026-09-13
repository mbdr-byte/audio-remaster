# 🎧 Audio Remastering Lab

[![Live Demo](https://img.shields.io/badge/Live_Demo-remaster.mbdr.ai-F0A500)](https://remaster.mbdr.ai)
[![Client-Side Processing](https://img.shields.io/badge/Processing-Client_Side-22C55E)](https://github.com/mbdr-byte/audio-remaster)
[![Made with Gemini](https://img.shields.io/badge/Made_with-Gemini_2.5_Pro-blue)](https://gemini.google.com)

A browser-based tool for enhancing audio tracks with professional-grade effects.

<div align="center">
  <a href="https://remaster.mbdr.ai">
    <img src="assets/preview.png" alt="Audio Remastering Lab Screenshot" width="600">
  </a>
</div>

## 🚀 Overview

I created this tool to enable quick and simple remastering of music tracks created on [suno.com](https://suno.com) that I wrote with [lyric-genie.com](https://lyric-genie.com). The application provides an intuitive interface for applying EQ, compression, stereo enhancement, and other audio effects to your tracks.

## ✨ Features

- Parametric equalizer with bass, mid, and treble controls
- Dynamics processing with compressor and limiter
- Stereo enhancement and reverb effects
- Analog-style warmth/saturation
- Real-time A/B comparison between original and remastered audio
- Audio metrics analysis
- One-click download of processed audio

## 🔒 Privacy

**All processing is done entirely client-side in your browser.**

Your audio never leaves your device. Files are decoded with the Web Audio API,
processed in memory, and exported straight from the browser — there is no
server, no upload, and no storage. You can verify this by examining
[`index.html`](index.html): the page makes no network request that carries audio
data, and the only outbound requests it makes at all are for Google Fonts and
Google Analytics.

For transparency: the site does use Google Analytics for anonymous usage stats
(page views, which buttons and sliders get used, file type, file size and
duration). It deliberately does **not** send your file names or any audio
content.

## 🛠️ Development

This project was created with the assistance of Google's Gemini 2.5 Pro using the Canvas feature.

## 🌐 Try It Out

Visit [https://remaster.mbdr.ai](https://remaster.mbdr.ai) to use the Audio Remastering Lab. 
