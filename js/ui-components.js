/**
 * ==========================================================================
 * Reusable UI Component Builders & Formatting Utilities
 * Eliminates repetitive HTML markup and centralizes control interactions.
 * ==========================================================================
 */

export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${mins}:${secs}`;
}

export function formatDb(db, decimals = 1) {
    if (!Number.isFinite(db) || db <= -95) return '-∞';
    const sign = db > 0 ? '+' : '';
    return `${sign}${db.toFixed(decimals)}`;
}

/**
 * Reusable Slider Control Component
 * Double-clicking the slider resets it to its default value.
 * Supports multiple instances sharing the same param `key` (e.g., Classic View + Studio Pro View).
 */
export function createSliderControl({
    key,
    instancePrefix = 'pro',
    label,
    min,
    max,
    step = 0.1,
    value,
    defaultValue,
    unit = '',
    tooltip = '',
    formatValue = (v) => v,
    onChange
}) {
    const domId = `param-${instancePrefix}-${key}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'control-slider';
    wrapper.dataset.paramKey = key;

    const header = document.createElement('div');
    header.className = 'control-slider-header';

    const labelEl = document.createElement('label');
    labelEl.className = 'control-label';
    labelEl.setAttribute('for', domId);
    labelEl.textContent = label;

    if (tooltip) {
        const badge = document.createElement('span');
        badge.className = 'info-badge';
        badge.dataset.tooltip = tooltip;
        badge.textContent = 'i';
        labelEl.appendChild(badge);
    }

    const valGroup = document.createElement('div');
    valGroup.className = 'control-value-group';

    const valSpan = document.createElement('span');
    valSpan.className = 'control-value';
    valSpan.textContent = formatValue(value);

    const unitSpan = document.createElement('span');
    unitSpan.className = 'control-unit';
    unitSpan.textContent = unit;

    valGroup.appendChild(valSpan);
    if (unit) valGroup.appendChild(unitSpan);

    header.appendChild(labelEl);
    header.appendChild(valGroup);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = domId;
    input.className = 'range-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const handleUpdate = (rawVal) => {
        const num = Number(rawVal);
        valSpan.textContent = formatValue(num);
        if (typeof onChange === 'function') {
            onChange(key, num);
        }
    };

    input.addEventListener('input', (e) => handleUpdate(e.target.value));

    // Studio UX: Double-click any slider to reset to its default value
    input.addEventListener('dblclick', () => {
        if (input.disabled) return;
        const resetVal = defaultValue !== undefined ? defaultValue : value;
        input.value = String(resetVal);
        handleUpdate(resetVal);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(input);

    return {
        element: wrapper,
        input,
        valSpan,
        setValue(newVal) {
            input.value = String(newVal);
            valSpan.textContent = formatValue(Number(newVal));
        },
        setMax(newMax) {
            input.max = String(newMax);
        },
        setDisabled(isDisabled) {
            input.disabled = Boolean(isDisabled);
            wrapper.classList.toggle('is-inactive', Boolean(isDisabled));
        }
    };
}

/**
 * Renders a group of slider definitions into a container and registers them in a multi-map
 * so that shared keys between Classic View and Studio Pro View stay 100% synchronized.
 */
export function mountSliderGroup(container, sliderDefs, controlRegistry, onParamChange, instancePrefix = 'pro') {
    if (!container) return;
    container.innerHTML = '';
    sliderDefs.forEach(def => {
        const ctrl = createSliderControl({
            ...def,
            instancePrefix,
            onChange: onParamChange
        });
        if (!controlRegistry.has(def.key)) {
            controlRegistry.set(def.key, []);
        }
        controlRegistry.get(def.key).push(ctrl);
        container.appendChild(ctrl.element);
    });
}

/**
 * Delegated Floating Tooltip System for all elements with [data-tooltip]
 */
export function initFloatingTooltips() {
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'floating-tooltip hidden';
    document.body.appendChild(tooltipEl);

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;
        const text = target.dataset.tooltip;
        if (!text) return;

        tooltipEl.textContent = text;
        tooltipEl.classList.remove('hidden');

        const rect = target.getBoundingClientRect();
        const tipRect = tooltipEl.getBoundingClientRect();

        let top = rect.bottom + 8;
        let left = rect.left + rect.width / 2 - tipRect.width / 2;

        if (left < 8) left = 8;
        if (left + tipRect.width > window.innerWidth - 8) {
            left = window.innerWidth - tipRect.width - 8;
        }
        if (top + tipRect.height > window.innerHeight - 8) {
            top = rect.top - tipRect.height - 8;
        }

        tooltipEl.style.top = `${top}px`;
        tooltipEl.style.left = `${left}px`;
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            tooltipEl.classList.add('hidden');
        }
    });
}

/**
 * Generates a synthetic demo audio buffer (a short musical chord & drum groove with intentional
 * AI-like 5kHz shimmer and 275Hz mud) so users can test the studio console immediately.
 */
export function createDemoAudioBuffer(audioContext) {
    const duration = 8.0;
    const sampleRate = audioContext.sampleRate;
    const length = Math.floor(duration * sampleRate);
    const buffer = audioContext.createBuffer(2, length, sampleRate);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    const chords = [
        [110, 220, 261.63, 329.63, 493.88],
        [87.31, 174.61, 220.00, 261.63, 329.63]
    ];

    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const bar = Math.floor(t / 4.0) % 2;
        const beatTime = t % 0.5;
        const chord = chords[bar];

        // Kick & Sub pulse every 0.5s
        const kickFreq = 52 + 95 * Math.exp(-beatTime * 28);
        const kickEnv = Math.exp(-beatTime * 9.5);
        const kick = Math.sin(2 * Math.PI * kickFreq * beatTime) * kickEnv * 0.42;

        // Warm synth pad + intentional 275 Hz low-mid boxiness
        let padL = 0;
        let padR = 0;
        for (let n = 0; n < chord.length; n++) {
            const f = chord[n];
            padL += Math.sin(2 * Math.PI * f * t + n * 0.3) * 0.08;
            padR += Math.sin(2 * Math.PI * (f * 1.002) * t - n * 0.3) * 0.08;
        }
        const mud = Math.sin(2 * Math.PI * 275 * t) * 0.14;

        // Hi-hat + intentional 5.1 kHz "AI metallic shimmer" on off-beats
        const hatTime = (t + 0.25) % 0.5;
        const hatEnv = Math.exp(-hatTime * 26);
        const shimmer = (Math.sin(2 * Math.PI * 5120 * t) + 0.6 * Math.sin(2 * Math.PI * 6840 * t)) * hatEnv * 0.09;

        chL[i] = Math.max(-0.95, Math.min(0.95, kick + padL + mud + shimmer * 0.9));
        chR[i] = Math.max(-0.95, Math.min(0.95, kick + padR + mud + shimmer * 1.1));
    }

    return buffer;
}
