/**
 * ==========================================================================
 * Audio Analyzer, Smart Auto-Master Engine & Multi-Bit-Depth WAV Encoder
 * ==========================================================================
 */

import { DEFAULT_SETTINGS } from './presets.js';

/**
 * Analyzes an AudioBuffer for Peak, RMS, Integrated LUFS (K-weighted gated),
 * Dynamic Range (Crest Factor), Phase Correlation, Stereo Width, and 6-Band Spectrum.
 */
export function analyzeAudioBuffer(buffer) {
    if (!buffer || buffer.length === 0) return null;

    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

    let peak = 0;
    let sumSqTotal = 0;

    // Stereo correlation accumulators
    let sumLR = 0;
    let sumLL = 0;
    let sumRR = 0;
    let sumMidSq = 0;
    let sumSideSq = 0;

    for (let i = 0; i < length; i++) {
        const l = ch0[i];
        const r = ch1[i];
        const absL = Math.abs(l);
        const absR = Math.abs(r);
        if (absL > peak) peak = absL;
        if (absR > peak) peak = absR;

        const power = 0.5 * (l * l + r * r);
        sumSqTotal += power;

        if (numChannels > 1 && (i & 3) === 0) {
            sumLR += l * r;
            sumLL += l * l;
            sumRR += r * r;
            const mid = 0.5 * (l + r);
            const side = 0.5 * (l - r);
            sumMidSq += mid * mid;
            sumSideSq += side * side;
        }
    }

    const rms = Math.sqrt(sumSqTotal / length);
    const peakDb = peak > 1e-7 ? 20 * Math.log10(peak) : -100;
    const rmsDb = rms > 1e-7 ? 20 * Math.log10(rms) : -100;
    const crestFactorDb = Math.max(0, peakDb - rmsDb);

    // K-weighted Gated Integrated LUFS estimation (400ms blocks)
    const lufsIntegrated = estimateIntegratedLufs(ch0, ch1, sampleRate);

    // Stereo Phase Correlation (-1 to +1) & Side/Mid ratio
    let phaseCorrelation = 1.0;
    let stereoSideRatio = 0;
    if (numChannels > 1) {
        const denom = Math.sqrt(sumLL * sumRR);
        phaseCorrelation = denom > 1e-9 ? Math.max(-1, Math.min(1, sumLR / denom)) : 1.0;
        stereoSideRatio = sumMidSq > 1e-9 ? Math.sqrt(sumSideSq / sumMidSq) : 0;
    }

    // Spectral Band Energy Analysis (using Goertzel / Bandpass IIR approximations across sampled frames)
    const spectral = analyzeSpectralBalance(ch0, ch1, sampleRate);

    // Leading / Trailing silence detection
    const silenceBounds = detectSilenceBounds(ch0, ch1, sampleRate);

    return {
        duration: buffer.duration,
        sampleRate,
        numChannels,
        peakDb,
        rmsDb,
        lufsIntegrated,
        crestFactorDb,
        phaseCorrelation,
        stereoSideRatio,
        spectral,
        silenceBounds
    };
}

/**
 * ITU-R BS.1770 inspired K-weighted gated loudness estimator.
 */
function estimateIntegratedLufs(ch0, ch1, sampleRate) {
    const length = ch0.length;
    // Simple 1st-order high-frequency shelf boost (+4dB above 1.5kHz) + 60Hz HPF approximation via differencing
    const blockSamples = Math.max(1024, Math.floor(sampleRate * 0.4));
    const hopSamples = Math.max(512, Math.floor(blockSamples / 2));
    const blockEnergies = [];

    let prevL = 0;
    let prevR = 0;

    for (let start = 0; start + blockSamples <= length; start += hopSamples) {
        let blockSum = 0;
        const end = start + blockSamples;
        // Stride by 2 for fast evaluation on long tracks
        let count = 0;
        for (let i = start; i < end; i += 2) {
            const l = ch0[i];
            const r = ch1[i];
            // High-frequency emphasis proxy for K-weighting
            const hfL = l - 0.85 * prevL;
            const hfR = r - 0.85 * prevR;
            prevL = l;
            prevR = r;

            const kL = l * 0.85 + hfL * 0.65;
            const kR = r * 0.85 + hfR * 0.65;
            blockSum += 0.5 * (kL * kL + kR * kR);
            count++;
        }
        const meanSq = blockSum / Math.max(1, count);
        const blockLufs = meanSq > 1e-10 ? -0.691 + 10 * Math.log10(meanSq) : -100;
        if (blockLufs > -70) {
            blockEnergies.push({ meanSq, blockLufs });
        }
    }

    if (blockEnergies.length === 0) return -70;

    // Relative gate (-10 LU below ungated average)
    const ungatedMean = blockEnergies.reduce((acc, b) => acc + b.meanSq, 0) / blockEnergies.length;
    const relativeGateLufs = (-0.691 + 10 * Math.log10(Math.max(1e-10, ungatedMean))) - 10;

    const gatedBlocks = blockEnergies.filter(b => b.blockLufs >= relativeGateLufs);
    const finalMean = (gatedBlocks.length > 0 ? gatedBlocks : blockEnergies)
        .reduce((acc, b) => acc + b.meanSq, 0) / Math.max(1, (gatedBlocks.length || blockEnergies.length));

    return -0.691 + 10 * Math.log10(Math.max(1e-10, finalMean));
}

/**
 * Analyzes relative energy (in dB relative to broadband RMS) across 6 key mastering frequency bands:
 *  - sub (20-60 Hz)
 *  - bass (60-200 Hz)
 *  - lowMid (200-500 Hz - mud/boxiness zone)
 *  - mid (500-2500 Hz - vocal/body zone)
 *  - highMid (2500-7500 Hz - AI harshness/shimmer zone)
 *  - air (7500-16000 Hz - brilliance/air)
 */
function analyzeSpectralBalance(ch0, ch1, sampleRate) {
    const length = ch0.length;
    // Sample up to 60 windows of 1024 samples spread across the middle 80% of the track
    const fftSize = 1024;
    const numWindows = Math.min(48, Math.max(8, Math.floor(length / fftSize)));
    const startIdx = Math.floor(length * 0.08);
    const usableLen = Math.max(fftSize, Math.floor(length * 0.84));
    const step = Math.max(fftSize, Math.floor(usableLen / numWindows));

    // Use resonant 2nd-order bandpass filters evaluated in-memory for each target center frequency
    const bandCenters = [
        { key: 'sub', freq: 42, q: 1.0 },
        { key: 'bass', freq: 115, q: 0.9 },
        { key: 'lowMid', freq: 300, q: 1.0 },
        { key: 'mid', freq: 1350, q: 0.8 },
        { key: 'highMid', freq: 4800, q: 0.9 },
        { key: 'air', freq: 10500, q: 0.9 }
    ];

    const coeffs = bandCenters.map(b => computeBandpassCoeffs(b.freq, b.q, sampleRate));
    const energySums = new Float64Array(bandCenters.length);
    let totalSamplesCounted = 0;

    for (let w = 0; w < numWindows; w++) {
        const offset = Math.min(length - fftSize, startIdx + w * step);
        if (offset < 0) break;

        for (let bIdx = 0; bIdx < coeffs.length; bIdx++) {
            const c = coeffs[bIdx];
            let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
            let eSum = 0;
            for (let i = 0; i < fftSize; i++) {
                const x0 = 0.5 * (ch0[offset + i] + ch1[offset + i]);
                const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
                x2 = x1; x1 = x0;
                y2 = y1; y1 = y0;
                eSum += y0 * y0;
            }
            energySums[bIdx] += eSum;
        }
        totalSamplesCounted += fftSize;
    }

    const dbBands = {};
    let avgDbSum = 0;
    bandCenters.forEach((b, idx) => {
        const rms = Math.sqrt(energySums[idx] / Math.max(1, totalSamplesCounted));
        const db = rms > 1e-8 ? 20 * Math.log10(rms) : -90;
        dbBands[b.key] = db;
        avgDbSum += db;
    });

    const meanBandDb = avgDbSum / bandCenters.length;
    // Relative tilt compared to track mean
    const rel = {};
    bandCenters.forEach(b => {
        rel[b.key] = dbBands[b.key] - meanBandDb;
    });

    return { absoluteDb: dbBands, relativeDb: rel };
}

function computeBandpassCoeffs(freq, Q, sampleRate) {
    const f = Math.min(sampleRate * 0.45, Math.max(20, freq));
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);

    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;

    return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0
    };
}

function detectSilenceBounds(ch0, ch1, sampleRate) {
    const threshold = Math.pow(10, -52 / 20); // -52 dBFS
    const length = ch0.length;
    const step = Math.max(1, Math.floor(sampleRate * 0.01)); // 10ms steps

    let firstSoundIdx = 0;
    for (let i = 0; i < length; i += step) {
        if (Math.abs(ch0[i]) > threshold || Math.abs(ch1[i]) > threshold) {
            firstSoundIdx = Math.max(0, i - step * 5);
            break;
        }
    }

    let lastSoundIdx = length;
    for (let i = length - 1; i >= 0; i -= step) {
        if (Math.abs(ch0[i]) > threshold || Math.abs(ch1[i]) > threshold) {
            lastSoundIdx = Math.min(length, i + step * 10);
            break;
        }
    }

    return {
        startSec: Number((firstSoundIdx / sampleRate).toFixed(2)),
        endSec: Number((lastSoundIdx / sampleRate).toFixed(2))
    };
}

/**
 * Smart Auto-Master Engine:
 * Analyzes track metrics & spectral tilt (especially AI-generated Suno/Udio artifacts)
 * and computes optimal settings for all controls + diagnostic explanations.
 */
export function computeSmartAutoMaster(metrics) {
    if (!metrics) {
        return { settings: { ...DEFAULT_SETTINGS }, explanations: [] };
    }

    const s = {
        ...DEFAULT_SETTINGS,
        trimStartSec: 0,
        trimEndSec: Number(metrics.duration.toFixed(2))
    };
    const explanations = [];
    const rel = metrics.spectral.relativeDb;

    // 1. Sub-bass Rumble & Low-End Balance
    const subExcess = rel.sub - rel.bass;
    if (subExcess > 1.5) {
        s.eq0Freq = 45;
        explanations.push('Cut excess sub-rumble below 45 Hz');
    } else {
        s.eq0Freq = 32;
    }

    // Bass Shelf (Band 2) compared to Mid reference
    const bassVsMid = rel.bass - rel.mid;
    if (bassVsMid < -1.5) {
        s.eq1Freq = 95;
        s.eq1Gain = Number(Math.min(4.0, (-bassVsMid) * 0.7).toFixed(1));
        explanations.push(`Boosted low-end punch (+${s.eq1Gain} dB @ 95 Hz)`);
    } else if (bassVsMid > 4.5) {
        s.eq1Freq = 105;
        s.eq1Gain = Number(Math.max(-3.5, -(bassVsMid - 3.5) * 0.65).toFixed(1));
        explanations.push(`Tightened booming bass (${s.eq1Gain} dB @ 105 Hz)`);
    } else {
        s.eq1Freq = 95;
        s.eq1Gain = 1.2;
        explanations.push('Added +1.2 dB warm low-shelf foundation');
    }

    // 2. Low-Mid Boxiness / AI Mud (200-450 Hz)
    const mudVsMid = rel.lowMid - rel.mid;
    if (mudVsMid > 0.5) {
        const cutDb = -Math.min(4.2, 1.4 + mudVsMid * 0.65);
        s.eq2Freq = 275;
        s.eq2Gain = Number(cutDb.toFixed(1));
        s.eq2Q = 1.7;
        s.mudCleanerAmount = Math.min(75, Math.round(25 + mudVsMid * 12));
        explanations.push(`Cleaned AI low-mid mud (${s.eq2Gain} dB @ 275 Hz, De-Mud ${s.mudCleanerAmount}%)`);
    } else {
        s.eq2Freq = 280;
        s.eq2Gain = -1.6;
        s.eq2Q = 1.5;
        s.mudCleanerAmount = 22;
        explanations.push('Sculpted 280 Hz low-mids for clarity (-1.6 dB)');
    }

    // 3. Mid Vocal/Instrument Presence (1.4 - 1.8 kHz)
    s.eq3Freq = 1600;
    s.eq3Gain = rel.mid < 1.5 ? 1.4 : 0.7;
    s.eq3Q = 1.1;

    // 4. High-Mid Harshness / "Suno Metallic Shimmer" (3.5 - 7.5 kHz)
    const harshVsMid = rel.highMid - rel.mid;
    if (harshVsMid > -4.5) {
        const severity = Math.max(0.25, Math.min(1.0, (harshVsMid + 5.5) / 6.5));
        s.eq4Freq = 4850;
        s.eq4Gain = Number((-1.5 - severity * 2.2).toFixed(1));
        s.eq4Q = 2.1;
        s.harshTamerAmount = Math.round(28 + severity * 42);
        s.harshTamerFreq = 5100;
        explanations.push(`Suppressed 4.9 kHz AI shimmer (${s.eq4Gain} dB + ${s.harshTamerAmount}% Harshness Tamer)`);
    } else {
        s.eq4Freq = 4700;
        s.eq4Gain = -1.2;
        s.eq4Q = 1.8;
        s.harshTamerAmount = 22;
        s.harshTamerFreq = 5000;
        explanations.push('Smoothed upper-mid transients (22% Harshness Tamer)');
    }

    // 5. High-Frequency Air & Exciter (>10 kHz)
    const airVsMid = rel.air - rel.mid;
    if (airVsMid < -11) {
        s.eq5Freq = 10800;
        s.eq5Gain = 2.6;
        s.airExciter = 28;
        explanations.push('Restored top-end sparkle (+2.6 dB Air Shelf + 28% Air Exciter)');
    } else {
        s.eq5Freq = 11200;
        s.eq5Gain = 1.5;
        s.airExciter = 16;
        explanations.push('Added silky 11.2 kHz studio air (+1.5 dB)');
    }

    // 6. Analog Glue Saturation
    s.saturationMode = 'tape';
    s.warmthDrive = 28;
    explanations.push('Applied 28% Analog Tape harmonic glue');

    // 7. Dynamics & Loudness Normalization toward ~ -13.5 LUFS
    const currentLufs = metrics.lufsIntegrated;
    const targetLufs = -13.5;
    const lufsDelta = targetLufs - currentLufs;

    if (metrics.crestFactorDb > 13.5) {
        s.compThreshold = -21;
        s.compRatio = 3.2;
        s.compAttack = 14;
        s.compRelease = 150;
        explanations.push('Tamed wide dynamic swings (3.2:1 Bus Compressor)');
    } else if (metrics.crestFactorDb < 8.5) {
        s.compThreshold = -14;
        s.compRatio = 1.8;
        s.compAttack = 28;
        s.compRelease = 180;
        explanations.push('Preserved punch with gentle 1.8:1 slow-attack compression');
    } else {
        s.compThreshold = -18;
        s.compRatio = 2.5;
        s.compAttack = 18;
        s.compRelease = 150;
    }

    s.limiterThreshold = -0.8;
    // Calculate Master Gain to bring track close to target loudness without over-crushing
    const suggestedGain = Math.max(-4.0, Math.min(6.5, lufsDelta * 0.65 + 1.2));
    s.masterGain = Number(suggestedGain.toFixed(1));
    explanations.push(`Optimized loudness (${s.masterGain >= 0 ? '+' : ''}${s.masterGain} dB Master Gain, -0.8 dBFS Brickwall Ceiling)`);

    // 8. True Mid/Side Stereo Imaging & Bass Mono
    s.bassMonoFreq = 135;
    if (metrics.numChannels > 1) {
        if (metrics.stereoSideRatio < 0.25) {
            s.stereoWidth = 126;
            s.sideAirBoost = 2.0;
            explanations.push('Expanded narrow stereo image to 126% M/S width + Bass Mono <135 Hz');
        } else if (metrics.stereoSideRatio > 0.68 || metrics.phaseCorrelation < 0.25) {
            s.stereoWidth = 94;
            s.bassMonoFreq = 160;
            s.sideAirBoost = 0.8;
            explanations.push('Stabilized phasey stereo width (94% M/S + Bass Mono <160 Hz)');
        } else {
            s.stereoWidth = 114;
            s.sideAirBoost = 1.5;
            explanations.push('Enhanced stereo field (114% M/S width, Bass Mono <135 Hz)');
        }
    }

    s.reverbMix = 3;

    // 9. Trim & Silence check
    if (metrics.silenceBounds.startSec >= 0.4) {
        s.trimStartSec = Number(Math.max(0, metrics.silenceBounds.startSec - 0.1).toFixed(2));
        explanations.push(`Trimmed ${s.trimStartSec}s of leading silence`);
    }
    if (metrics.duration - metrics.silenceBounds.endSec >= 0.6) {
        s.trimEndSec = Number(Math.min(metrics.duration, metrics.silenceBounds.endSec + 0.2).toFixed(2));
        explanations.push(`Trimmed ${(metrics.duration - s.trimEndSec).toFixed(1)}s of trailing dead air`);
    }

    return { settings: s, explanations };
}

/**
 * Multi-Bit-Depth WAV Encoder (16-bit PCM, 24-bit PCM, 32-bit IEEE Float)
 */
export function encodeBufferToWavBlob(audioBuffer, bitDepth = 24) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numFrames = audioBuffer.length;

    const validDepth = (bitDepth === 16 || bitDepth === 24 || bitDepth === 32) ? bitDepth : 24;
    const bytesPerSample = validDepth / 8;
    const formatCode = validDepth === 32 ? 3 : 1; // 3 = IEEE Float, 1 = PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);
    let pos = 0;

    const writeUint16 = (val) => { view.setUint16(pos, val, true); pos += 2; };
    const writeUint32 = (val) => { view.setUint32(pos, val, true); pos += 4; };

    // RIFF WAVE Header
    writeUint32(0x46464952); // "RIFF"
    writeUint32(bufferSize - 8);
    writeUint32(0x45564157); // "WAVE"

    // fmt chunk
    writeUint32(0x20746d66); // "fmt "
    writeUint32(16);         // Subchunk1Size
    writeUint16(formatCode);
    writeUint16(numChannels);
    writeUint32(sampleRate);
    writeUint32(byteRate);
    writeUint16(blockAlign);
    writeUint16(validDepth);

    // data chunk
    writeUint32(0x61746164); // "data"
    writeUint32(dataSize);

    const channels = [];
    for (let c = 0; c < numChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
    }

    if (validDepth === 16) {
        for (let i = 0; i < numFrames; i++) {
            for (let c = 0; c < numChannels; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                const intVal = s < 0 ? s * 32768 : s * 32767;
                view.setInt16(pos, intVal, true);
                pos += 2;
            }
        }
    } else if (validDepth === 24) {
        for (let i = 0; i < numFrames; i++) {
            for (let c = 0; c < numChannels; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                const intVal = Math.round(s < 0 ? s * 8388608 : s * 8388607);
                view.setUint8(pos, intVal & 0xff);
                view.setUint8(pos + 1, (intVal >> 8) & 0xff);
                view.setUint8(pos + 2, (intVal >> 16) & 0xff);
                pos += 3;
            }
        }
    } else {
        // 32-bit IEEE Float
        for (let i = 0; i < numFrames; i++) {
            for (let c = 0; c < numChannels; c++) {
                view.setFloat32(pos, channels[c][i], true);
                pos += 4;
            }
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}
