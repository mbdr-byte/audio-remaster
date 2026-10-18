/**
 * ==========================================================================
 * Audio Remastering Lab - Main Application Controller
 *
 * View 1 (Default): Classic View (Simple) — The exact original 4-step page:
 *   1. Load Audio File (+ Original Audio Metrics & Suggestions)
 *   2. Preview & A/B Test (A/B Switch, Play/Pause, Progress Bar, Spectrum Analyzer)
 *   3. Remastering Console (3 Columns / 10 Sliders + Auto-Updated Remastered Audio Metrics)
 *   4. Export Master (Download Remastered WAV)
 *
 * View 2: Studio Pro View (Complex) — Full Studio Mastering Console:
 *   - 6-Band Interactive Parametric EQ & Real-Time Pre/Post RTA
 *   - AI Restoration & Analog Glue (Shimmer Tamer, De-Mud, Tape/Tube/Warm, Air Exciter)
 *   - Bus Compressor & Brickwall Limiter
 *   - True Mid/Side Stereo Imaging & Studio Space
 *   - Track Trim & Fade Envelopes
 *   - Pro Meter Bridge, Stereo Vectorscope, & Auto-Synced Before / After Audit
 * ==========================================================================
 */

import {
    EQ_BAND_DEFS,
    DEFAULT_SETTINGS,
    BUILTIN_PRESETS,
    loadUserPresets,
    saveUserPreset,
    deleteUserPreset
} from './presets.js';

import {
    LiveAudioEngine,
    renderOfflineMaster
} from './audio-engine.js';

import {
    analyzeAudioBuffer,
    computeSmartAutoMaster,
    encodeBufferToWavBlob
} from './analyzer.js';

import {
    WaveformVisualizer,
    EQSpectrumVisualizer,
    MeterBridgeVisualizer
} from './visualizers.js';

import {
    formatTime,
    formatDb,
    mountSliderGroup,
    initFloatingTooltips,
    createDemoAudioBuffer
} from './ui-components.js';

function trackGAEvent(eventName, eventParams = {}) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, eventParams);
    }
}

function formatClassicTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
}

class RemasterStudioApp {
    constructor() {
        this.engine = new LiveAudioEngine();
        this.settings = { ...DEFAULT_SETTINGS };
        this.controlRegistry = new Map(); // key -> Array of slider control instances

        this.viewMode = 'classic'; // Default to 'classic' (Original Simple View)
        this.selectedEqBand = 2; // Band 3 (Low-Mid De-Mud)
        this.loadedFileName = '';
        this.originalMetrics = null;
        this.remasteredMetrics = null;
        this.exportBitDepth = 24;

        this.auditDebounceTimer = null;
        this.auditRequestId = 0;

        this.waveformVis = null;
        this.eqSpectrumVis = null;
        this.meterBridgeVis = null;
        this.animFrameId = null;

        this.engine.onPlaybackEnded = () => {
            this._syncPlayPauseUI();
            this._drawClassicPlaceholderSpectrum();
        };
    }

    init() {
        const yearEl = document.getElementById('currentYear');
        if (yearEl) yearEl.textContent = new Date().getFullYear();

        initFloatingTooltips();
        this._cacheDom();
        this._buildReusableControls();
        this._initVisualizers();
        this._populatePresetDropdown();
        this._bindEvents();
        this._bindKeyboardShortcuts();
        this._setControlsEnabled(false);
        this._syncContextualGreyOutStates();
        this._drawClassicPlaceholderSpectrum();
        window.addEventListener('resize', () => {
            if (this.viewMode === 'classic' && !this.engine.isPlaying) {
                this._drawClassicPlaceholderSpectrum();
            }
        });
        this._startRenderLoop();
        this._maybeShowWelcomeNote();

        trackGAEvent('page_view', {
            page_title: document.title,
            page_location: window.location.href
        });
    }

    _cacheDom() {
        this.dom = {
            // Top View Switcher
            viewClassicBtn: document.getElementById('viewClassicBtn'),
            viewProBtn: document.getElementById('viewProBtn'),
            classicViewPage: document.getElementById('classicViewPage'),
            proViewPage: document.getElementById('proViewPage'),

            // Classic View Elements (Original 4-Step Page)
            classicAudioFile: document.getElementById('classicAudioFile'),
            classicAudioFileButton: document.getElementById('classicAudioFileButton'),
            classicLoadDemoBtn: document.getElementById('classicLoadDemoBtn'),
            classicFileName: document.getElementById('classicFileName'),
            originalAnalysisDisplayWrapper: document.getElementById('originalAnalysisDisplayWrapper'),

            previewABSection: document.getElementById('previewABSection'),
            abToggleSwitch: document.getElementById('abToggleSwitch'),
            labelOriginal: document.getElementById('labelOriginal'),
            labelRemastered: document.getElementById('labelRemastered'),
            classicPlayPauseBtn: document.getElementById('classicPlayPauseBtn'),
            currentTimeDisplay: document.getElementById('currentTimeDisplay'),
            unifiedProgressContainer: document.getElementById('unifiedProgressContainer'),
            unifiedProgressBar: document.getElementById('unifiedProgressBar'),
            unifiedFftCanvas: document.getElementById('unifiedFftCanvas'),

            controlsSection: document.getElementById('controlsSection'),
            classicOrigNotice: document.getElementById('classicOrigNotice'),
            classicSwitchToRemasterBtn: document.getElementById('classicSwitchToRemasterBtn'),
            classicSlidersGrid: document.getElementById('classicSlidersGrid'),
            classicEqSliders: document.getElementById('classicEqSliders'),
            classicDynamicsSliders: document.getElementById('classicDynamicsSliders'),
            classicToneSpaceSliders: document.getElementById('classicToneSpaceSliders'),
            classicAutoMasterBtn: document.getElementById('classicAutoMasterBtn'),
            classicResetControlsBtn: document.getElementById('classicResetControlsBtn'),
            remasteredAnalysisDisplayWrapper: document.getElementById('remasteredAnalysisDisplayWrapper'),

            downloadSection: document.getElementById('downloadSection'),
            classicDownloadBtn: document.getElementById('classicDownloadBtn'),

            // Studio Pro View Elements
            dropzone: document.getElementById('fileDropzone'),
            fileInput: document.getElementById('audioFileInput'),
            loadDemoBtn: document.getElementById('loadDemoBtn'),
            fileMetaText: document.getElementById('fileMetaText'),

            consoleMainRack: document.getElementById('consoleMainRack'),
            rackStatusNotice: document.getElementById('rackStatusNotice'),
            rackStatusNoticeText: document.getElementById('rackStatusNoticeText'),
            switchToRemasterNoticeBtn: document.getElementById('switchToRemasterNoticeBtn'),

            presetSelect: document.getElementById('presetSelect'),
            autoMasterBtn: document.getElementById('smartAutoMasterBtn'),
            savePresetBtn: document.getElementById('savePresetBtn'),
            deletePresetBtn: document.getElementById('deletePresetBtn'),
            exportPresetJsonBtn: document.getElementById('exportPresetJsonBtn'),
            importPresetJsonBtn: document.getElementById('importPresetJsonBtn'),
            importPresetInput: document.getElementById('importPresetInput'),
            resetAllBtn: document.getElementById('resetAllBtn'),

            diagnosticBanner: document.getElementById('diagnosticBanner'),
            diagnosticList: document.getElementById('diagnosticList'),
            closeDiagnosticBtn: document.getElementById('closeDiagnosticBtn'),

            playPauseBtn: document.getElementById('playPauseBtn'),
            stopBtn: document.getElementById('stopBtn'),
            timeReadout: document.getElementById('timeReadout'),
            loopToggleBtn: document.getElementById('loopToggleBtn'),
            abOrigBtn: document.getElementById('abOrigBtn'),
            abRemasterBtn: document.getElementById('abRemasterBtn'),
            loudnessMatchBtn: document.getElementById('loudnessMatchBtn'),

            waveformCanvas: document.getElementById('waveformCanvas'),
            eqSpectrumCanvas: document.getElementById('eqSpectrumCanvas'),
            vectorscopeCanvas: document.getElementById('vectorscopeCanvas'),

            eqBandTabsContainer: document.getElementById('eqBandTabs'),
            eqSelectedBandSliders: document.getElementById('eqSelectedBandSliders'),
            aiRestoreSliders: document.getElementById('aiRestoreSliders'),
            dynamicsSliders: document.getElementById('dynamicsSliders'),
            stereoSpaceSliders: document.getElementById('stereoSpaceSliders'),
            trimFadeSliders: document.getElementById('trimFadeSliders'),

            satModeButtons: document.querySelectorAll('[data-sat-mode]'),
            bitDepthButtons: document.querySelectorAll('[data-bit-depth]'),

            bypassButtons: {
                bypassEq: document.getElementById('bypassEqBtn'),
                bypassAiRestore: document.getElementById('bypassAiRestoreBtn'),
                bypassDynamics: document.getElementById('bypassDynamicsBtn'),
                bypassStereoSpace: document.getElementById('bypassStereoSpaceBtn')
            },
            modulePanels: {
                bypassEq: document.getElementById('panelEq'),
                bypassAiRestore: document.getElementById('panelAiRestore'),
                bypassDynamics: document.getElementById('panelDynamics'),
                bypassStereoSpace: document.getElementById('panelStereoSpace')
            },

            // Live Meter Readouts
            statLufsLive: document.getElementById('statLufsLive'),
            statPeakLive: document.getElementById('statPeakLive'),
            statGrLive: document.getElementById('statGrLive'),
            statPhaseLive: document.getElementById('statPhaseLive'),
            meterFillL: document.getElementById('meterFillL'),
            meterFillR: document.getElementById('meterFillR'),
            meterFillGr: document.getElementById('meterFillGr'),
            meterTextL: document.getElementById('meterTextL'),
            meterTextR: document.getElementById('meterTextR'),
            meterTextGr: document.getElementById('meterTextGr'),
            phaseIndicator: document.getElementById('phaseIndicator'),

            // Before / After Audit & Export
            auditStatusBadge: document.getElementById('auditStatusBadge'),
            metricsComparisonBody: document.getElementById('metricsComparisonBody'),
            exportFilenameInput: document.getElementById('exportFilenameInput'),
            downloadMasterBtn: document.getElementById('downloadMasterBtn')
        };
    }

    _handleParameterEdit(key, val) {
        this.settings[key] = val;
        this.engine.updateSettings({ [key]: val }, true);

        // Keep all slider instances sharing this key (Classic + Pro) synchronized
        this._syncControlValuesFromSettings();

        if (key.startsWith('eq')) {
            this._renderEqBandTabs();
        }

        this._syncContextualGreyOutStates();
        this._scheduleAutoAudit();
    }

    _buildReusableControls() {
        const onParamChange = (key, val) => this._handleParameterEdit(key, val);

        // ==================================================================
        // CLASSIC VIEW CONTROLS (Exact Original 10 Sliders in 3 Columns)
        // ==================================================================
        mountSliderGroup(this.dom.classicEqSliders, [
            {
                key: 'eq1Gain',
                label: 'Bass (Low Shelf)',
                min: -15, max: 15, step: 0.1,
                value: this.settings.eq1Gain,
                defaultValue: DEFAULT_SETTINGS.eq1Gain,
                unit: 'dB',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'Controls low frequencies (e.g., kick drums, bass guitars). Positive values boost, negative values cut.'
            },
            {
                key: 'eq3Gain',
                label: 'Mids (Peaking)',
                min: -15, max: 15, step: 0.1,
                value: this.settings.eq3Gain,
                defaultValue: DEFAULT_SETTINGS.eq3Gain,
                unit: 'dB',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'Controls mid-range frequencies (e.g., vocals, main body of instruments). Positive values boost, negative values cut.'
            },
            {
                key: 'eq5Gain',
                label: 'Treble (High Shelf)',
                min: -15, max: 15, step: 0.1,
                value: this.settings.eq5Gain,
                defaultValue: DEFAULT_SETTINGS.eq5Gain,
                unit: 'dB',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'Controls high frequencies (e.g., cymbals, hi-hats, airiness). Positive values boost, negative values cut.'
            }
        ], this.controlRegistry, onParamChange, 'classic');

        mountSliderGroup(this.dom.classicDynamicsSliders, [
            {
                key: 'compThreshold',
                label: 'Compressor Threshold',
                min: -60, max: 0, step: 1,
                value: this.settings.compThreshold,
                defaultValue: DEFAULT_SETTINGS.compThreshold,
                unit: 'dB',
                formatValue: (v) => Math.round(v),
                tooltip: 'The level at which the compressor starts to reduce volume. Sounds louder than this threshold will be compressed.'
            },
            {
                key: 'compRatio',
                label: 'Compressor Ratio',
                min: 1, max: 20, step: 0.5,
                value: this.settings.compRatio,
                defaultValue: DEFAULT_SETTINGS.compRatio,
                unit: ':1',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'How much volume is reduced above the threshold. E.g., 4:1 means if input is 4dB over, output is 1dB over.'
            },
            {
                key: 'limiterThreshold',
                label: 'Limiter Threshold',
                min: -20, max: -0.1, step: 0.1,
                value: this.settings.limiterThreshold,
                defaultValue: DEFAULT_SETTINGS.limiterThreshold,
                unit: 'dBFS',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'The absolute maximum level. Sounds attempting to exceed this will be sharply attenuated to prevent clipping.'
            },
            {
                key: 'masterGain',
                label: 'Master Gain',
                min: -12, max: 12, step: 0.1,
                value: this.settings.masterGain,
                defaultValue: DEFAULT_SETTINGS.masterGain,
                unit: 'dB',
                formatValue: (v) => Number(v).toFixed(1).replace(/\.0$/, ''),
                tooltip: 'Adjusts the final output volume of the entire processed audio after other effects.'
            }
        ], this.controlRegistry, onParamChange, 'classic');

        mountSliderGroup(this.dom.classicToneSpaceSliders, [
            {
                key: 'stereoWidth',
                label: 'Stereo Spread',
                min: 0, max: 200, step: 1,
                value: this.settings.stereoWidth,
                defaultValue: DEFAULT_SETTINGS.stereoWidth,
                unit: '%',
                tooltip: 'Controls stereo width (100% is original stereo image, >100% widens the stereo field, <100% narrows toward mono). Note: Only works on stereo files.'
            },
            {
                key: 'reverbMix',
                label: 'Reverb Mix',
                min: 0, max: 30, step: 1,
                value: this.settings.reverbMix,
                defaultValue: DEFAULT_SETTINGS.reverbMix,
                unit: '%',
                formatValue: (v) => Math.round(v),
                tooltip: 'Controls the amount of algorithmic reverb (0-30%). Adds a sense of space to the audio.'
            },
            {
                key: 'warmthDrive',
                label: 'Warmth',
                min: 0, max: 100, step: 1,
                value: this.settings.warmthDrive,
                defaultValue: DEFAULT_SETTINGS.warmthDrive,
                unit: '%',
                tooltip: 'Mixes in harmonic saturation for an analog-like warmth and character.'
            }
        ], this.controlRegistry, onParamChange, 'classic');

        // ==================================================================
        // STUDIO PRO VIEW CONTROLS
        // ==================================================================
        this._renderEqBandTabs();
        this._mountSelectedEqBandSliders();

        mountSliderGroup(this.dom.aiRestoreSliders, [
            {
                key: 'harshTamerAmount',
                label: 'AI Shimmer / Harshness Tamer',
                min: 0, max: 100, step: 1,
                value: this.settings.harshTamerAmount,
                defaultValue: DEFAULT_SETTINGS.harshTamerAmount,
                unit: '%',
                tooltip: 'Suppresses metallic 3-8 kHz fizz and harsh vocal sibilance common in Suno/Udio tracks.'
            },
            {
                key: 'harshTamerFreq',
                label: 'Harshness Target Freq',
                min: 3000, max: 8000, step: 50,
                value: this.settings.harshTamerFreq,
                defaultValue: DEFAULT_SETTINGS.harshTamerFreq,
                unit: 'Hz',
                tooltip: 'Center frequency for the AI shimmer suppressor (active when Harshness Tamer > 0%).'
            },
            {
                key: 'mudCleanerAmount',
                label: 'Low-Mid De-Mud & Sub Tightener',
                min: 0, max: 100, step: 1,
                value: this.settings.mudCleanerAmount,
                defaultValue: DEFAULT_SETTINGS.mudCleanerAmount,
                unit: '%',
                tooltip: 'Attenuates boxy 265 Hz buildup and tightens sub-45 Hz rumble.'
            },
            {
                key: 'warmthDrive',
                label: 'Analog Saturation Drive',
                min: 0, max: 100, step: 1,
                value: this.settings.warmthDrive,
                defaultValue: DEFAULT_SETTINGS.warmthDrive,
                unit: '%',
                tooltip: '4x oversampled harmonic saturation (choose Tape, Tube, or Warm above) to add analog body and glue.'
            },
            {
                key: 'airExciter',
                label: 'High-Freq Harmonic Air Exciter',
                min: 0, max: 100, step: 1,
                value: this.settings.airExciter,
                defaultValue: DEFAULT_SETTINGS.airExciter,
                unit: '%',
                tooltip: 'Synthesizes musical upper harmonics above 6.5 kHz to restore clarity to dull AI renders.'
            }
        ], this.controlRegistry, onParamChange, 'pro');

        mountSliderGroup(this.dom.dynamicsSliders, [
            {
                key: 'compThreshold',
                label: 'Compressor Threshold',
                min: -50, max: 0, step: 0.5,
                value: this.settings.compThreshold,
                defaultValue: DEFAULT_SETTINGS.compThreshold,
                unit: 'dB',
                tooltip: 'Level above which the bus compressor begins attenuating peaks.'
            },
            {
                key: 'compRatio',
                label: 'Compressor Ratio',
                min: 1, max: 16, step: 0.2,
                value: this.settings.compRatio,
                defaultValue: DEFAULT_SETTINGS.compRatio,
                unit: ':1',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Compression ratio (2:1 to 4:1 is ideal for mastering glue).'
            },
            {
                key: 'compAttack',
                label: 'Attack Time',
                min: 1, max: 120, step: 1,
                value: this.settings.compAttack,
                defaultValue: DEFAULT_SETTINGS.compAttack,
                unit: 'ms',
                tooltip: 'Slower attack (15-30 ms) lets drum transients punch through before compression.'
            },
            {
                key: 'compRelease',
                label: 'Release Time',
                min: 20, max: 600, step: 10,
                value: this.settings.compRelease,
                defaultValue: DEFAULT_SETTINGS.compRelease,
                unit: 'ms',
                tooltip: 'How quickly the compressor recovers after peaks drop below threshold.'
            },
            {
                key: 'masterGain',
                label: 'Master Makeup Gain',
                min: -12, max: 12, step: 0.1,
                value: this.settings.masterGain,
                defaultValue: DEFAULT_SETTINGS.masterGain,
                unit: 'dB',
                formatValue: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
                tooltip: 'Pushes overall loudness into the final Brickwall Limiter.'
            },
            {
                key: 'limiterThreshold',
                label: 'Brickwall Limiter Ceiling',
                min: -10, max: -0.1, step: 0.1,
                value: this.settings.limiterThreshold,
                defaultValue: DEFAULT_SETTINGS.limiterThreshold,
                unit: 'dBFS',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Absolute maximum output ceiling (-0.8 to -1.0 dBFS recommended for streaming).'
            }
        ], this.controlRegistry, onParamChange, 'pro');

        mountSliderGroup(this.dom.stereoSpaceSliders, [
            {
                key: 'stereoWidth',
                label: 'True Mid/Side Stereo Width',
                min: 0, max: 200, step: 1,
                value: this.settings.stereoWidth,
                defaultValue: DEFAULT_SETTINGS.stereoWidth,
                unit: '%',
                tooltip: 'Phase-coherent Mid/Side stereo imaging: 0% = Mono, 100% = Original, >100% = Expanded Side channel.'
            },
            {
                key: 'bassMonoFreq',
                label: 'Bass Mono Crossover',
                min: 20, max: 300, step: 5,
                value: this.settings.bassMonoFreq,
                defaultValue: DEFAULT_SETTINGS.bassMonoFreq,
                unit: 'Hz',
                tooltip: 'High-passes the Side channel so all sub-bass below this frequency stays 100% centered and punchy.'
            },
            {
                key: 'sideAirBoost',
                label: 'Side-Channel Air Boost',
                min: 0, max: 6, step: 0.2,
                value: this.settings.sideAirBoost,
                defaultValue: DEFAULT_SETTINGS.sideAirBoost,
                unit: 'dB',
                formatValue: (v) => `+${v.toFixed(1)}`,
                tooltip: 'Boosts high frequencies (>6.5 kHz) on the stereo edges only for 3D width without harsh center vocals.'
            },
            {
                key: 'reverbMix',
                label: 'Studio Room Ambience Mix',
                min: 0, max: 30, step: 0.5,
                value: this.settings.reverbMix,
                defaultValue: DEFAULT_SETTINGS.reverbMix,
                unit: '%',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Blends subtle multi-tap stereo room diffusion to glue dry tracks.'
            },
            {
                key: 'reverbDecay',
                label: 'Ambience Decay Time',
                min: 10, max: 90, step: 1,
                value: this.settings.reverbDecay,
                defaultValue: DEFAULT_SETTINGS.reverbDecay,
                unit: '%',
                tooltip: 'Controls the tail length of the stereo room reverb (active when Room Ambience Mix > 0%).'
            },
            {
                key: 'reverbDamping',
                label: 'Reverb HF Damping',
                min: 1200, max: 10000, step: 100,
                value: this.settings.reverbDamping,
                defaultValue: DEFAULT_SETTINGS.reverbDamping,
                unit: 'Hz',
                tooltip: 'Rolls off high frequencies in the reverb tail for a warmer, natural space (active when Room Ambience Mix > 0%).'
            }
        ], this.controlRegistry, onParamChange, 'pro');

        mountSliderGroup(this.dom.trimFadeSliders, [
            {
                key: 'trimStartSec',
                label: 'Trim Start',
                min: 0, max: 60, step: 0.1,
                value: this.settings.trimStartSec,
                defaultValue: 0,
                unit: 's',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Cuts dead air or unwanted intro before this timestamp.'
            },
            {
                key: 'trimEndSec',
                label: 'Trim End',
                min: 0.5, max: 300, step: 0.1,
                value: this.settings.trimEndSec,
                defaultValue: 0,
                unit: 's',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Cuts abrupt endings or trailing silence after this timestamp.'
            },
            {
                key: 'fadeInSec',
                label: 'Fade-In Duration',
                min: 0, max: 10, step: 0.1,
                value: this.settings.fadeInSec,
                defaultValue: 0,
                unit: 's',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Smooth linear volume fade-in from Trim Start.'
            },
            {
                key: 'fadeOutSec',
                label: 'Fade-Out Duration',
                min: 0, max: 15, step: 0.1,
                value: this.settings.fadeOutSec,
                defaultValue: 0,
                unit: 's',
                formatValue: (v) => v.toFixed(1),
                tooltip: 'Smooth fade-out ending at Trim End (great for fixing abrupt Suno/Udio cutoffs).'
            }
        ], this.controlRegistry, onParamChange, 'pro');
    }

    _renderEqBandTabs() {
        const container = this.dom.eqBandTabsContainer;
        if (!container) return;
        container.innerHTML = '';

        EQ_BAND_DEFS.forEach((def, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `eq-band-tab ${idx === this.selectedEqBand ? 'is-active' : ''}`;
            const freq = Math.round(Number(this.settings[`eq${idx}Freq`]) || def.defaultFreq);
            const gain = Number(this.settings[`eq${idx}Gain`]) || 0;
            const freqStr = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${freq}Hz`;
            const gainStr = def.hasGain ? `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}dB` : '12dB/oct';

            btn.innerHTML = `
                <div class="eq-band-tab-title">
                    <span>${def.shortName}</span>
                    <span style="width:8px;height:8px;border-radius:50%;background:${def.color};display:inline-block;"></span>
                </div>
                <div class="eq-band-tab-sub">${freqStr} • ${gainStr}</div>
            `;

            btn.addEventListener('click', () => {
                this.selectedEqBand = idx;
                if (this.eqSpectrumVis) {
                    this.eqSpectrumVis.selectedBand = idx;
                }
                this._renderEqBandTabs();
                this._mountSelectedEqBandSliders();
            });

            container.appendChild(btn);
        });
    }

    _mountSelectedEqBandSliders() {
        const idx = this.selectedEqBand;
        const def = EQ_BAND_DEFS[idx];

        ['Freq', 'Gain', 'Q'].forEach(suffix => {
            const k = `eq${idx}${suffix}`;
            const existing = this.controlRegistry.get(k) || [];
            this.controlRegistry.set(k, existing.filter(c => !this.dom.eqSelectedBandSliders.contains(c.element)));
        });

        const sliderDefs = [
            {
                key: `eq${idx}Freq`,
                label: `${def.shortName} Frequency`,
                min: def.minFreq,
                max: def.maxFreq,
                step: def.maxFreq > 2000 ? 10 : 1,
                value: this.settings[`eq${idx}Freq`],
                defaultValue: def.defaultFreq,
                unit: 'Hz',
                formatValue: (v) => Math.round(v),
                tooltip: def.tooltip
            },
            {
                key: `eq${idx}Gain`,
                label: `${def.shortName} Gain`,
                min: def.hasGain ? -15 : 0,
                max: def.hasGain ? 15 : 0,
                step: 0.1,
                value: def.hasGain ? this.settings[`eq${idx}Gain`] : 0,
                defaultValue: def.defaultGain,
                unit: 'dB',
                formatValue: (v) => (def.hasGain ? (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)) : 'Cut Only'),
                tooltip: def.hasGain ? 'Boost or cut this frequency band (-15 to +15 dB).' : 'High-Pass Filter cuts frequencies below the cutoff.'
            },
            {
                key: `eq${idx}Q`,
                label: `${def.shortName} Q (Bandwidth)`,
                min: def.minQ,
                max: def.maxQ,
                step: 0.05,
                value: this.settings[`eq${idx}Q`],
                defaultValue: def.defaultQ,
                unit: '',
                formatValue: (v) => v.toFixed(2),
                tooltip: 'Higher Q narrows the bandwidth for surgical cuts; lower Q creates broad musical shaping.'
            }
        ];

        mountSliderGroup(
            this.dom.eqSelectedBandSliders,
            sliderDefs,
            this.controlRegistry,
            (key, val) => this._handleParameterEdit(key, val),
            'pro-eq'
        );

        if (!def.hasGain) {
            const gainCtrls = this.controlRegistry.get(`eq${idx}Gain`) || [];
            gainCtrls.forEach(ctrl => ctrl.setDisabled(true));
        }
    }

    /**
     * Synchronizes grey-out states across both Classic View and Studio Pro View
     * so users never wonder why a control doesn't affect the currently playing audio.
     */
    _syncContextualGreyOutStates() {
        const hasTrack = Boolean(this.engine.buffer);
        const isListeningOriginal = hasTrack && !this.engine.isRemasteredActive;

        // Classic View: dim Section 3 sliders and show notice when listening to ORIGINAL (A)
        if (this.dom.classicOrigNotice && this.dom.classicSlidersGrid) {
            this.dom.classicOrigNotice.classList.toggle('hidden', !isListeningOriginal);
            this.dom.classicSlidersGrid.classList.toggle('classic-console-dimmed', isListeningOriginal);
        }

        // Studio Pro View: dim rack when no track loaded or listening to Original (A)
        const rackInactive = !hasTrack || isListeningOriginal;
        this.dom.consoleMainRack.classList.toggle('rack-Inactive-state', rackInactive);

        if (!hasTrack) {
            this.dom.rackStatusNotice.classList.remove('hidden');
            this.dom.rackStatusNoticeText.textContent = 'Load an audio track above (or click "Load Test Groove") to unlock the mastering controls.';
            this.dom.switchToRemasterNoticeBtn.classList.add('hidden');
        } else if (isListeningOriginal) {
            this.dom.rackStatusNotice.classList.remove('hidden');
            this.dom.rackStatusNoticeText.textContent = 'Listening to Unprocessed Original (A) — Mastering controls are paused so you know you are hearing raw audio.';
            this.dom.switchToRemasterNoticeBtn.classList.remove('hidden');
        } else {
            this.dom.rackStatusNotice.classList.add('hidden');
        }

        // Dependent sub-controls: grey out secondary sliders when their parent amount is 0
        const harshOff = Number(this.settings.harshTamerAmount) <= 0;
        (this.controlRegistry.get('harshTamerFreq') || []).forEach(c => c.setDisabled(harshOff));

        const reverbOff = Number(this.settings.reverbMix) <= 0;
        (this.controlRegistry.get('reverbDecay') || []).forEach(c => c.setDisabled(reverbOff));
        (this.controlRegistry.get('reverbDamping') || []).forEach(c => c.setDisabled(reverbOff));

        const compOff = Number(this.settings.compRatio) <= 1.01;
        (this.controlRegistry.get('compAttack') || []).forEach(c => c.setDisabled(compOff));
        (this.controlRegistry.get('compRelease') || []).forEach(c => c.setDisabled(compOff));

        // Mono track check for Stereo Width / Bass Mono / Side Air
        const isMono = hasTrack && this.engine.buffer.numberOfChannels < 2;
        ['stereoWidth', 'bassMonoFreq', 'sideAirBoost'].forEach(k => {
            (this.controlRegistry.get(k) || []).forEach(c => c.setDisabled(isMono));
        });
    }

    /**
     * Switches between the full Original Classic View page and the full Studio Pro View page.
     */
    setViewMode(mode) {
        this.viewMode = mode === 'pro' ? 'pro' : 'classic';
        const isPro = this.viewMode === 'pro';

        document.body.classList.toggle('is-pro-mode', isPro);
        this.dom.viewClassicBtn.classList.toggle('is-active', !isPro);
        this.dom.viewProBtn.classList.toggle('is-active', isPro);

        this.dom.classicViewPage.classList.toggle('hidden', isPro);
        this.dom.proViewPage.classList.toggle('hidden', !isPro);

        if (isPro) {
            setTimeout(() => {
                if (this.waveformVis) this.waveformVis._syncSize();
                if (this.eqSpectrumVis) this.eqSpectrumVis._syncSize();
                if (this.meterBridgeVis) this.meterBridgeVis._syncSize();
            }, 25);
        } else {
            this._drawClassicPlaceholderSpectrum();
        }

        trackGAEvent('view_mode_switch', { mode: this.viewMode });
    }

    _initVisualizers() {
        this.waveformVis = new WaveformVisualizer(this.dom.waveformCanvas, {
            onSeek: (sec) => {
                this.engine.seek(sec);
            },
            onLoopChange: (startSec, endSec, enabled) => {
                this.engine.setLoop(enabled, startSec, endSec);
                this._syncLoopButtonUI();
            }
        });

        this.eqSpectrumVis = new EQSpectrumVisualizer(this.dom.eqSpectrumCanvas, {
            onSelectBand: (bandIdx) => {
                this.selectedEqBand = bandIdx;
                this._renderEqBandTabs();
                this._mountSelectedEqBandSliders();
            },
            onBandChange: (bandIdx, freq, gain, q) => {
                const patch = {
                    [`eq${bandIdx}Freq`]: freq,
                    [`eq${bandIdx}Gain`]: gain,
                    [`eq${bandIdx}Q`]: q
                };
                this.settings = { ...this.settings, ...patch };
                this.engine.updateSettings(patch, true);
                this._syncControlValuesFromSettings();
                this._renderEqBandTabs();
                this._scheduleAutoAudit();
            }
        });

        this.meterBridgeVis = new MeterBridgeVisualizer(this.dom.vectorscopeCanvas);
    }

    _populatePresetDropdown(selectedKey = 'flat') {
        const select = this.dom.presetSelect;
        select.innerHTML = '';

        const builtinGroup = document.createElement('optgroup');
        builtinGroup.label = 'Studio & AI-Music Presets';
        Object.entries(BUILTIN_PRESETS).forEach(([key, preset]) => {
            const opt = document.createElement('option');
            opt.value = `builtin:${key}`;
            opt.textContent = preset.name;
            if (`builtin:${key}` === selectedKey || key === selectedKey) {
                opt.selected = true;
            }
            builtinGroup.appendChild(opt);
        });
        select.appendChild(builtinGroup);

        const userPresets = loadUserPresets();
        const userKeys = Object.keys(userPresets);
        if (userKeys.length > 0) {
            const userGroup = document.createElement('optgroup');
            userGroup.label = 'Saved User Presets';
            userKeys.forEach(uKey => {
                const opt = document.createElement('option');
                opt.value = `user:${uKey}`;
                opt.textContent = userPresets[uKey].name;
                if (`user:${uKey}` === selectedKey) {
                    opt.selected = true;
                }
                userGroup.appendChild(opt);
            });
            select.appendChild(userGroup);
        }

        const isUserSelected = String(select.value).startsWith('user:');
        this.dom.deletePresetBtn.classList.toggle('hidden', !isUserSelected);
    }

    _bindEvents() {
        // Top View Switcher (Classic View vs Studio Pro View)
        this.dom.viewClassicBtn.addEventListener('click', () => this.setViewMode('classic'));
        this.dom.viewProBtn.addEventListener('click', () => this.setViewMode('pro'));

        // Notice buttons to switch back to Remastered (B)
        this.dom.switchToRemasterNoticeBtn.addEventListener('click', () => this.setABMode(true));
        this.dom.classicSwitchToRemasterBtn.addEventListener('click', () => this.setABMode(true));

        // File Loaders (both Classic View and Studio Pro View)
        this.dom.classicAudioFile.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.loadAudioFile(file);
        });
        this.dom.fileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.loadAudioFile(file);
        });

        this.dom.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dom.dropzone.classList.add('is-dragover');
        });
        this.dom.dropzone.addEventListener('dragleave', () => {
            this.dom.dropzone.classList.remove('is-dragover');
        });
        this.dom.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dom.dropzone.classList.remove('is-dragover');
            const file = e.dataTransfer?.files?.[0];
            if (file) this.loadAudioFile(file);
        });

        // Demo Synth Groove Loader (both Classic View and Studio Pro View)
        const handleLoadDemo = async () => {
            await this.engine.ensureRunning();
            const demoBuf = createDemoAudioBuffer(this.engine.ctx);
            this._applyDecodedBuffer(demoBuf, 'AI_Synth_Demo_Loop.wav');
            trackGAEvent('file_operation', { operation: 'demo_track_loaded' });
        };
        this.dom.classicLoadDemoBtn.addEventListener('click', handleLoadDemo);
        this.dom.loadDemoBtn.addEventListener('click', handleLoadDemo);

        // Classic View Player Controls (Play/Pause, Progress Bar Seek, A/B Toggle Switch)
        this.dom.classicPlayPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.dom.abToggleSwitch.addEventListener('change', () => {
            this.setABMode(this.dom.abToggleSwitch.checked);
        });
        this.dom.labelOriginal.addEventListener('click', () => this.setABMode(false));
        this.dom.labelRemastered.addEventListener('click', () => this.setABMode(true));

        this.dom.unifiedProgressContainer.addEventListener('click', (e) => {
            if (!this.engine.buffer) return;
            const rect = this.dom.unifiedProgressContainer.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.engine.seek(ratio * this.engine.buffer.duration);
        });

        // Classic View Action Buttons
        this.dom.classicAutoMasterBtn.addEventListener('click', () => this.runSmartAutoMaster());
        this.dom.classicResetControlsBtn.addEventListener('click', () => this.resetToFlat());
        this.dom.classicDownloadBtn.addEventListener('click', () => this.exportMasterWav());

        // Studio Pro Transport Controls
        this.dom.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.dom.stopBtn.addEventListener('click', () => {
            this.engine.stop(false);
            this._syncPlayPauseUI();
            this._drawClassicPlaceholderSpectrum();
        });
        this.dom.loopToggleBtn.addEventListener('click', () => this.toggleLoop());

        // Studio Pro A/B Segmented Switch & Loudness Match
        this.dom.abOrigBtn.addEventListener('click', () => this.setABMode(false));
        this.dom.abRemasterBtn.addEventListener('click', () => this.setABMode(true));

        this.dom.loudnessMatchBtn.addEventListener('click', () => {
            this.engine.setLoudnessMatched(!this.engine.isLoudnessMatched);
            this.dom.loudnessMatchBtn.classList.toggle('is-active', this.engine.isLoudnessMatched);
            trackGAEvent('loudness_match_toggle', { enabled: this.engine.isLoudnessMatched });
        });

        // Module Bypass Toggles
        Object.entries(this.dom.bypassButtons).forEach(([bypassKey, btn]) => {
            btn.addEventListener('click', () => {
                const nextBypassed = !this.settings[bypassKey];
                this.settings[bypassKey] = nextBypassed;
                this.engine.updateSettings({ [bypassKey]: nextBypassed }, true);
                this._syncBypassUI();
                this._scheduleAutoAudit();
            });
        });

        // Saturation Mode Segmented Buttons (Tape / Tube / Warm)
        this.dom.satModeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.satMode;
                const patch = { saturationMode: mode };
                if (Number(this.settings.warmthDrive) <= 0) {
                    patch.warmthDrive = 35;
                }
                this.settings = { ...this.settings, ...patch };
                this.engine.updateSettings(patch, true);
                this._syncControlValuesFromSettings();
                this._syncSaturationModeUI();
                this._syncContextualGreyOutStates();
                this._scheduleAutoAudit();
            });
        });

        // Export Bit Depth Segmented Buttons
        this.dom.bitDepthButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.exportBitDepth = Number(btn.dataset.bitDepth) || 24;
                this.dom.bitDepthButtons.forEach(b => {
                    b.classList.toggle('is-selected', Number(b.dataset.bitDepth) === this.exportBitDepth);
                });
            });
        });

        // Preset Selection, Smart Auto-Master, Save/Delete/Export/Import
        this.dom.presetSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const isUser = val.startsWith('user:');
            this.dom.deletePresetBtn.classList.toggle('hidden', !isUser);

            if (val.startsWith('builtin:')) {
                const key = val.replace('builtin:', '');
                const preset = BUILTIN_PRESETS[key];
                if (preset) {
                    this.applyPresetSettings(preset.settings, `Applied Preset: ${preset.name}`, [preset.description]);
                }
            } else if (isUser) {
                const key = val.replace('user:', '');
                const userPresets = loadUserPresets();
                if (userPresets[key]) {
                    this.applyPresetSettings(userPresets[key].settings, `Applied User Preset: ${userPresets[key].name}`, []);
                }
            }
        });

        this.dom.autoMasterBtn.addEventListener('click', () => this.runSmartAutoMaster());

        this.dom.savePresetBtn.addEventListener('click', () => {
            const name = window.prompt('Enter a name for your custom mastering preset:', 'My Suno Polish');
            if (!name || !name.trim()) return;
            const id = `custom_${Date.now()}`;
            saveUserPreset(id, name.trim(), this.settings);
            this._populatePresetDropdown(`user:${id}`);
            trackGAEvent('preset_saved', { preset_name: name.trim() });
        });

        this.dom.deletePresetBtn.addEventListener('click', () => {
            const val = this.dom.presetSelect.value;
            if (!val.startsWith('user:')) return;
            const id = val.replace('user:', '');
            deleteUserPreset(id);
            this._populatePresetDropdown('builtin:flat');
        });

        this.dom.exportPresetJsonBtn.addEventListener('click', () => {
            const payload = {
                app: 'Audio Remastering Lab',
                version: 2,
                exportedAt: new Date().toISOString(),
                settings: this.settings
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'remaster-preset.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 100);
        });

        this.dom.importPresetJsonBtn.addEventListener('click', () => {
            this.dom.importPresetInput.click();
        });

        this.dom.importPresetInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const importedSettings = parsed.settings || parsed;
                this.applyPresetSettings(importedSettings, `Imported Preset: ${file.name}`, ['Loaded settings from JSON preset file']);
            } catch (err) {
                console.error('Invalid preset JSON:', err);
                alert('Could not parse preset JSON file.');
            } finally {
                this.dom.importPresetInput.value = '';
            }
        });

        this.dom.resetAllBtn.addEventListener('click', () => this.resetToFlat());
        this.dom.closeDiagnosticBtn.addEventListener('click', () => {
            this.dom.diagnosticBanner.classList.add('hidden');
        });
        this.dom.downloadMasterBtn.addEventListener('click', () => this.exportMasterWav());
    }

    _bindKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' && document.activeElement.type === 'text') return;
            if (tag === 'textarea' || tag === 'select') return;

            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.key === 'b' || e.key === 'B') {
                e.preventDefault();
                this.setABMode(!this.engine.isRemasteredActive);
            } else if (e.key === 'l' || e.key === 'L') {
                e.preventDefault();
                this.toggleLoop();
            } else if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                this.dom.loudnessMatchBtn.click();
            } else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                this.resetToFlat();
            }
        });
    }

    async loadAudioFile(file) {
        if (!file) return;
        this.dom.classicFileName.textContent = `Loading: ${file.name}...`;
        this.dom.fileMetaText.innerHTML = `Decoding <strong>${file.name}</strong>...`;

        try {
            await this.engine.ensureRunning();
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.engine.ctx.decodeAudioData(arrayBuffer);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Decoded audio buffer is empty.');
            }

            this._applyDecodedBuffer(audioBuffer, file.name);
            trackGAEvent('file_operation', {
                operation: 'processing_success',
                file_type: file.type,
                file_duration: audioBuffer.duration.toFixed(1),
                sample_rate: audioBuffer.sampleRate
            });
        } catch (err) {
            console.error('Error decoding audio file:', err);
            this.dom.classicFileName.textContent = `Error loading ${file.name}. Try another.`;
            this.dom.fileMetaText.innerHTML = `<span style="color:var(--status-danger)">Failed to decode ${file.name}. Try WAV, MP3, FLAC, or M4A.</span>`;
            trackGAEvent('file_operation', {
                operation: 'processing_error',
                error_message: err.message
            });
        } finally {
            this.dom.fileInput.value = '';
            this.dom.classicAudioFile.value = '';
        }
    }

    _applyDecodedBuffer(audioBuffer, fileName) {
        this.loadedFileName = fileName;
        const baseName = fileName.replace(/\.[^/.]+$/, '');
        this.dom.exportFilenameInput.value = `${baseName}_remastered`;

        const dur = Number(audioBuffer.duration.toFixed(2));
        this.settings.trimStartSec = 0;
        this.settings.trimEndSec = dur;

        (this.controlRegistry.get('trimStartSec') || []).forEach(ctrl => {
            ctrl.setMax(Math.max(0.5, dur - 0.5));
            ctrl.setValue(0);
        });
        (this.controlRegistry.get('trimEndSec') || []).forEach(ctrl => {
            ctrl.setMax(dur);
            ctrl.setValue(dur);
        });

        this.engine.setBuffer(audioBuffer);
        this.waveformVis.setBuffer(audioBuffer);

        // Update Classic View UI
        this.dom.classicFileName.textContent = `Loaded: ${fileName} (${formatClassicTime(dur)})`;
        this.dom.classicAudioFileButton.textContent = 'Choose New File';
        this.dom.previewABSection.classList.remove('hidden');
        this.dom.controlsSection.classList.remove('hidden');
        this.dom.downloadSection.classList.remove('hidden');
        this.dom.currentTimeDisplay.textContent = `0:00 / ${formatClassicTime(dur)}`;
        this.dom.unifiedProgressBar.style.width = '0%';
        this._drawClassicPlaceholderSpectrum();

        // Update Studio Pro View UI
        const chLabel = audioBuffer.numberOfChannels > 1 ? 'Stereo' : 'Mono';
        this.dom.fileMetaText.innerHTML = `<strong>${fileName}</strong> • ${formatTime(dur)} • ${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz • ${chLabel}`;

        this.originalMetrics = analyzeAudioBuffer(audioBuffer);
        this._renderClassicAnalysisBlock(this.originalMetrics, this.dom.originalAnalysisDisplayWrapper, 'Original Audio Metrics');

        this._setControlsEnabled(true);
        this._syncContextualGreyOutStates();
        this._syncPlayPauseUI();

        // Automatically compute Before / After Audit & Classic Remastered Audio Metrics right on load
        this._scheduleAutoAudit(50);
    }

    /**
     * Renders the original Classic View analysis block (`Original Audio Metrics` or `Remastered Audio Metrics`)
     * with Peak Level, RMS Level, Dynamic Range, Integrated LUFS, and automated suggestions.
     */
    _renderClassicAnalysisBlock(metrics, targetEl, title, origMetricsForComparison = null) {
        if (!targetEl || !metrics) return;

        const peakDb = metrics.peakDb;
        const rmsDb = metrics.rmsDb;
        const dynamicRange = metrics.crestFactorDb;
        const lufs = metrics.lufsIntegrated;

        let suggestionsItems = '';
        if (peakDb > -0.3) {
            suggestionsItems += '<li><strong style="color:#facc15;">High Peaks:</strong> Audio peaks are very close to 0 dBFS. Use the Limiter or reduce Gain to prevent clipping.</li>';
        } else if (peakDb < -12.0) {
            suggestionsItems += '<li><strong style="color:#60a5fa;">Low Peak Level:</strong> Overall peak level is low. Consider increasing Master Gain.</li>';
        }

        if (rmsDb < -24.0) {
            suggestionsItems += '<li><strong style="color:#60a5fa;">Low Average Loudness (RMS):</strong> Audio sounds quiet. Consider increasing Master Gain or using the Compressor for a fuller sound.</li>';
        } else if (rmsDb > -9.5 && peakDb < -1.0) {
            suggestionsItems += '<li><strong style="color:#facc15;">High Average Loudness (RMS):</strong> Audio has limited dynamic variation. If it sounds squashed, reduce compression.</li>';
        }

        if (dynamicRange < 7.5 && peakDb < -3.0) {
            suggestionsItems += '<li><strong style="color:#60a5fa;">Low Dynamic Range:</strong> Minimal loudness variation. Consider reducing compression ratio if it lacks punch.</li>';
        } else if (dynamicRange > 18) {
            suggestionsItems += '<li><strong style="color:#60a5fa;">Wide Dynamic Range:</strong> Significant loudness variation. A gentle compressor ratio (2.5:1 – 4:1) will glue levels together.</li>';
        }

        if (!suggestionsItems) {
            suggestionsItems = '<li><strong style="color:#4ade80;">Balanced Audio:</strong> Audio metrics appear balanced and ready for export!</li>';
        }

        const deltaLufsStr = origMetricsForComparison
            ? ` <span style="color:#9ca3af;font-size:0.8rem;">(was ${origMetricsForComparison.lufsIntegrated.toFixed(1)} LUFS)</span>`
            : '';
        const deltaPeakStr = origMetricsForComparison
            ? ` <span style="color:#9ca3af;font-size:0.8rem;">(was ${origMetricsForComparison.peakDb.toFixed(2)} dBFS)</span>`
            : '';
        const deltaRmsStr = origMetricsForComparison
            ? ` <span style="color:#9ca3af;font-size:0.8rem;">(was ${origMetricsForComparison.rmsDb.toFixed(2)} dBFS)</span>`
            : '';

        targetEl.innerHTML = `
            <div class="analysis-block">
                <h5>${title}</h5>
                <div class="analysis-metrics-grid">
                    <p><strong>Integrated Loudness:</strong> <span style="color:#f0a500;font-weight:700;">${lufs.toFixed(1)} LUFS</span>${deltaLufsStr}</p>
                    <p><strong>Peak Level:</strong> <span style="color:#f0a500;font-weight:700;">${peakDb.toFixed(2)} dBFS</span>${deltaPeakStr}</p>
                    <p><strong>RMS Level (Avg. Loudness):</strong> <span style="color:#f0a500;font-weight:700;">${rmsDb.toFixed(2)} dBFS</span>${deltaRmsStr}</p>
                    <p><strong>Approx. Dynamic Range:</strong> <span style="color:#f0a500;font-weight:700;">${dynamicRange.toFixed(2)} dB</span></p>
                    <div style="margin-top:0.35rem;">
                        <strong style="color:#d5d5d5;">Suggestions:</strong>
                        <ul class="analysis-suggestions-list">${suggestionsItems}</ul>
                    </div>
                </div>
            </div>
        `;
        targetEl.classList.remove('hidden');
    }

    runSmartAutoMaster() {
        if (!this.originalMetrics || !this.engine.buffer) return;

        // Ensure we are on Remastered (B) so the user hears and sees active controls
        this.setABMode(true);

        const { settings: smartSettings, explanations } = computeSmartAutoMaster(this.originalMetrics);
        this.applyPresetSettings(
            smartSettings,
            'Smart Auto-Master Diagnostic Report',
            explanations
        );

        trackGAEvent('button_click', {
            category: 'AutoMaster',
            label: 'Smart_Auto_Master_Applied'
        });
    }

    applyPresetSettings(newSettings, bannerTitle = '', explanations = []) {
        const dur = this.engine.buffer ? Number(this.engine.buffer.duration.toFixed(2)) : 0;
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...newSettings,
            trimStartSec: newSettings.trimStartSec !== undefined ? newSettings.trimStartSec : 0,
            trimEndSec: (newSettings.trimEndSec && newSettings.trimEndSec <= dur) ? newSettings.trimEndSec : dur
        };

        this.engine.updateSettings(this.settings, true);
        this._syncControlValuesFromSettings();
        this._syncBypassUI();
        this._syncSaturationModeUI();
        this._syncContextualGreyOutStates();
        this._renderEqBandTabs();

        if (bannerTitle && explanations.length > 0) {
            this._showDiagnosticBanner(bannerTitle, explanations);
        }

        // Automatically calculate Master (B) values in Before / After Audit & Classic Remastered Metrics
        this._scheduleAutoAudit(60);
    }

    resetToFlat() {
        const dur = this.engine.buffer ? Number(this.engine.buffer.duration.toFixed(2)) : 0;
        this.dom.presetSelect.value = 'builtin:flat';
        this.dom.deletePresetBtn.classList.add('hidden');
        this.applyPresetSettings({
            ...DEFAULT_SETTINGS,
            trimStartSec: 0,
            trimEndSec: dur
        });
        this.dom.diagnosticBanner.classList.add('hidden');
    }

    _showDiagnosticBanner(title, items) {
        const titleSpan = this.dom.diagnosticBanner.querySelector('.diagnostic-title-text');
        if (titleSpan) titleSpan.textContent = title;
        this.dom.diagnosticList.innerHTML = items
            .map(item => `<li class="badge-tag is-highlight">✓ ${item}</li>`)
            .join('');
        this.dom.diagnosticBanner.classList.remove('hidden');
    }

    _syncControlValuesFromSettings() {
        this.controlRegistry.forEach((ctrlList, key) => {
            if (this.settings[key] !== undefined) {
                ctrlList.forEach(ctrl => ctrl.setValue(this.settings[key]));
            }
        });
    }

    _syncBypassUI() {
        Object.entries(this.dom.bypassButtons).forEach(([bypassKey, btn]) => {
            const isBypassed = Boolean(this.settings[bypassKey]);
            btn.classList.toggle('is-active', !isBypassed);
            const labelSpan = btn.querySelector('.bypass-label');
            if (labelSpan) {
                labelSpan.textContent = isBypassed ? 'BYPASSED' : 'ACTIVE';
            }
            const panel = this.dom.modulePanels[bypassKey];
            if (panel) {
                panel.classList.toggle('is-bypassed', isBypassed);
            }
        });
    }

    _syncSaturationModeUI() {
        this.dom.satModeButtons.forEach(btn => {
            btn.classList.toggle('is-selected', btn.dataset.satMode === this.settings.saturationMode);
        });
    }

    togglePlayPause() {
        if (!this.engine.buffer) return;
        if (this.engine.isPlaying) {
            this.engine.pause();
        } else {
            this.engine.play();
        }
        this._syncPlayPauseUI();
    }

    setABMode(isRemastered) {
        this.engine.setABMode(isRemastered);

        // Sync Studio Pro A/B buttons
        this.dom.abOrigBtn.classList.toggle('is-selected', !isRemastered);
        this.dom.abRemasterBtn.classList.toggle('is-selected', isRemastered);

        // Sync Classic View A/B toggle switch & labels
        if (this.dom.abToggleSwitch) {
            this.dom.abToggleSwitch.checked = isRemastered;
        }
        if (this.dom.labelOriginal && this.dom.labelRemastered) {
            this.dom.labelOriginal.classList.toggle('is-active-ab', !isRemastered);
            this.dom.labelRemastered.classList.toggle('is-active-ab', isRemastered);
        }

        this._syncContextualGreyOutStates();
        trackGAEvent('ab_test_toggle', {
            value: isRemastered ? 'Remastered_B' : 'Original_A'
        });
    }

    toggleLoop() {
        if (!this.engine.buffer) return;
        const nextLoop = !this.engine.loopEnabled;
        let start = this.engine.loopStartSec;
        let end = this.engine.loopEndSec;
        if (nextLoop && (end - start < 0.5 || (start === 0 && end >= this.engine.buffer.duration - 0.1))) {
            start = Number((this.engine.buffer.duration * 0.2).toFixed(2));
            end = Number((this.engine.buffer.duration * 0.65).toFixed(2));
        }
        this.engine.setLoop(nextLoop, start, end);
        this._syncLoopButtonUI();
    }

    _syncLoopButtonUI() {
        this.dom.loopToggleBtn.classList.toggle('is-active', this.engine.loopEnabled);
    }

    _syncPlayPauseUI() {
        const playing = this.engine.isPlaying;
        if (this.dom.playPauseBtn) {
            this.dom.playPauseBtn.textContent = playing ? 'Pause' : 'Play';
        }
        if (this.dom.classicPlayPauseBtn) {
            this.dom.classicPlayPauseBtn.textContent = playing ? 'Pause' : 'Play';
        }
    }

    _maybeShowWelcomeNote() {
        const storageKey = 'remaster-studio-pro-intro-seen';
        let alreadySeen = false;
        try {
            alreadySeen = window.localStorage.getItem(storageKey) === '1';
        } catch (_) {
            alreadySeen = false;
        }
        if (alreadySeen) return;

        const overlay = document.getElementById('welcomeOverlay');
        const dismissBtn = document.getElementById('welcomeDismissBtn');
        if (!overlay || !dismissBtn) return;

        const closeNote = () => {
            overlay.classList.add('hidden');
            try {
                window.localStorage.setItem(storageKey, '1');
            } catch (_) {
                // Private browsing can block storage; the note simply returns next visit.
            }
            document.removeEventListener('keydown', onKeyDown);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Escape') closeNote();
        };

        dismissBtn.addEventListener('click', closeNote);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeNote();
        });
        document.addEventListener('keydown', onKeyDown);

        overlay.classList.remove('hidden');
        dismissBtn.focus();
    }

    _setControlsEnabled(enabled) {
        const interactiveEls = [
            this.dom.playPauseBtn,
            this.dom.stopBtn,
            this.dom.loopToggleBtn,
            this.dom.abOrigBtn,
            this.dom.abRemasterBtn,
            this.dom.loudnessMatchBtn,
            this.dom.autoMasterBtn,
            this.dom.presetSelect,
            this.dom.savePresetBtn,
            this.dom.exportPresetJsonBtn,
            this.dom.importPresetJsonBtn,
            this.dom.resetAllBtn,
            this.dom.exportFilenameInput,
            this.dom.downloadMasterBtn,
            this.dom.classicPlayPauseBtn,
            this.dom.classicAutoMasterBtn,
            this.dom.classicResetControlsBtn,
            this.dom.classicDownloadBtn
        ];
        interactiveEls.forEach(el => {
            if (el) el.disabled = !enabled;
        });
    }

    /**
     * Automatically schedules offline evaluation of the Master (B) audio whenever controls change,
     * populating both the Classic View's "Remastered Audio Metrics" box and the Studio Pro View's
     * "Before / After Audit" table without needing a manual Evaluate button.
     */
    _scheduleAutoAudit(delayMs = 280) {
        if (!this.engine.buffer) return;
        if (this.auditDebounceTimer) {
            clearTimeout(this.auditDebounceTimer);
        }
        if (this.dom.auditStatusBadge) {
            this.dom.auditStatusBadge.textContent = 'Updating...';
            this.dom.auditStatusBadge.classList.add('is-computing');
        }
        this.auditDebounceTimer = setTimeout(() => {
            this.evaluateRemasteredMetrics();
        }, delayMs);
    }

    async evaluateRemasteredMetrics() {
        if (!this.engine.buffer) return;
        const reqId = ++this.auditRequestId;

        try {
            const rendered = await renderOfflineMaster(this.engine.buffer, this.settings);
            if (reqId !== this.auditRequestId) return;
            this.remasteredMetrics = analyzeAudioBuffer(rendered);
            this._renderMetricsComparisonTable();
            this._renderClassicAnalysisBlock(
                this.remasteredMetrics,
                this.dom.remasteredAnalysisDisplayWrapper,
                'Remastered Audio Metrics (Before / After Auto-Audit)',
                this.originalMetrics
            );
        } catch (err) {
            console.error('Error evaluating offline master:', err);
        } finally {
            if (reqId === this.auditRequestId && this.dom.auditStatusBadge) {
                this.dom.auditStatusBadge.textContent = 'Live Synced';
                this.dom.auditStatusBadge.classList.remove('is-computing');
            }
        }
    }

    _renderMetricsComparisonTable() {
        const tbody = this.dom.metricsComparisonBody;
        if (!this.originalMetrics) {
            tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:0.75rem;">Load an audio file to inspect Before / After metrics</td></tr>`;
            return;
        }

        const orig = this.originalMetrics;
        const rem = this.remasteredMetrics;

        const rows = [
            {
                label: 'Integrated LUFS',
                origVal: `${formatDb(orig.lufsIntegrated, 1)} LUFS`,
                remVal: rem ? `${formatDb(rem.lufsIntegrated, 1)} LUFS` : 'Calculating...',
                highlight: true
            },
            {
                label: 'Sample Peak',
                origVal: `${formatDb(orig.peakDb, 2)} dBFS`,
                remVal: rem ? `${formatDb(rem.peakDb, 2)} dBFS` : '...'
            },
            {
                label: 'Avg Loudness (RMS)',
                origVal: `${formatDb(orig.rmsDb, 1)} dBFS`,
                remVal: rem ? `${formatDb(rem.rmsDb, 1)} dBFS` : '...'
            },
            {
                label: 'Dynamic Range (Crest)',
                origVal: `${orig.crestFactorDb.toFixed(1)} dB`,
                remVal: rem ? `${rem.crestFactorDb.toFixed(1)} dB` : '...'
            },
            {
                label: 'Phase Correlation',
                origVal: `${orig.phaseCorrelation >= 0 ? '+' : ''}${orig.phaseCorrelation.toFixed(2)}`,
                remVal: rem ? `${rem.phaseCorrelation >= 0 ? '+' : ''}${rem.phaseCorrelation.toFixed(2)}` : '...'
            }
        ];

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.label}</td>
                <td style="color:var(--text-secondary);font-variant-numeric:tabular-nums;">${r.origVal}</td>
                <td style="color:${r.highlight ? 'var(--accent-primary)' : 'var(--accent-secondary)'};font-weight:700;font-variant-numeric:tabular-nums;">${r.remVal}</td>
            </tr>
        `).join('');
    }

    async exportMasterWav() {
        if (!this.engine.buffer) return;
        this.dom.downloadMasterBtn.disabled = true;
        this.dom.classicDownloadBtn.disabled = true;

        const origProLabel = this.dom.downloadMasterBtn.textContent;
        const origClassicLabel = this.dom.classicDownloadBtn.textContent;
        this.dom.downloadMasterBtn.textContent = 'Rendering Master...';
        this.dom.classicDownloadBtn.textContent = 'Rendering Master...';

        try {
            const renderedBuffer = await renderOfflineMaster(this.engine.buffer, this.settings);
            const wavBlob = encodeBufferToWavBlob(renderedBuffer, this.exportBitDepth);

            const rawName = (this.dom.exportFilenameInput.value || 'remastered_audio').trim();
            const safeName = rawName.replace(/\.wav$/i, '');
            const url = URL.createObjectURL(wavBlob);

            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `${safeName}.wav`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 150);

            this.remasteredMetrics = analyzeAudioBuffer(renderedBuffer);
            this._renderMetricsComparisonTable();

            trackGAEvent('download', {
                operation: 'completed',
                bit_depth: this.exportBitDepth,
                file_size_kb: Math.round(wavBlob.size / 1024)
            });
        } catch (err) {
            console.error('Failed to render/export master WAV:', err);
            alert('Error rendering master WAV. Please check console for details.');
        } finally {
            this.dom.downloadMasterBtn.disabled = false;
            this.dom.classicDownloadBtn.disabled = false;
            this.dom.downloadMasterBtn.textContent = origProLabel;
            this.dom.classicDownloadBtn.textContent = origClassicLabel;
        }
    }

    _syncClassicSpectrumSize() {
        const canvas = this.dom.unifiedFftCanvas;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const nextW = Math.round(rect.width * dpr);
        const nextH = Math.round(rect.height * dpr);
        if (canvas.width !== nextW || canvas.height !== nextH) {
            canvas.width = nextW;
            canvas.height = nextH;
        }
    }

    _drawClassicPlaceholderSpectrum() {
        const canvas = this.dom.unifiedFftCanvas;
        if (!canvas) return;
        this._syncClassicSpectrumSize();
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#555';
        ctx.font = `${Math.round(14 * (window.devicePixelRatio || 1))}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Spectrum Analyzer', w / 2, h / 2);
    }

    _drawClassicLiveSpectrum() {
        const canvas = this.dom.unifiedFftCanvas;
        const analyser = this.engine.isRemasteredActive
            ? this.engine.analyserPost
            : this.engine.analyserPre;
        if (!canvas || !this.engine.isPlaying || !analyser) return;
        this._syncClassicSpectrumSize();
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const binCount = analyser.frequencyBinCount;
        if (!this._classicFftData || this._classicFftData.length !== binCount) {
            this._classicFftData = new Uint8Array(binCount);
        }
        analyser.getByteFrequencyData(this._classicFftData);

        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, w, h);

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, '#f0a500');
        gradient.addColorStop(0.7, '#d08c00');
        gradient.addColorStop(1, '#a06800');
        ctx.fillStyle = gradient;

        const gap = Math.max(1, Math.round(window.devicePixelRatio || 1));
        const numBars = Math.max(48, Math.floor(w / (gap * 4)));
        const barWidth = Math.max(1, (w - gap * numBars) / numBars);
        const binsPerBar = binCount / numBars;
        let x = 0;
        for (let i = 0; i < numBars; i++) {
            const startBin = Math.floor(i * binsPerBar);
            const endBin = Math.max(startBin + 1, Math.floor((i + 1) * binsPerBar));
            let peak = 0;
            for (let b = startBin; b < endBin && b < binCount; b++) {
                if (this._classicFftData[b] > peak) peak = this._classicFftData[b];
            }
            const barHeight = (peak / 255) * h;
            ctx.fillRect(x, h - barHeight, barWidth, barHeight);
            x += barWidth + gap;
        }
    }

    _startRenderLoop() {
        const tick = () => {
            const curTime = this.engine.getCurrentTime();
            const dur = this.engine.buffer ? this.engine.buffer.duration : 0;

            if (this._uiPlaying !== this.engine.isPlaying) {
                this._uiPlaying = this.engine.isPlaying;
                this._syncPlayPauseUI();
            }

            // Update Classic View progress bar, time display, and spectrum analyzer
            if (this.viewMode === 'classic' && this.engine.buffer) {
                const pct = dur > 0 ? Math.min(100, (curTime / dur) * 100) : 0;
                this.dom.unifiedProgressBar.style.width = `${pct}%`;
                this.dom.currentTimeDisplay.textContent = `${formatClassicTime(curTime)} / ${formatClassicTime(dur)}`;
                if (this.engine.isPlaying) {
                    this._drawClassicLiveSpectrum();
                }
            }

            // Update Studio Pro View visualizers & meters
            if (this.viewMode === 'pro') {
                if (this.dom.timeReadout) {
                    this.dom.timeReadout.textContent = `${formatTime(curTime)} / ${formatTime(dur)}`;
                }

                if (this.waveformVis) {
                    this.waveformVis.draw({
                        currentTime: curTime,
                        isRemastered: this.engine.isRemasteredActive,
                        loopEnabled: this.engine.loopEnabled,
                        loopStartSec: this.engine.loopStartSec,
                        loopEndSec: this.engine.loopEndSec,
                        trimStartSec: this.settings.trimStartSec,
                        trimEndSec: this.settings.trimEndSec,
                        fadeInSec: this.settings.fadeInSec,
                        fadeOutSec: this.settings.fadeOutSec
                    });
                }

                if (this.eqSpectrumVis) {
                    this.eqSpectrumVis.draw(this.engine, this.settings);
                }

                if (this.meterBridgeVis) {
                    const liveStats = this.meterBridgeVis.updateAndDraw(this.engine);
                    this._updateLiveMeterDOM(liveStats);
                }
            }

            this.animFrameId = requestAnimationFrame(tick);
        };
        this.animFrameId = requestAnimationFrame(tick);
    }

    _updateLiveMeterDOM(stats) {
        const dbToPercent = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

        const lPct = dbToPercent(stats.peakLDb);
        const rPct = dbToPercent(stats.peakRDb);
        const grAbs = Math.abs(stats.gainReductionDb);
        const grPct = Math.max(0, Math.min(100, (grAbs / 18) * 100));

        this.dom.meterFillL.style.width = `${lPct}%`;
        this.dom.meterFillR.style.width = `${rPct}%`;
        this.dom.meterFillGr.style.width = `${grPct}%`;

        this.dom.meterTextL.textContent = `${formatDb(stats.peakLDb, 1)}`;
        this.dom.meterTextR.textContent = `${formatDb(stats.peakRDb, 1)}`;
        this.dom.meterTextGr.textContent = grAbs > 0.05 ? `-${grAbs.toFixed(1)}` : '0.0';

        const maxPeak = Math.max(stats.peakLDb, stats.peakRDb);
        const fallbackMetrics = this.engine.isRemasteredActive && this.remasteredMetrics
            ? this.remasteredMetrics
            : this.originalMetrics;

        this.dom.statLufsLive.textContent = stats.shortTermLufs > -90
            ? `${stats.shortTermLufs.toFixed(1)}`
            : (fallbackMetrics ? `${fallbackMetrics.lufsIntegrated.toFixed(1)}` : '-∞');
        this.dom.statPeakLive.textContent = maxPeak > -90
            ? `${maxPeak.toFixed(1)} dB`
            : (fallbackMetrics ? `${fallbackMetrics.peakDb.toFixed(1)} dB` : '-∞');
        this.dom.statGrLive.textContent = grAbs > 0.05 ? `-${grAbs.toFixed(1)} dB` : '0.0 dB';

        const phase = this.engine.isPlaying
            ? stats.phaseCorrelation
            : (fallbackMetrics ? fallbackMetrics.phaseCorrelation : 1.0);
        this.dom.statPhaseLive.textContent = `${phase >= 0 ? '+' : ''}${phase.toFixed(2)}`;
        const phasePct = ((phase + 1) / 2) * 100;
        this.dom.phaseIndicator.style.left = `${Math.max(4, Math.min(96, phasePct))}%`;
        this.dom.phaseIndicator.style.backgroundColor = phase < 0
            ? 'var(--status-danger)'
            : (phase < 0.35 ? 'var(--status-warn)' : 'var(--status-good)');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new RemasterStudioApp();
    app.init();
});
