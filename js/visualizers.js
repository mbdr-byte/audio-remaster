/**
 * ==========================================================================
 * Studio Visualizers:
 *  1. Interactive Waveform Scrubbing + Loop Region + Trim/Fade Curves
 *  2. Interactive 6-Band Parametric EQ Curve + Dual Pre/Post FFT Spectrum
 *  3. Real-Time Stereo Vectorscope (Goniometer) & Level/Phase Metering
 * ==========================================================================
 */

import { EQ_BAND_DEFS } from './presets.js';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MAX_EQ_DB = 16;

function freqToNormX(freq) {
    const clamped = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
    return Math.log10(clamped / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ);
}

function normXToFreq(normX) {
    const clamped = Math.max(0, Math.min(1, normX));
    return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, clamped);
}

function dbToNormY(db) {
    const clamped = Math.max(-MAX_EQ_DB, Math.min(MAX_EQ_DB, db));
    return 0.5 - (clamped / (2 * MAX_EQ_DB));
}

function normYToDb(normY) {
    const clamped = Math.max(0, Math.min(1, normY));
    return (0.5 - clamped) * (2 * MAX_EQ_DB);
}

/**
 * 1. Interactive Waveform Visualizer (Scrubbing, Loop Region, Trim & Fade Envelopes)
 */
export class WaveformVisualizer {
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks; // { onSeek(sec), onLoopChange(startSec, endSec, enabled) }

        this.peaksMin = null;
        this.peaksMax = null;
        this.duration = 0;

        this.dragMode = null; // 'seek' | 'loopStart' | 'loopEnd' | 'createLoop'
        this.dragAnchorSec = 0;

        this._bindEvents();
        this._resizeObserver = new ResizeObserver(() => this._syncSize());
        this._resizeObserver.observe(this.canvas);
        this._syncSize();
    }

    _syncSize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = Math.round(rect.width * dpr);
            this.canvas.height = Math.round(rect.height * dpr);
        }
    }

    setBuffer(audioBuffer) {
        if (!audioBuffer) {
            this.peaksMin = null;
            this.peaksMax = null;
            this.duration = 0;
            return;
        }
        this.duration = audioBuffer.duration;
        const numBins = 900;
        this.peaksMin = new Float32Array(numBins);
        this.peaksMax = new Float32Array(numBins);

        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
        const samplesPerBin = Math.max(1, Math.floor(audioBuffer.length / numBins));

        for (let b = 0; b < numBins; b++) {
            const start = b * samplesPerBin;
            const end = Math.min(audioBuffer.length, start + samplesPerBin);
            let minVal = 0;
            let maxVal = 0;
            const stride = Math.max(1, Math.floor(samplesPerBin / 64));
            for (let i = start; i < end; i += stride) {
                const v = 0.5 * (ch0[i] + ch1[i]);
                if (v < minVal) minVal = v;
                if (v > maxVal) maxVal = v;
            }
            this.peaksMin[b] = minVal;
            this.peaksMax[b] = maxVal;
        }
    }

    _clientXToSec(clientX) {
        if (!this.duration) return 0;
        const rect = this.canvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        return ratio * this.duration;
    }

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.duration) return;
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const sec = this._clientXToSec(e.clientX);

            if (e.shiftKey) {
                this.dragMode = 'createLoop';
                this.dragAnchorSec = sec;
                if (this.callbacks.onLoopChange) {
                    this.callbacks.onLoopChange(sec, Math.min(this.duration, sec + 0.2), true);
                }
                return;
            }

            // Check if clicking near loop handles when loop is active
            if (this.lastState && this.lastState.loopEnabled) {
                const startX = (this.lastState.loopStartSec / this.duration) * rect.width;
                const endX = (this.lastState.loopEndSec / this.duration) * rect.width;
                if (Math.abs(clickX - startX) < 9) {
                    this.dragMode = 'loopStart';
                    return;
                }
                if (Math.abs(clickX - endX) < 9) {
                    this.dragMode = 'loopEnd';
                    return;
                }
            }

            this.dragMode = 'seek';
            if (this.callbacks.onSeek) {
                this.callbacks.onSeek(sec);
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.dragMode || !this.duration) return;
            const sec = this._clientXToSec(e.clientX);

            if (this.dragMode === 'seek' && this.callbacks.onSeek) {
                this.callbacks.onSeek(sec);
            } else if (this.dragMode === 'createLoop' && this.callbacks.onLoopChange) {
                const s = Math.min(this.dragAnchorSec, sec);
                const end = Math.max(s + 0.25, Math.max(this.dragAnchorSec, sec));
                this.callbacks.onLoopChange(s, end, true);
            } else if (this.dragMode === 'loopStart' && this.callbacks.onLoopChange && this.lastState) {
                const s = Math.min(sec, this.lastState.loopEndSec - 0.25);
                this.callbacks.onLoopChange(Math.max(0, s), this.lastState.loopEndSec, true);
            } else if (this.dragMode === 'loopEnd' && this.callbacks.onLoopChange && this.lastState) {
                const end = Math.max(sec, this.lastState.loopStartSec + 0.25);
                this.callbacks.onLoopChange(this.lastState.loopStartSec, Math.min(this.duration, end), true);
            }
        });

        window.addEventListener('mouseup', () => {
            this.dragMode = null;
        });
    }

    draw(state) {
        this.lastState = state;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const dpr = window.devicePixelRatio || 1;

        ctx.fillStyle = '#0e1013';
        ctx.fillRect(0, 0, w, h);

        // Center zero-line
        ctx.strokeStyle = '#20242c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        if (!this.peaksMax || !this.duration) {
            ctx.fillStyle = '#646b78';
            ctx.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('Drop or Choose an Audio File to View Waveform & Scrub / Loop (Shift+Drag to Loop)', w / 2, h / 2 + 4);
            return;
        }

        const currentTime = state.currentTime || 0;
        const playRatio = Math.max(0, Math.min(1, currentTime / this.duration));
        const playX = playRatio * w;

        // Draw waveform bins
        const numBins = this.peaksMax.length;
        const binW = w / numBins;
        const midY = h / 2;
        const ampScale = h * 0.44;

        for (let i = 0; i < numBins; i++) {
            const x = i * binW;
            const maxH = this.peaksMax[i] * ampScale;
            const minH = this.peaksMin[i] * ampScale;

            ctx.fillStyle = x <= playX
                ? (state.isRemastered ? '#f0a500' : '#38bdf8')
                : '#363b47';
            const topY = midY - maxH;
            const barH = Math.max(1.5, maxH - minH);
            ctx.fillRect(x, topY, Math.max(1, binW - 0.5), barH);
        }

        // Draw Trim Start / Trim End shaded exclusion masks + Fade Envelope Curve
        const trimStart = Math.max(0, Number(state.trimStartSec) || 0);
        const rawTrimEnd = Number(state.trimEndSec);
        const trimEnd = (rawTrimEnd > trimStart && rawTrimEnd <= this.duration) ? rawTrimEnd : this.duration;

        const trimStartX = (trimStart / this.duration) * w;
        const trimEndX = (trimEnd / this.duration) * w;

        if (trimStartX > 1) {
            ctx.fillStyle = 'rgba(10, 12, 15, 0.78)';
            ctx.fillRect(0, 0, trimStartX, h);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(trimStartX, 0);
            ctx.lineTo(trimStartX, h);
            ctx.stroke();
        }
        if (trimEndX < w - 1) {
            ctx.fillStyle = 'rgba(10, 12, 15, 0.78)';
            ctx.fillRect(trimEndX, 0, w - trimEndX, h);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(trimEndX, 0);
            ctx.lineTo(trimEndX, h);
            ctx.stroke();
        }

        // Draw Fade-In / Fade-Out Envelope Line
        const fadeIn = Math.max(0, Number(state.fadeInSec) || 0);
        const fadeOut = Math.max(0, Number(state.fadeOutSec) || 0);
        if (fadeIn > 0.05 || fadeOut > 0.05) {
            const fadeInEndX = Math.min(trimEndX, ((trimStart + fadeIn) / this.duration) * w);
            const fadeOutStartX = Math.max(trimStartX, ((trimEnd - fadeOut) / this.duration) * w);

            ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(trimStartX, h);
            ctx.lineTo(fadeInEndX, 6 * dpr);
            ctx.lineTo(fadeOutStartX, 6 * dpr);
            ctx.lineTo(trimEndX, h);
            ctx.stroke();
        }

        // Draw Loop Region if enabled
        if (state.loopEnabled && state.loopEndSec > state.loopStartSec) {
            const loopStartX = (state.loopStartSec / this.duration) * w;
            const loopEndX = (state.loopEndSec / this.duration) * w;
            ctx.fillStyle = 'rgba(240, 165, 0, 0.14)';
            ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, h);

            ctx.strokeStyle = '#f0a500';
            ctx.lineWidth = 2 * dpr;
            ctx.beginPath();
            ctx.moveTo(loopStartX, 0);
            ctx.lineTo(loopStartX, h);
            ctx.moveTo(loopEndX, 0);
            ctx.lineTo(loopEndX, h);
            ctx.stroke();

            // Handle flags
            ctx.fillStyle = '#f0a500';
            ctx.fillRect(loopStartX, 0, 7 * dpr, 12 * dpr);
            ctx.fillRect(loopEndX - 7 * dpr, 0, 7 * dpr, 12 * dpr);
        }

        // Draw Playhead
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, h);
        ctx.stroke();
    }
}

/**
 * 2. Interactive 6-Band Parametric EQ & Real-Time Pre/Post Spectrum Visualizer
 */
export class EQSpectrumVisualizer {
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks; // { onBandChange(bandIndex, freq, gain, q), onSelectBand(bandIndex) }

        this.selectedBand = 2; // Default focus on Band 3 (De-Mud)
        this.draggingBand = null;

        this.numCurvePoints = 256;
        this.freqGrid = new Float32Array(this.numCurvePoints);
        for (let i = 0; i < this.numCurvePoints; i++) {
            this.freqGrid[i] = normXToFreq(i / (this.numCurvePoints - 1));
        }

        this.preFftData = new Uint8Array(1024);
        this.postFftData = new Uint8Array(1024);

        this._bindEvents();
        this._resizeObserver = new ResizeObserver(() => this._syncSize());
        this._resizeObserver.observe(this.canvas);
        this._syncSize();
    }

    _syncSize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = Math.round(rect.width * dpr);
            this.canvas.height = Math.round(rect.height * dpr);
        }
    }

    _getNodeScreenCoords(bandIdx, settings, width, height) {
        const def = EQ_BAND_DEFS[bandIdx];
        const freq = Number(settings[`eq${bandIdx}Freq`]) || def.defaultFreq;
        const gain = def.hasGain ? (Number(settings[`eq${bandIdx}Gain`]) || 0) : 0;
        const x = freqToNormX(freq) * width;
        const y = dbToNormY(gain) * height;
        return { x, y, freq, gain };
    }

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.lastSettings) return;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            let closestIdx = -1;
            let minDist = 18;

            EQ_BAND_DEFS.forEach((_, idx) => {
                const pt = this._getNodeScreenCoords(idx, this.lastSettings, rect.width, rect.height);
                const dist = Math.hypot(mx - pt.x, my - pt.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = idx;
                }
            });

            if (closestIdx !== -1) {
                this.selectedBand = closestIdx;
                this.draggingBand = closestIdx;
                if (this.callbacks.onSelectBand) {
                    this.callbacks.onSelectBand(closestIdx);
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.draggingBand === null || !this.lastSettings) return;
            const idx = this.draggingBand;
            const def = EQ_BAND_DEFS[idx];
            const rect = this.canvas.getBoundingClientRect();

            const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));

            const rawFreq = normXToFreq(normX);
            const clampedFreq = Math.round(Math.max(def.minFreq, Math.min(def.maxFreq, rawFreq)));
            const rawGain = def.hasGain ? normYToDb(normY) : 0;
            const clampedGain = Number(Math.max(-15, Math.min(15, rawGain)).toFixed(1));
            const currentQ = Number(this.lastSettings[`eq${idx}Q`]) || def.defaultQ;

            if (this.callbacks.onBandChange) {
                this.callbacks.onBandChange(idx, clampedFreq, clampedGain, currentQ);
            }
        });

        window.addEventListener('mouseup', () => {
            this.draggingBand = null;
        });

        // Mouse wheel over canvas adjusts Q of the currently selected band
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.lastSettings) return;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Only intercept wheel if hovering near a node
            let hoveredIdx = -1;
            EQ_BAND_DEFS.forEach((_, idx) => {
                const pt = this._getNodeScreenCoords(idx, this.lastSettings, rect.width, rect.height);
                if (Math.hypot(mx - pt.x, my - pt.y) < 24) {
                    hoveredIdx = idx;
                }
            });

            if (hoveredIdx === -1) return;
            e.preventDefault();

            const def = EQ_BAND_DEFS[hoveredIdx];
            const curFreq = Number(this.lastSettings[`eq${hoveredIdx}Freq`]);
            const curGain = Number(this.lastSettings[`eq${hoveredIdx}Gain`]);
            const curQ = Number(this.lastSettings[`eq${hoveredIdx}Q`]) || def.defaultQ;

            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            const nextQ = Number(Math.max(def.minQ, Math.min(def.maxQ, curQ + delta)).toFixed(2));

            if (this.callbacks.onBandChange) {
                this.callbacks.onBandChange(hoveredIdx, curFreq, curGain, nextQ);
            }
        }, { passive: false });
    }

    draw(engine, settings) {
        this.lastSettings = settings;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const dpr = window.devicePixelRatio || 1;

        ctx.fillStyle = '#0e1013';
        ctx.fillRect(0, 0, w, h);

        // 1. Draw Frequency & dB Grid
        ctx.strokeStyle = '#1b1f27';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#555d6b';
        ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;

        const gridFreqs = [30, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        gridFreqs.forEach(f => {
            const x = freqToNormX(f) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
            ctx.fillText(label, x + 3 * dpr, h - 5 * dpr);
        });

        const gridDbs = [-12, -6, 0, 6, 12];
        gridDbs.forEach(db => {
            const y = dbToNormY(db) * h;
            ctx.strokeStyle = db === 0 ? '#2f3542' : '#1b1f27';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillText(`${db > 0 ? '+' : ''}${db}dB`, 5 * dpr, y - 3 * dpr);
        });

        // 2. Draw Real-Time Pre & Post FFT Spectrum if playing
        if (engine && engine.isPlaying && engine.analyserPost && engine.analyserPre) {
            const sampleRate = engine.ctx ? engine.ctx.sampleRate : 44100;
            const binCount = engine.analyserPost.frequencyBinCount;
            if (this.postFftData.length !== binCount) {
                this.postFftData = new Uint8Array(binCount);
                this.preFftData = new Uint8Array(binCount);
            }
            engine.analyserPre.getByteFrequencyData(this.preFftData);
            engine.analyserPost.getByteFrequencyData(this.postFftData);

            // Draw Pre-FX Spectrum outline (subtle grey/cyan trace)
            this._drawFftCurve(ctx, this.preFftData, sampleRate, w, h, 'rgba(148, 163, 184, 0.35)', 'rgba(148, 163, 184, 0.06)');

            // Draw Post-FX Spectrum filled (amber or cyan depending on A/B state)
            const strokeCol = engine.isRemasteredActive ? 'rgba(240, 165, 0, 0.72)' : 'rgba(56, 189, 248, 0.72)';
            const fillCol = engine.isRemasteredActive ? 'rgba(240, 165, 0, 0.15)' : 'rgba(56, 189, 248, 0.15)';
            this._drawFftCurve(ctx, this.postFftData, sampleRate, w, h, strokeCol, fillCol);
        }

        // 3. Draw Composite EQ + AI Restoration Frequency Response Curve
        if (engine && engine.chain && settings) {
            const responseDb = engine.chain.getCompositeEQResponseDb(this.freqGrid, settings);
            const zeroY = dbToNormY(0) * h;

            // Fill under EQ curve
            ctx.beginPath();
            ctx.moveTo(0, zeroY);
            for (let i = 0; i < this.numCurvePoints; i++) {
                const x = (i / (this.numCurvePoints - 1)) * w;
                const y = dbToNormY(responseDb[i]) * h;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(w, zeroY);
            ctx.closePath();
            ctx.fillStyle = settings.bypassEq ? 'rgba(100, 107, 120, 0.08)' : 'rgba(240, 165, 0, 0.14)';
            ctx.fill();

            // Stroke EQ curve
            ctx.beginPath();
            for (let i = 0; i < this.numCurvePoints; i++) {
                const x = (i / (this.numCurvePoints - 1)) * w;
                const y = dbToNormY(responseDb[i]) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = settings.bypassEq ? '#646b78' : '#f0a500';
            ctx.lineWidth = 2.2 * dpr;
            ctx.stroke();

            // 4. Draw Draggable Band Nodes
            EQ_BAND_DEFS.forEach((def, idx) => {
                const pt = this._getNodeScreenCoords(idx, settings, w, h);
                const isSelected = idx === this.selectedBand;
                const radius = (isSelected ? 7.5 : 5.5) * dpr;

                if (isSelected) {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, radius + 4 * dpr, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(240, 165, 0, 0.25)';
                    ctx.fill();
                }

                ctx.beginPath();
                ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = def.color;
                ctx.fill();
                ctx.lineWidth = 1.5 * dpr;
                ctx.strokeStyle = '#0e1013';
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${9 * dpr}px "IBM Plex Mono", monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(`${idx + 1}`, pt.x, pt.y + 3 * dpr);
            });
            ctx.textAlign = 'left';
        }
    }

    _drawFftCurve(ctx, fftBytes, sampleRate, w, h, strokeColor, fillColor) {
        const numBins = fftBytes.length;
        const nyquist = sampleRate / 2;

        ctx.beginPath();
        ctx.moveTo(0, h);

        const steps = 160;
        for (let s = 0; s <= steps; s++) {
            const normX = s / steps;
            const freq = normXToFreq(normX);
            const binIdx = Math.min(numBins - 1, Math.max(0, Math.round((freq / nyquist) * numBins)));
            const val = fftBytes[binIdx] / 255;
            const y = h - val * (h * 0.86);
            ctx.lineTo(normX * w, y);
        }

        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.25;
        ctx.stroke();
    }
}

/**
 * 3. Real-Time Stereo Vectorscope (Lissajous Goniometer) & Live Level/Phase Computer
 */
export class MeterBridgeVisualizer {
    constructor(vectorCanvas) {
        this.canvas = vectorCanvas;
        this.ctx = vectorCanvas ? vectorCanvas.getContext('2d') : null;
        this.bufL = new Float32Array(1024);
        this.bufR = new Float32Array(1024);

        if (this.canvas) {
            this._resizeObserver = new ResizeObserver(() => this._syncSize());
            this._resizeObserver.observe(this.canvas);
            this._syncSize();
        }
    }

    _syncSize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = Math.round(rect.width * dpr);
            this.canvas.height = Math.round(rect.height * dpr);
        }
    }

    /**
     * Reads L/R time-domain samples from the live engine, updates the Vectorscope canvas,
     * and returns real-time Peak L/R, RMS L/R, Short-Term LUFS, Gain Reduction, and Phase Correlation.
     */
    updateAndDraw(engine) {
        if (!engine || !engine.isPlaying || !engine.analyserL || !engine.analyserR) {
            this._drawIdleVectorscope();
            return {
                peakLDb: -100,
                peakRDb: -100,
                rmsDb: -100,
                shortTermLufs: -100,
                gainReductionDb: 0,
                phaseCorrelation: 1.0
            };
        }

        engine.analyserL.getFloatTimeDomainData(this.bufL);
        engine.analyserR.getFloatTimeDomainData(this.bufR);

        let peakL = 0;
        let peakR = 0;
        let sumSq = 0;
        let sumLR = 0;
        let sumLL = 0;
        let sumRR = 0;

        const n = this.bufL.length;
        for (let i = 0; i < n; i++) {
            const l = this.bufL[i];
            const r = this.bufR[i];
            const al = Math.abs(l);
            const ar = Math.abs(r);
            if (al > peakL) peakL = al;
            if (ar > peakR) peakR = ar;
            sumSq += 0.5 * (l * l + r * r);
            sumLR += l * r;
            sumLL += l * l;
            sumRR += r * r;
        }

        const peakLDb = peakL > 1e-6 ? 20 * Math.log10(peakL) : -100;
        const peakRDb = peakR > 1e-6 ? 20 * Math.log10(peakR) : -100;
        const rms = Math.sqrt(sumSq / n);
        const rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
        const shortTermLufs = sumSq / n > 1e-10 ? -0.691 + 10 * Math.log10(sumSq / n) : -100;

        const denom = Math.sqrt(sumLL * sumRR);
        const phaseCorrelation = denom > 1e-8 ? Math.max(-1, Math.min(1, sumLR / denom)) : 1.0;
        const gainReductionDb = engine.chain ? engine.chain.getGainReductionDb() : 0;

        this._drawActiveVectorscope(this.bufL, this.bufR, engine.isRemasteredActive);

        return {
            peakLDb,
            peakRDb,
            rmsDb,
            shortTermLufs,
            gainReductionDb,
            phaseCorrelation
        };
    }

    _drawAxes(ctx, w, h) {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(cx, cy) * 0.85;

        ctx.strokeStyle = '#1f242d';
        ctx.lineWidth = 1;

        // Circle & M/S diagonals
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx, cy + r);
        ctx.moveTo(cx - r, cy);
        ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx - r * 0.7, cy - r * 0.7);
        ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
        ctx.moveTo(cx + r * 0.7, cy - r * 0.7);
        ctx.lineTo(cx - r * 0.7, cy + r * 0.7);
        ctx.stroke();

        ctx.fillStyle = '#555d6b';
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.fillText('M', cx + 4, cy - r + 10);
        ctx.fillText('S', cx + r - 12, cy - 4);
        ctx.fillText('L', cx - r * 0.68, cy - r * 0.55);
        ctx.fillText('R', cx + r * 0.58, cy - r * 0.55);
    }

    _drawIdleVectorscope() {
        if (!this.ctx || !this.canvas) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.fillStyle = '#0e1013';
        this.ctx.fillRect(0, 0, w, h);
        this._drawAxes(this.ctx, w, h);
    }

    _drawActiveVectorscope(bufL, bufR, isRemastered) {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = 'rgba(14, 16, 19, 0.45)';
        ctx.fillRect(0, 0, w, h);
        this._drawAxes(ctx, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const scale = Math.min(cx, cy) * 0.82;

        ctx.strokeStyle = isRemastered ? 'rgba(240, 165, 0, 0.75)' : 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();

        const len = bufL.length;
        for (let i = 0; i < len; i += 2) {
            const l = bufL[i];
            const r = bufR[i];
            // Rotate 45 degrees: X = Side (L - R)*0.707, Y = Mid (L + R)*0.707
            const side = (l - r) * 0.707;
            const mid = (l + r) * 0.707;
            const x = cx - side * scale;
            const y = cy - mid * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}
