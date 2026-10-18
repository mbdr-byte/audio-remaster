/**
 * ==========================================================================
 * Presets, Parameter Schema & State Management
 * Single source of truth for all DSP parameters, defaults, and presets.
 * ==========================================================================
 */

export const EQ_BAND_DEFS = [
    {
        index: 0,
        id: 'subCut',
        name: 'Band 1: High-Pass (Sub Cut)',
        shortName: '1. HPF',
        type: 'highpass',
        defaultFreq: 30,
        minFreq: 20,
        maxFreq: 250,
        defaultGain: 0,
        defaultQ: 0.71,
        minQ: 0.5,
        maxQ: 4.0,
        hasGain: false,
        color: '#ef4444',
        tooltip: 'Removes inaudible sub-bass rumble (<30-60 Hz) that eats up headroom in AI-generated tracks.'
    },
    {
        index: 1,
        id: 'lowShelf',
        name: 'Band 2: Bass (Low Shelf)',
        shortName: '2. BASS',
        type: 'lowshelf',
        defaultFreq: 100,
        minFreq: 40,
        maxFreq: 250,
        defaultGain: 0,
        defaultQ: 0.71,
        minQ: 0.4,
        maxQ: 2.5,
        hasGain: true,
        color: '#f97316',
        tooltip: 'Boosts or cuts low-end weight and kick/bass punch.'
    },
    {
        index: 2,
        id: 'lowMid',
        name: 'Band 3: Low-Mid (De-Mud)',
        shortName: '3. LOW-MID',
        type: 'peaking',
        defaultFreq: 280,
        minFreq: 140,
        maxFreq: 650,
        defaultGain: 0,
        defaultQ: 1.4,
        minQ: 0.3,
        maxQ: 8.0,
        hasGain: true,
        color: '#eab308',
        tooltip: 'Targets the 200-400 Hz boxy/muddy buildup very common in Suno and Udio generations.'
    },
    {
        index: 3,
        id: 'midPresence',
        name: 'Band 4: Mid (Body & Vocal)',
        shortName: '4. MID',
        type: 'peaking',
        defaultFreq: 1400,
        minFreq: 500,
        maxFreq: 3500,
        defaultGain: 0,
        defaultQ: 1.0,
        minQ: 0.3,
        maxQ: 8.0,
        hasGain: true,
        color: '#22c55e',
        tooltip: 'Shapes vocal forwardness, snare body, and lead instrument clarity.'
    },
    {
        index: 4,
        id: 'highMid',
        name: 'Band 5: High-Mid (Harshness)',
        shortName: '5. HI-MID',
        type: 'peaking',
        defaultFreq: 4500,
        minFreq: 2200,
        maxFreq: 8500,
        defaultGain: 0,
        defaultQ: 1.8,
        minQ: 0.3,
        maxQ: 8.0,
        hasGain: true,
        color: '#38bdf8',
        tooltip: 'Precision control over the 3-6 kHz ear-fatigue zone where digital fizz and harshness live.'
    },
    {
        index: 5,
        id: 'highShelf',
        name: 'Band 6: Air (High Shelf)',
        shortName: '6. AIR',
        type: 'highshelf',
        defaultFreq: 10500,
        minFreq: 5000,
        maxFreq: 16000,
        defaultGain: 0,
        defaultQ: 0.71,
        minQ: 0.4,
        maxQ: 2.5,
        hasGain: true,
        color: '#a855f7',
        tooltip: 'Adds silky top-end sparkle and studio air above 10 kHz, or tames brittle hiss.'
    }
];

export const DEFAULT_SETTINGS = {
    // Module bypass flags
    bypassEq: false,
    bypassAiRestore: false,
    bypassDynamics: false,
    bypassStereoSpace: false,

    // 6-Band Parametric EQ
    eq0Freq: 30, eq0Gain: 0, eq0Q: 0.71,
    eq1Freq: 100, eq1Gain: 0, eq1Q: 0.71,
    eq2Freq: 280, eq2Gain: 0, eq2Q: 1.4,
    eq3Freq: 1400, eq3Gain: 0, eq3Q: 1.0,
    eq4Freq: 4500, eq4Gain: 0, eq4Q: 1.8,
    eq5Freq: 10500, eq5Gain: 0, eq5Q: 0.71,

    // AI Restoration & Analog Glue
    harshTamerAmount: 0,       // 0 - 100% dynamic + notch suppression in 3.5-7.5kHz
    harshTamerFreq: 5200,      // 3000 - 8000 Hz center of AI shimmer
    mudCleanerAmount: 0,       // 0 - 100% targeted dynamic 250Hz de-mud + 45Hz tighter sub roll
    saturationMode: 'tape',    // 'tape' | 'tube' | 'warm'
    warmthDrive: 0,            // 0 - 100% harmonic saturation
    airExciter: 0,             // 0 - 100% high-frequency harmonic sheen

    // Dynamics & Brickwall Limiter
    compThreshold: -20,        // -60 to 0 dB
    compRatio: 3.0,            // 1 to 20 :1
    compAttack: 15,            // 1 to 150 ms
    compRelease: 160,          // 20 to 800 ms
    compKnee: 6,               // 0 to 24 dB
    limiterThreshold: -1.0,    // -12 to -0.1 dBFS
    masterGain: 0,             // -12 to +12 dB

    // True Mid/Side Stereo & Studio Space
    stereoWidth: 100,          // 0% (Mono) to 200% (Ultra-Wide M/S)
    bassMonoFreq: 120,         // 20 to 300 Hz (High-passes the Side channel below this freq)
    sideAirBoost: 0,           // 0 to 6 dB (Boosts >6kHz on the Side channel only)
    reverbMix: 0,              // 0 to 30 %
    reverbDecay: 35,           // 10 to 90 %
    reverbDamping: 4200,       // 1200 to 10000 Hz

    // Track Trim & Fades
    trimStartSec: 0,
    trimEndSec: 0,             // 0 = full track duration (updated when buffer loads)
    fadeInSec: 0,              // 0 to 10 s
    fadeOutSec: 0              // 0 to 15 s
};

export const BUILTIN_PRESETS = {
    flat: {
        name: 'Flat / Default (Bypassed Curve)',
        description: 'Neutral starting point with all EQ bands flat and restoration at zero.',
        settings: { ...DEFAULT_SETTINGS }
    },
    suno_polish: {
        name: 'Suno / Udio De-Harsh & Polish',
        description: 'Tames 4.8kHz AI metallic shimmer, clears 280Hz boxiness, centers sub-bass below 130Hz, and adds tape glue.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 38,
            eq1Freq: 95, eq1Gain: 1.5, eq1Q: 0.75,
            eq2Freq: 275, eq2Gain: -2.8, eq2Q: 1.8,
            eq3Freq: 1650, eq3Gain: 0.8, eq3Q: 1.1,
            eq4Freq: 4800, eq4Gain: -2.4, eq4Q: 2.2,
            eq5Freq: 11500, eq5Gain: 1.8, eq5Q: 0.71,
            harshTamerAmount: 42,
            harshTamerFreq: 5100,
            mudCleanerAmount: 35,
            saturationMode: 'tape',
            warmthDrive: 28,
            airExciter: 18,
            compThreshold: -18,
            compRatio: 2.5,
            compAttack: 18,
            compRelease: 140,
            compKnee: 6,
            limiterThreshold: -0.8,
            masterGain: 1.8,
            stereoWidth: 118,
            bassMonoFreq: 135,
            sideAirBoost: 1.5,
            reverbMix: 4
        }
    },
    ai_demud_clarity: {
        name: 'AI De-Mud & High-Def Clarity',
        description: 'Fixes thick, muffled AI generations with heavy low-mid buildup and dull highs.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 45,
            eq1Freq: 85, eq1Gain: 1.0, eq1Q: 0.8,
            eq2Freq: 250, eq2Gain: -4.2, eq2Q: 1.6,
            eq3Freq: 2100, eq3Gain: 1.8, eq3Q: 1.2,
            eq4Freq: 5400, eq4Gain: -1.2, eq4Q: 2.0,
            eq5Freq: 10000, eq5Gain: 3.2, eq5Q: 0.71,
            harshTamerAmount: 25,
            harshTamerFreq: 5500,
            mudCleanerAmount: 55,
            saturationMode: 'tube',
            warmthDrive: 20,
            airExciter: 35,
            compThreshold: -19,
            compRatio: 3.0,
            compAttack: 12,
            compRelease: 120,
            limiterThreshold: -0.9,
            masterGain: 2.0,
            stereoWidth: 122,
            bassMonoFreq: 140,
            sideAirBoost: 2.2,
            reverbMix: 3
        }
    },
    warm_analog_glue: {
        name: 'Warm Analog Tape Master',
        description: 'Rich low-end, smooth rolled-off digital fizz, tube/tape harmonics, and cohesive bus compression.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 32,
            eq1Freq: 110, eq1Gain: 2.2, eq1Q: 0.71,
            eq2Freq: 310, eq2Gain: -1.5, eq2Q: 1.3,
            eq3Freq: 1200, eq3Gain: 0.6, eq3Q: 0.9,
            eq4Freq: 4400, eq4Gain: -2.0, eq4Q: 1.6,
            eq5Freq: 9500, eq5Gain: 0.8, eq5Q: 0.71,
            harshTamerAmount: 35,
            harshTamerFreq: 4600,
            mudCleanerAmount: 20,
            saturationMode: 'tape',
            warmthDrive: 48,
            airExciter: 12,
            compThreshold: -21,
            compRatio: 3.5,
            compAttack: 22,
            compRelease: 180,
            limiterThreshold: -1.0,
            masterGain: 2.2,
            stereoWidth: 110,
            bassMonoFreq: 120,
            sideAirBoost: 1.0,
            reverbMix: 6
        }
    },
    streaming_loudness: {
        name: 'Streaming Ready (-14 LUFS Punch)',
        description: 'Balanced dynamic master optimized for Spotify, Apple Music, and YouTube loudness normalization.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 35,
            eq1Freq: 90, eq1Gain: 1.8, eq1Q: 0.71,
            eq2Freq: 270, eq2Gain: -2.0, eq2Q: 1.5,
            eq3Freq: 1500, eq3Gain: 1.0, eq3Q: 1.0,
            eq4Freq: 4700, eq4Gain: -1.5, eq4Q: 1.8,
            eq5Freq: 11000, eq5Gain: 2.0, eq5Q: 0.71,
            harshTamerAmount: 30,
            harshTamerFreq: 5000,
            mudCleanerAmount: 25,
            saturationMode: 'tape',
            warmthDrive: 24,
            airExciter: 20,
            compThreshold: -18,
            compRatio: 2.8,
            compAttack: 16,
            compRelease: 150,
            limiterThreshold: -1.0,
            masterGain: 2.4,
            stereoWidth: 115,
            bassMonoFreq: 125,
            sideAirBoost: 1.5,
            reverbMix: 3
        }
    },
    club_bass_punch: {
        name: 'Club / Electronic Bass & Width',
        description: 'Tight mono sub-bass, punchy 85Hz shelf, wide stereo highs, and hard-hitting limiting.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 32,
            eq1Freq: 85, eq1Gain: 3.4, eq1Q: 0.85,
            eq2Freq: 290, eq2Gain: -3.0, eq2Q: 1.9,
            eq3Freq: 1800, eq3Gain: 0.5, eq3Q: 1.0,
            eq4Freq: 4900, eq4Gain: -1.8, eq4Q: 2.0,
            eq5Freq: 11500, eq5Gain: 2.6, eq5Q: 0.75,
            harshTamerAmount: 32,
            harshTamerFreq: 5200,
            mudCleanerAmount: 40,
            saturationMode: 'tube',
            warmthDrive: 35,
            airExciter: 28,
            compThreshold: -16,
            compRatio: 4.0,
            compAttack: 25,
            compRelease: 110,
            limiterThreshold: -0.5,
            masterGain: 3.0,
            stereoWidth: 135,
            bassMonoFreq: 150,
            sideAirBoost: 2.5,
            reverbMix: 2
        }
    },
    vocal_forward: {
        name: 'Vocal Presence & Silk Air',
        description: 'Brings buried AI vocals forward with 1.6kHz presence, de-esses harsh sibilance, and adds studio space.',
        settings: {
            ...DEFAULT_SETTINGS,
            eq0Freq: 42,
            eq1Freq: 100, eq1Gain: 0.8, eq1Q: 0.71,
            eq2Freq: 260, eq2Gain: -2.5, eq2Q: 1.6,
            eq3Freq: 1750, eq3Gain: 2.6, eq3Q: 1.1,
            eq4Freq: 5600, eq4Gain: -2.6, eq4Q: 2.4,
            eq5Freq: 12000, eq5Gain: 2.2, eq5Q: 0.71,
            harshTamerAmount: 50,
            harshTamerFreq: 5800,
            mudCleanerAmount: 30,
            saturationMode: 'warm',
            warmthDrive: 22,
            airExciter: 25,
            compThreshold: -20,
            compRatio: 3.2,
            compAttack: 10,
            compRelease: 140,
            limiterThreshold: -0.8,
            masterGain: 2.0,
            stereoWidth: 112,
            bassMonoFreq: 120,
            sideAirBoost: 1.8,
            reverbMix: 8
        }
    }
};

const USER_PRESETS_STORAGE_KEY = 'audio_remaster_lab_user_presets_v2';

export function loadUserPresets() {
    try {
        const raw = localStorage.getItem(USER_PRESETS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.warn('Could not read user presets from localStorage:', e);
        return {};
    }
}

export function saveUserPreset(id, name, settings) {
    try {
        const current = loadUserPresets();
        const cleanSettings = { ...settings };
        // Exclude track-specific trim boundaries when saving reusable presets
        delete cleanSettings.trimStartSec;
        delete cleanSettings.trimEndSec;
        current[id] = {
            name,
            description: 'Custom user saved preset',
            settings: cleanSettings,
            createdAt: new Date().toISOString()
        };
        localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(current));
        return current;
    } catch (e) {
        console.error('Failed to save user preset:', e);
        return null;
    }
}

export function deleteUserPreset(id) {
    try {
        const current = loadUserPresets();
        delete current[id];
        localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(current));
        return current;
    } catch (e) {
        console.error('Failed to delete user preset:', e);
        return null;
    }
}
