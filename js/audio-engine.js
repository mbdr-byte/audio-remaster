/**
 * ==========================================================================
 * Unified Web Audio DSP Mastering Engine
 * Shared processing graph for both Live Playback and Offline Rendering.
 * Includes:
 *  - 6-Band Parametric EQ with live frequency response calculation
 *  - AI Restoration (Dynamic Harshness Suppressor, De-Mud, Tape/Tube/Warm Saturation, Air Exciter)
 *  - Full Dynamics Compressor + Brickwall Limiter
 *  - True Mid/Side Stereo Matrix + Bass Mono Maker + Side Air + Stereo Diffusion Reverb
 *  - Glitch-free parallel A/B crossfading & Loudness-Matched A/B
 * ==========================================================================
 */

import { EQ_BAND_DEFS, DEFAULT_SETTINGS } from './presets.js';

/**
 * Generates waveshaper transfer curves for Tape, Tube, Warmth, and Soft-Clipper.
 */
const curveCache = new Map();

export function getSaturationCurve(mode = 'tape', drivePercent = 0) {
    const clampedDrive = Math.max(0, Math.min(100, drivePercent));
    const cacheKey = `${mode}:${clampedDrive.toFixed(1)}`;
    if (curveCache.has(cacheKey)) {
        return curveCache.get(cacheKey);
    }

    const n = 4096;
    const curve = new Float32Array(n);
    const amount = clampedDrive / 100;

    if (amount <= 0.001) {
        for (let i = 0; i < n; i++) {
            curve[i] = (i * 2) / n - 1;
        }
        curveCache.set(cacheKey, curve);
        return curve;
    }

    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        if (mode === 'tube') {
            // Asymmetric triode tube saturation: strong 2nd-order even harmonics + punchy upper mids
            const k = 1.4 + amount * 5.2;
            const asym = x + 0.28 * amount * (x * x - 0.25);
            const dcOffset = Math.tanh(k * (-0.28 * amount * 0.25));
            const raw = Math.tanh(k * asym) - dcOffset;
            curve[i] = Math.max(-1, Math.min(1, raw * 0.95));
        } else if (mode === 'warm') {
            // Soft analog transformer warmth: smooth, round knee compression
            const g = 1.2 + amount * 3.8;
            const shaped = (g * x) / (1 + g * 0.78 * Math.abs(x));
            curve[i] = Math.max(-1, Math.min(1, shaped));
        } else {
            // 'tape' - classic magnetic tape odd-harmonic tanh compression
            const k = 1.3 + amount * 4.5;
            const norm = Math.tanh(k);
            curve[i] = Math.tanh(k * x) / (norm || 1);
        }
    }

    curveCache.set(cacheKey, curve);
    return curve;
}

/**
 * Soft-clipping brickwall safety ceiling curve
 */
export function getCeilingClipperCurve(ceilingDb = -1.0) {
    const key = `ceiling:${ceilingDb.toFixed(2)}`;
    if (curveCache.has(key)) return curveCache.get(key);

    const n = 4096;
    const curve = new Float32Array(n);
    const limit = Math.pow(10, ceilingDb / 20);
    const kneeStart = limit * 0.92;

    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        const absX = Math.abs(x);
        const sign = x < 0 ? -1 : 1;
        if (absX <= kneeStart) {
            curve[i] = x;
        } else {
            const excess = (absX - kneeStart) / Math.max(0.0001, limit - kneeStart);
            const compressed = kneeStart + (limit - kneeStart) * Math.tanh(excess);
            curve[i] = sign * Math.min(limit, compressed);
        }
    }

    curveCache.set(key, curve);
    return curve;
}

/**
 * Helper to create a click-free bypass wrapper around a module sub-graph.
 */
function createBypassStage(ctx) {
    const input = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    const output = ctx.createGain();

    input.connect(dryGain);
    dryGain.connect(output);
    wetGain.connect(output);

    dryGain.gain.value = 0;
    wetGain.gain.value = 1;

    return {
        input,
        wetGain,
        output,
        setBypassed(isBypassed, time = ctx.currentTime, smooth = true) {
            const targetDry = isBypassed ? 1 : 0;
            const targetWet = isBypassed ? 0 : 1;
            if (smooth && typeof dryGain.gain.setTargetAtTime === 'function' && time > 0) {
                dryGain.gain.setTargetAtTime(targetDry, time, 0.012);
                wetGain.gain.setTargetAtTime(targetWet, time, 0.012);
            } else {
                dryGain.gain.setValueAtTime(targetDry, time);
                wetGain.gain.setValueAtTime(targetWet, time);
            }
        }
    };
}

/**
 * Builds the complete mastering DSP graph on any BaseAudioContext (live or OfflineAudioContext).
 */
export function buildMasteringChain(ctx, numChannels = 2) {
    const chainInput = ctx.createGain();
    const chainOutput = ctx.createGain();

    // ======================================================================
    // MODULE 1: 6-Band Parametric EQ
    // ======================================================================
    const eqStage = createBypassStage(ctx);
    chainInput.connect(eqStage.input);

    const eqBands = EQ_BAND_DEFS.map(def => {
        const filter = ctx.createBiquadFilter();
        filter.type = def.type;
        filter.frequency.value = def.defaultFreq;
        filter.Q.value = def.defaultQ;
        filter.gain.value = def.defaultGain;
        return filter;
    });

    let prevEqNode = eqStage.input;
    eqBands.forEach(band => {
        prevEqNode.connect(band);
        prevEqNode = band;
    });
    prevEqNode.connect(eqStage.wetGain);

    // ======================================================================
    // MODULE 2: AI Restoration (De-Mud, Harshness Tamer, Saturation, Air Exciter)
    // ======================================================================
    const aiStage = createBypassStage(ctx);
    eqStage.output.connect(aiStage.input);

    // 2a. De-Mud Sub & Boxiness Filter
    const deMudSubHpf = ctx.createBiquadFilter();
    deMudSubHpf.type = 'highpass';
    deMudSubHpf.frequency.value = 20;
    deMudSubHpf.Q.value = 0.71;

    const deMudNotch = ctx.createBiquadFilter();
    deMudNotch.type = 'peaking';
    deMudNotch.frequency.value = 265;
    deMudNotch.Q.value = 1.6;
    deMudNotch.gain.value = 0;

    // 2b. Harshness / "AI Shimmer" Suppressor (Surgical Notch + HF Dynamic Tamer)
    const harshNotch1 = ctx.createBiquadFilter();
    harshNotch1.type = 'peaking';
    harshNotch1.frequency.value = 5200;
    harshNotch1.Q.value = 2.4;
    harshNotch1.gain.value = 0;

    const harshNotch2 = ctx.createBiquadFilter();
    harshNotch2.type = 'peaking';
    harshNotch2.frequency.value = 7200;
    harshNotch2.Q.value = 3.0;
    harshNotch2.gain.value = 0;

    const harshDynFilter = ctx.createBiquadFilter();
    harshDynFilter.type = 'peaking';
    harshDynFilter.frequency.value = 5200;
    harshDynFilter.Q.value = 1.2;
    harshDynFilter.gain.value = 0;

    // 2c. Analog Tape / Tube / Warm Saturation (Dry/Wet parallel blend + distinct tonal character)
    const satInput = ctx.createGain();
    const satDry = ctx.createGain();
    const satPreDrive = ctx.createGain();
    const satShaper = ctx.createWaveShaper();
    satShaper.oversample = '4x';
    satShaper.curve = getSaturationCurve('tape', 0);

    // Character post-filters so Tape, Tube, and Warm sound unmistakably distinct
    const satToneLow = ctx.createBiquadFilter();
    satToneLow.type = 'lowshelf';
    satToneLow.frequency.value = 120;
    satToneLow.gain.value = 0;

    const satToneMid = ctx.createBiquadFilter();
    satToneMid.type = 'peaking';
    satToneMid.frequency.value = 1100;
    satToneMid.Q.value = 0.9;
    satToneMid.gain.value = 0;

    const satToneHigh = ctx.createBiquadFilter();
    satToneHigh.type = 'highshelf';
    satToneHigh.frequency.value = 6000;
    satToneHigh.gain.value = 0;

    const satWet = ctx.createGain();
    const satMixOut = ctx.createGain();

    satInput.connect(satDry);
    satDry.connect(satMixOut);
    satInput.connect(satPreDrive);
    satPreDrive.connect(satShaper);
    satShaper.connect(satToneLow);
    satToneLow.connect(satToneMid);
    satToneMid.connect(satToneHigh);
    satToneHigh.connect(satWet);
    satWet.connect(satMixOut);

    // 2d. High-Frequency Harmonic Air Exciter (>6.5 kHz harmonic generator)
    const airHpf = ctx.createBiquadFilter();
    airHpf.type = 'highpass';
    airHpf.frequency.value = 6500;
    airHpf.Q.value = 0.71;
    const airShaper = ctx.createWaveShaper();
    airShaper.oversample = '2x';
    airShaper.curve = getSaturationCurve('tube', 55);
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    const aiOutSum = ctx.createGain();

    aiStage.input
        .connect(deMudSubHpf)
        .connect(deMudNotch)
        .connect(harshNotch1)
        .connect(harshNotch2)
        .connect(harshDynFilter)
        .connect(satInput);

    satMixOut.connect(aiOutSum);
    satMixOut.connect(airHpf);
    airHpf.connect(airShaper);
    airShaper.connect(airGain);
    airGain.connect(aiOutSum);
    aiOutSum.connect(aiStage.wetGain);

    // ======================================================================
    // MODULE 3: Advanced Dynamics & Brickwall Limiter
    // ======================================================================
    const dynStage = createBypassStage(ctx);
    aiStage.output.connect(dynStage.input);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.16;
    compressor.knee.value = 6;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.045;

    const safetyClipper = ctx.createWaveShaper();
    safetyClipper.oversample = '2x';
    safetyClipper.curve = getCeilingClipperCurve(-1.0);

    dynStage.input
        .connect(compressor)
        .connect(masterGain)
        .connect(limiter)
        .connect(safetyClipper)
        .connect(dynStage.wetGain);

    // ======================================================================
    // MODULE 4: True Mid/Side Stereo Imaging, Bass Mono & Studio Reverb
    // ======================================================================
    const spaceStage = createBypassStage(ctx);
    dynStage.output.connect(spaceStage.input);

    const msOutputNode = ctx.createGain();

    // True Mid/Side Matrix (active when stereo; cleanly passes through on mono)
    let midGainNode = null;
    let sideGainNode = null;
    let sideBassMonoHpf = null;
    let sideAirShelf = null;

    if (numChannels >= 2) {
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);

        // Encode L & R into Mid = 0.5*(L+R) and Side = 0.5*(L-R)
        const lToMid = ctx.createGain(); lToMid.gain.value = 0.5;
        const rToMid = ctx.createGain(); rToMid.gain.value = 0.5;
        const lToSide = ctx.createGain(); lToSide.gain.value = 0.5;
        const rToSide = ctx.createGain(); rToSide.gain.value = -0.5;

        const midSum = ctx.createGain();
        const sideSum = ctx.createGain();

        spaceStage.input.connect(splitter);
        splitter.connect(lToMid, 0);
        splitter.connect(rToMid, 1);
        lToMid.connect(midSum);
        rToMid.connect(midSum);

        splitter.connect(lToSide, 0);
        splitter.connect(rToSide, 1);
        lToSide.connect(sideSum);
        rToSide.connect(sideSum);

        // Process Side channel: Bass Mono High-Pass + Side Air High-Shelf + Width Gain
        sideBassMonoHpf = ctx.createBiquadFilter();
        sideBassMonoHpf.type = 'highpass';
        sideBassMonoHpf.frequency.value = 120;
        sideBassMonoHpf.Q.value = 0.71;

        sideAirShelf = ctx.createBiquadFilter();
        sideAirShelf.type = 'highshelf';
        sideAirShelf.frequency.value = 6500;
        sideAirShelf.gain.value = 0;

        midGainNode = ctx.createGain();
        midGainNode.gain.value = 1.0;

        sideGainNode = ctx.createGain();
        sideGainNode.gain.value = 1.0;

        midSum.connect(midGainNode);
        sideSum.connect(sideBassMonoHpf);
        sideBassMonoHpf.connect(sideAirShelf);
        sideAirShelf.connect(sideGainNode);

        // Decode Mid & Side back to L = Mid + Side, R = Mid - Side
        const sideInvertToR = ctx.createGain();
        sideInvertToR.gain.value = -1.0;

        midGainNode.connect(merger, 0, 0); // Mid -> L
        sideGainNode.connect(merger, 0, 0); // +Side -> L

        midGainNode.connect(merger, 0, 1); // Mid -> R
        sideGainNode.connect(sideInvertToR);
        sideInvertToR.connect(merger, 0, 1); // -Side -> R

        merger.connect(msOutputNode);
    } else {
        spaceStage.input.connect(msOutputNode);
    }

    // Studio Multi-Tap Stereo Diffusion Reverb
    const revDry = ctx.createGain();
    const revWet = ctx.createGain();
    const revSum = ctx.createGain();

    const revPreHp = ctx.createBiquadFilter();
    revPreHp.type = 'highpass';
    revPreHp.frequency.value = 180;

    const revDampingLpf = ctx.createBiquadFilter();
    revDampingLpf.type = 'lowpass';
    revDampingLpf.frequency.value = 4200;

    const delayTimes = [0.029, 0.043, 0.061, 0.083];
    const delayNodes = delayTimes.map(t => {
        const d = ctx.createDelay(0.25);
        d.delayTime.value = t;
        return d;
    });
    const revFeedback = ctx.createGain();
    revFeedback.gain.value = 0.32;

    msOutputNode.connect(revDry);
    revDry.connect(revSum);

    msOutputNode.connect(revPreHp);
    revPreHp.connect(delayNodes[0]);
    delayNodes[0].connect(delayNodes[1]);
    delayNodes[1].connect(revDampingLpf);
    revDampingLpf.connect(delayNodes[2]);
    delayNodes[2].connect(delayNodes[3]);
    delayNodes[3].connect(revFeedback);
    revFeedback.connect(delayNodes[0]);

    delayNodes.forEach(d => d.connect(revWet));
    revWet.connect(revSum);
    revSum.connect(spaceStage.wetGain);

    spaceStage.output.connect(chainOutput);

    /**
     * Applies a complete settings object to all nodes in the graph.
     */
    function applySettings(settings = DEFAULT_SETTINGS, time = ctx.currentTime, smooth = false) {
        const s = { ...DEFAULT_SETTINGS, ...settings };
        const setParam = (audioParam, val) => {
            if (!Number.isFinite(val)) return;
            if (smooth && typeof audioParam.setTargetAtTime === 'function' && time > 0) {
                audioParam.setTargetAtTime(val, time, 0.015);
            } else {
                audioParam.setValueAtTime(val, time);
            }
        };

        // Module bypass states
        eqStage.setBypassed(Boolean(s.bypassEq), time, smooth);
        aiStage.setBypassed(Boolean(s.bypassAiRestore), time, smooth);
        dynStage.setBypassed(Boolean(s.bypassDynamics), time, smooth);
        spaceStage.setBypassed(Boolean(s.bypassStereoSpace), time, smooth);

        // 1. 6-Band Parametric EQ
        EQ_BAND_DEFS.forEach((def, idx) => {
            const freq = Number(s[`eq${idx}Freq`]);
            const gain = Number(s[`eq${idx}Gain`]);
            const q = Number(s[`eq${idx}Q`]);
            setParam(eqBands[idx].frequency, freq);
            setParam(eqBands[idx].Q, q);
            if (def.hasGain) {
                setParam(eqBands[idx].gain, gain);
            }
        });

        // 2. AI Restoration
        const mudAmt = Math.max(0, Math.min(100, Number(s.mudCleanerAmount))) / 100;
        setParam(deMudSubHpf.frequency, 20 + mudAmt * 32); // 20 Hz -> 52 Hz
        setParam(deMudNotch.gain, -mudAmt * 5.5);          // up to -5.5 dB cut at 265 Hz

        const harshAmt = Math.max(0, Math.min(100, Number(s.harshTamerAmount))) / 100;
        const harshCenter = Math.max(2500, Math.min(8500, Number(s.harshTamerFreq)));
        setParam(harshNotch1.frequency, harshCenter);
        setParam(harshNotch1.gain, -harshAmt * 5.2);       // primary shimmer notch
        setParam(harshNotch2.frequency, Math.min(10000, harshCenter * 1.38));
        setParam(harshNotch2.gain, -harshAmt * 3.4);       // upper harmonic fizz notch
        setParam(harshDynFilter.frequency, harshCenter * 0.92);
        setParam(harshDynFilter.gain, -harshAmt * 2.0);

        const driveVal = Math.max(0, Math.min(100, Number(s.warmthDrive)));
        const driveNorm = driveVal / 100;
        const satMode = s.saturationMode || 'tape';
        satShaper.curve = getSaturationCurve(satMode, driveVal);

        // Apply distinct character voicing per saturation mode when drive > 0
        if (satMode === 'tube') {
            // Tube: warm midrange harmonic push (+3.5 dB @ 1.1kHz) + slight bass fullness
            setParam(satPreDrive.gain, 1 + driveNorm * 1.3);
            setParam(satToneLow.gain, driveNorm * 1.8);
            setParam(satToneMid.gain, driveNorm * 3.6);
            setParam(satToneHigh.gain, driveNorm * 1.2);
        } else if (satMode === 'warm') {
            // Warm Console: thick low-end body (+4.2 dB @ 120Hz) + silky rolled-off highs (-3.8 dB @ 6kHz)
            setParam(satPreDrive.gain, 1 + driveNorm * 1.1);
            setParam(satToneLow.gain, driveNorm * 4.2);
            setParam(satToneMid.gain, driveNorm * 0.8);
            setParam(satToneHigh.gain, -driveNorm * 3.8);
        } else {
            // Tape: tight low-end bump (+2.6 dB @ 120Hz) + gentle tape high smoothing (-1.8 dB @ 6kHz)
            setParam(satPreDrive.gain, 1 + driveNorm * 1.2);
            setParam(satToneLow.gain, driveNorm * 2.6);
            setParam(satToneMid.gain, -driveNorm * 0.5);
            setParam(satToneHigh.gain, -driveNorm * 1.8);
        }

        const satWetAmt = driveNorm * 0.82;
        setParam(satDry.gain, 1 - satWetAmt * 0.8);
        setParam(satWet.gain, satWetAmt);

        const airVal = Math.max(0, Math.min(100, Number(s.airExciter))) / 100;
        setParam(airGain.gain, airVal * 0.38);

        // 3. Dynamics & Limiter
        setParam(compressor.threshold, Number(s.compThreshold));
        setParam(compressor.ratio, Math.max(1, Math.min(20, Number(s.compRatio))));
        setParam(compressor.attack, Math.max(0.001, Math.min(0.5, Number(s.compAttack) / 1000)));
        setParam(compressor.release, Math.max(0.01, Math.min(1.5, Number(s.compRelease) / 1000)));
        setParam(compressor.knee, Math.max(0, Math.min(40, Number(s.compKnee))));

        const gainDb = Number(s.masterGain);
        setParam(masterGain.gain, Math.pow(10, gainDb / 20));

        const ceilingDb = Math.max(-18, Math.min(-0.1, Number(s.limiterThreshold)));
        setParam(limiter.threshold, ceilingDb);
        safetyClipper.curve = getCeilingClipperCurve(ceilingDb);

        // 4. Mid/Side Stereo & Reverb
        if (midGainNode && sideGainNode && sideBassMonoHpf && sideAirShelf) {
            const widthRatio = Math.max(0, Math.min(200, Number(s.stereoWidth))) / 100;
            // Slight mid compensation when widening beyond 100% so center doesn't collapse
            const midComp = widthRatio > 1 ? 1 / (1 + (widthRatio - 1) * 0.18) : 1.0;
            setParam(midGainNode.gain, midComp);
            setParam(sideGainNode.gain, widthRatio * midComp);
            setParam(sideBassMonoHpf.frequency, Math.max(20, Math.min(300, Number(s.bassMonoFreq))));
            setParam(sideAirShelf.gain, Math.max(0, Math.min(6, Number(s.sideAirBoost))));
        }

        const revMix = Math.max(0, Math.min(30, Number(s.reverbMix))) / 100;
        const revDecay = Math.max(10, Math.min(90, Number(s.reverbDecay))) / 100;
        setParam(revDry.gain, 1 - revMix * 0.65);
        setParam(revWet.gain, revMix * 0.75);
        setParam(revFeedback.gain, 0.15 + revDecay * 0.42);
        setParam(revDampingLpf.frequency, Math.max(1000, Math.min(12000, Number(s.reverbDamping))));
    }

    /**
     * Computes composite magnitude response (in dB) of the 6-band EQ + AI Restoration filters
     * across an array of frequencies (Float32Array) for the interactive EQ canvas.
     */
    function getCompositeEQResponseDb(freqArray, settings = DEFAULT_SETTINGS) {
        const n = freqArray.length;
        const totalDb = new Float32Array(n);
        const mag = new Float32Array(n);
        const phase = new Float32Array(n);

        if (!settings.bypassEq) {
            eqBands.forEach(filter => {
                filter.getFrequencyResponse(freqArray, mag, phase);
                for (let i = 0; i < n; i++) {
                    const m = Math.max(1e-5, mag[i]);
                    totalDb[i] += 20 * Math.log10(m);
                }
            });
        }

        if (!settings.bypassAiRestore) {
            [deMudSubHpf, deMudNotch, harshNotch1, harshNotch2, harshDynFilter].forEach(filter => {
                filter.getFrequencyResponse(freqArray, mag, phase);
                for (let i = 0; i < n; i++) {
                    const m = Math.max(1e-5, mag[i]);
                    totalDb[i] += 20 * Math.log10(m);
                }
            });
        }

        return totalDb;
    }

    return {
        input: chainInput,
        output: chainOutput,
        eqBands,
        compressor,
        limiter,
        applySettings,
        getCompositeEQResponseDb,
        getGainReductionDb() {
            const compGr = Number(compressor.reduction) || 0;
            const limGr = Number(limiter.reduction) || 0;
            return compGr + limGr;
        }
    };
}

/**
 * Applies Trim Start/End and Fade-In / Fade-Out gain automation to a GainNode.
 */
export function scheduleTrimAndFades(envelopeGainParam, settings, bufferDuration, startOffset = 0, startTime = 0) {
    const trimStart = Math.max(0, Number(settings.trimStartSec) || 0);
    const rawTrimEnd = Number(settings.trimEndSec);
    const trimEnd = (rawTrimEnd > trimStart && rawTrimEnd <= bufferDuration) ? rawTrimEnd : bufferDuration;
    const activeDuration = Math.max(0.05, trimEnd - trimStart);

    const fadeIn = Math.max(0, Math.min(activeDuration * 0.45, Number(settings.fadeInSec) || 0));
    const fadeOut = Math.max(0, Math.min(activeDuration * 0.45, Number(settings.fadeOutSec) || 0));

    envelopeGainParam.cancelScheduledValues(startTime);

    const fadeInEndTrackTime = trimStart + fadeIn;
    const fadeOutStartTrackTime = trimEnd - fadeOut;

    if (fadeIn > 0.01 && startOffset < fadeInEndTrackTime) {
        const initRatio = Math.max(0.0001, (startOffset - trimStart) / fadeIn);
        const remainingFadeIn = Math.max(0.01, fadeInEndTrackTime - startOffset);
        envelopeGainParam.setValueAtTime(initRatio, startTime);
        envelopeGainParam.linearRampToValueAtTime(1.0, startTime + remainingFadeIn);
    } else {
        envelopeGainParam.setValueAtTime(1.0, startTime);
    }

    if (fadeOut > 0.01 && trimEnd > startOffset) {
        const timeUntilFadeOutStart = Math.max(0, fadeOutStartTrackTime - startOffset);
        const timeUntilTrimEnd = Math.max(0.01, trimEnd - startOffset);
        envelopeGainParam.setValueAtTime(1.0, startTime + timeUntilFadeOutStart);
        envelopeGainParam.linearRampToValueAtTime(0.0001, startTime + timeUntilTrimEnd);
    }
}

/**
 * Renders the AudioBuffer offline through the exact same DSP graph (plus Trim & Fades).
 */
export async function renderOfflineMaster(originalBuffer, settings) {
    const trimStart = Math.max(0, Math.min(originalBuffer.duration - 0.05, Number(settings.trimStartSec) || 0));
    const rawTrimEnd = Number(settings.trimEndSec);
    const trimEnd = (rawTrimEnd > trimStart && rawTrimEnd <= originalBuffer.duration)
        ? rawTrimEnd
        : originalBuffer.duration;

    const renderDuration = Math.max(0.05, trimEnd - trimStart);
    const sampleRate = originalBuffer.sampleRate;
    const reverbOn = Number(settings.reverbMix) > 0 && !settings.bypassStereoSpace;
    const tailSeconds = reverbOn ? 2 : 0;
    const renderLength = Math.max(1, Math.floor((renderDuration + tailSeconds) * sampleRate));

    const offlineCtx = new OfflineAudioContext(
        originalBuffer.numberOfChannels,
        renderLength,
        sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = originalBuffer;

    const fadeEnvelope = offlineCtx.createGain();
    const chain = buildMasteringChain(offlineCtx, originalBuffer.numberOfChannels);
    chain.applySettings(settings, 0, false);

    const fadeIn = Math.max(0, Math.min(renderDuration * 0.45, Number(settings.fadeInSec) || 0));
    const fadeOut = Math.max(0, Math.min(renderDuration * 0.45, Number(settings.fadeOutSec) || 0));

    if (fadeIn > 0.01) {
        fadeEnvelope.gain.setValueAtTime(0.0001, 0);
        fadeEnvelope.gain.linearRampToValueAtTime(1.0, fadeIn);
    } else {
        fadeEnvelope.gain.setValueAtTime(1.0, 0);
    }

    if (fadeOut > 0.01) {
        fadeEnvelope.gain.setValueAtTime(1.0, Math.max(0, renderDuration - fadeOut));
        fadeEnvelope.gain.linearRampToValueAtTime(0.0001, renderDuration);
    }

    source.connect(chain.input);
    chain.output.connect(fadeEnvelope);
    fadeEnvelope.connect(offlineCtx.destination);

    source.start(0, trimStart, renderDuration);
    const rendered = await offlineCtx.startRendering();
    if (!settings.bypassDynamics) {
        applyTruePeakCeiling(rendered, Number(settings.limiterThreshold));
    }
    return rendered;
}

/**
 * DynamicsCompressorNode has no lookahead, and later stages (reverb, stereo)
 * can push peaks back over the ceiling. Scale the finished buffer so the
 * exported file lands on the limiter threshold instead of hard-clipping.
 */
function applyTruePeakCeiling(buffer, thresholdDb) {
    const ceilingDb = Number.isFinite(thresholdDb) ? thresholdDb : -1;
    const ceiling = Math.pow(10, ceilingDb / 20);
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
        }
    }
    if (peak <= ceiling || peak === 0) return;

    const correction = ceiling / peak;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] *= correction;
    }
}

/**
 * Live Studio Transport & Real-Time Audio Engine
 */
export class LiveAudioEngine {
    constructor() {
        this.ctx = null;
        this.buffer = null;
        this.settings = { ...DEFAULT_SETTINGS };

        this.isPlaying = false;
        this.isRemasteredActive = true; // Default to Remastered (B) so user hears tweaks immediately
        this.isLoudnessMatched = false;
        this.loudnessMatchGainLinear = 1.0;

        this.loopEnabled = false;
        this.loopStartSec = 0;
        this.loopEndSec = 0;

        this.startTime = 0;
        this.pauseOffset = 0;

        this.source = null;
        this.chain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.fadeEnvelope = null;

        this.analyserPre = null;
        this.analyserPost = null;
        this.analyserL = null;
        this.analyserR = null;

        this.onPlaybackEnded = null;
    }

    initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
            this._setupAnalysersAndGraph();
        }
        return this.ctx;
    }

    async ensureRunning() {
        this.initContext();
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    _setupAnalysersAndGraph() {
        const ctx = this.ctx;
        this.chain = buildMasteringChain(ctx, 2);

        this.dryGain = ctx.createGain();
        this.wetGain = ctx.createGain();
        this.fadeEnvelope = ctx.createGain();

        this.analyserPre = ctx.createAnalyser();
        this.analyserPre.fftSize = 2048;
        this.analyserPre.smoothingTimeConstant = 0.8;

        this.analyserPost = ctx.createAnalyser();
        this.analyserPost.fftSize = 2048;
        this.analyserPost.smoothingTimeConstant = 0.78;

        const meterSplitter = ctx.createChannelSplitter(2);
        this.analyserL = ctx.createAnalyser();
        this.analyserL.fftSize = 1024;
        this.analyserR = ctx.createAnalyser();
        this.analyserR.fftSize = 1024;

        this.chain.output.connect(this.wetGain);
        this.dryGain.connect(this.fadeEnvelope);
        this.wetGain.connect(this.fadeEnvelope);

        this.fadeEnvelope.connect(this.analyserPost);
        this.analyserPost.connect(meterSplitter);
        meterSplitter.connect(this.analyserL, 0);
        meterSplitter.connect(this.analyserR, 1);
        this.analyserPost.connect(ctx.destination);

        this._updateABGains(false);
        this.chain.applySettings(this.settings, ctx.currentTime, false);
    }

    setBuffer(audioBuffer) {
        this.stop(false);
        this.buffer = audioBuffer;
        this.pauseOffset = 0;
        this.loopStartSec = 0;
        this.loopEndSec = audioBuffer ? audioBuffer.duration : 0;
        if (this.ctx) {
            this.chain.output.disconnect();
            this.chain = buildMasteringChain(this.ctx, audioBuffer ? audioBuffer.numberOfChannels : 2);
            this.chain.output.connect(this.wetGain);
            this.chain.applySettings(this.settings, this.ctx.currentTime, false);
        }
    }

    updateSettings(newSettings, smooth = true) {
        const prevTrimStart = this.settings.trimStartSec;
        const prevTrimEnd = this.settings.trimEndSec;
        const prevFadeIn = this.settings.fadeInSec;
        const prevFadeOut = this.settings.fadeOutSec;

        this.settings = { ...this.settings, ...newSettings };
        if (this.ctx && this.chain) {
            this.chain.applySettings(this.settings, this.ctx.currentTime, smooth);
            this._recalculateLoudnessMatchCompensation();
            this._updateABGains(true);

            // If playing and trim/fade changed, update live fade envelope
            if (this.isPlaying && this.buffer && (
                this.settings.trimStartSec !== prevTrimStart ||
                this.settings.trimEndSec !== prevTrimEnd ||
                this.settings.fadeInSec !== prevFadeIn ||
                this.settings.fadeOutSec !== prevFadeOut
            )) {
                const curPos = this.getCurrentTime();
                scheduleTrimAndFades(
                    this.fadeEnvelope.gain,
                    this.settings,
                    this.buffer.duration,
                    curPos,
                    this.ctx.currentTime
                );
            }
        }
    }

    _recalculateLoudnessMatchCompensation() {
        const s = this.settings;
        let estGainDb = 0;
        if (!s.bypassDynamics) {
            estGainDb += Number(s.masterGain) || 0;
            const thresh = Number(s.compThreshold) || -20;
            const ratio = Math.max(1, Number(s.compRatio) || 1);
            if (thresh < -14) {
                const over = -14 - thresh;
                estGainDb -= over * (1 - 1 / ratio) * 0.45;
            }
        }
        if (!s.bypassEq) {
            estGainDb += (Number(s.eq1Gain) * 0.25) + (Number(s.eq2Gain) * 0.3) +
                         (Number(s.eq3Gain) * 0.35) + (Number(s.eq4Gain) * 0.25) + (Number(s.eq5Gain) * 0.15);
        }
        if (!s.bypassAiRestore) {
            estGainDb += (Number(s.warmthDrive) / 100) * 1.8;
        }
        const clampedDb = Math.max(-12, Math.min(12, estGainDb));
        this.loudnessMatchGainLinear = Math.pow(10, clampedDb / 20);
    }

    setABMode(isRemastered) {
        this.isRemasteredActive = Boolean(isRemastered);
        this._updateABGains(true);
    }

    setLoudnessMatched(enabled) {
        this.isLoudnessMatched = Boolean(enabled);
        this._recalculateLoudnessMatchCompensation();
        this._updateABGains(true);
    }

    _updateABGains(smooth = true) {
        if (!this.ctx || !this.dryGain || !this.wetGain) return;
        const now = this.ctx.currentTime;
        const dryTarget = this.isRemasteredActive
            ? 0
            : (this.isLoudnessMatched ? this.loudnessMatchGainLinear : 1.0);
        const wetTarget = this.isRemasteredActive ? 1.0 : 0;

        if (smooth && now > 0) {
            this.dryGain.gain.setTargetAtTime(dryTarget, now, 0.012);
            this.wetGain.gain.setTargetAtTime(wetTarget, now, 0.012);
        } else {
            this.dryGain.gain.setValueAtTime(dryTarget, now);
            this.wetGain.gain.setValueAtTime(wetTarget, now);
        }
    }

    setLoop(enabled, startSec = this.loopStartSec, endSec = this.loopEndSec) {
        this.loopEnabled = Boolean(enabled);
        if (this.buffer) {
            this.loopStartSec = Math.max(0, Math.min(this.buffer.duration - 0.1, startSec));
            this.loopEndSec = Math.max(this.loopStartSec + 0.1, Math.min(this.buffer.duration, endSec));
        }
        if (this.source && this.isPlaying) {
            this.source.loop = this.loopEnabled;
            this.source.loopStart = this.loopStartSec;
            this.source.loopEnd = this.loopEndSec;
        }
    }

    async play() {
        if (!this.buffer) return;
        this.isPlaying = true;
        try {
            await this.ensureRunning();
        } catch (err) {
            this.isPlaying = false;
            if (typeof this.onPlaybackEnded === 'function') {
                this.onPlaybackEnded();
            }
            throw err;
        }
        if (!this.isPlaying) return;

        this._stopSourceOnly();

        const trimStart = Math.max(0, Number(this.settings.trimStartSec) || 0);
        const rawTrimEnd = Number(this.settings.trimEndSec);
        const trimEnd = (rawTrimEnd > trimStart && rawTrimEnd <= this.buffer.duration)
            ? rawTrimEnd
            : this.buffer.duration;

        if (this.pauseOffset < trimStart || this.pauseOffset >= trimEnd - 0.05) {
            this.pauseOffset = trimStart;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;

        if (this.loopEnabled && this.loopEndSec > this.loopStartSec + 0.1) {
            source.loop = true;
            source.loopStart = this.loopStartSec;
            source.loopEnd = this.loopEndSec;
        }

        source.connect(this.analyserPre);
        source.connect(this.dryGain);
        source.connect(this.chain.input);

        const now = this.ctx.currentTime;
        this.chain.applySettings(this.settings, now, false);
        this._recalculateLoudnessMatchCompensation();
        this._updateABGains(false);

        scheduleTrimAndFades(
            this.fadeEnvelope.gain,
            this.settings,
            this.buffer.duration,
            this.pauseOffset,
            now
        );

        source.onended = () => {
            if (this.isPlaying && this.source === source) {
                this.isPlaying = false;
                this.pauseOffset = Number(this.settings.trimStartSec) || 0;
                if (typeof this.onPlaybackEnded === 'function') {
                    this.onPlaybackEnded();
                }
            }
        };

        const remainingDuration = Math.max(0.05, trimEnd - this.pauseOffset);
        if (source.loop) {
            source.start(0, this.pauseOffset);
        } else {
            source.start(0, this.pauseOffset, remainingDuration);
        }

        this.source = source;
        this.startTime = now;
        this.isPlaying = true;
    }

    pause() {
        if (!this.isPlaying) return;
        this.pauseOffset = this.getCurrentTime();
        this._stopSourceOnly();
        this.isPlaying = false;
    }

    stop(preserveOffset = false) {
        if (this.isPlaying && preserveOffset) {
            this.pauseOffset = this.getCurrentTime();
        }
        this._stopSourceOnly();
        this.isPlaying = false;
        if (!preserveOffset) {
            this.pauseOffset = Number(this.settings.trimStartSec) || 0;
        }
    }

    seek(timeSec) {
        if (!this.buffer) return;
        const clamped = Math.max(0, Math.min(this.buffer.duration, timeSec));
        this.pauseOffset = clamped;
        if (this.isPlaying) {
            this.play();
        }
    }

    getCurrentTime() {
        if (!this.buffer) return 0;
        if (!this.isPlaying || !this.ctx) {
            return this.pauseOffset;
        }
        const elapsed = this.ctx.currentTime - this.startTime;
        let current = this.pauseOffset + elapsed;
        if (this.loopEnabled && this.loopEndSec > this.loopStartSec + 0.1) {
            const loopLen = this.loopEndSec - this.loopStartSec;
            if (current >= this.loopEndSec) {
                current = this.loopStartSec + ((current - this.loopStartSec) % loopLen);
            }
        }
        return Math.min(this.buffer.duration, current);
    }

    _stopSourceOnly() {
        if (this.source) {
            this.source.onended = null;
            try {
                this.source.stop();
            } catch (_) {
                // Ignore
            }
            try {
                this.source.disconnect();
            } catch (_) {
                // Ignore
            }
            this.source = null;
        }
    }
}
