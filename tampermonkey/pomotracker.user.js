// ==UserScript==
// @name         Pomodoro Tracker - PiP Moderno Integrado
// @namespace    https://studiuns.marketing/
// @version      4.8.3
// @description  Exibe o cronômetro real do pomodoro-tracker.com em uma janela PiP moderna, animada e responsiva.
// @author       Tiago / Studiuns Marketing
// @match        https://pomodoro-tracker.com/*
// @match        https://*.pomodoro-tracker.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '4.8.3';

    const CONFIG = {
        pipWidth: 240,
        pipHeight: 117,
        expandedWidth: 286,
        expandedHeight: 342,
        resizeAnimationMs: 300,
        updateRate: 200,
        launchButtonId: 'studiuns-pomodoro-modern-pip-button',
        stylesId: 'studiuns-pomodoro-modern-pip-styles',

        theme: {
            focus: {
                title: 'EM FOCO',
                accent: '#f0444b',
                accentSoft: '#e86161',
                start: '#742a31',
                middle: '#4b252a',
                end: '#202126'
            },

            shortBreak: {
                title: 'FAÇA UMA PAUSA CURTA',
                accent: '#50c963',
                accentSoft: '#78db84',
                start: '#2d703a',
                middle: '#285032',
                end: '#202622'
            },

            longBreak: {
                title: 'FAÇA UMA PAUSA LONGA',
                accent: '#34b56a',
                accentSoft: '#68d291',
                start: '#247447',
                middle: '#28543a',
                end: '#202622'
            }
        }
    };

    let pipWindow = null;
    let syncInterval = null;
    let inputListener = null;
    let buttonObserver = null;
    let messageTimeout = null;
    let carouselInterval = null;
    let carouselIndex = 0;
    let isDescriptionExpanded = false;
    let isExpandAnimating = false;
    let compactWindowSize = null;
    let lastKnownCategory = '';
    let lastKnownDescription = '';

    function normalizeText(value, fallback = '') {
        const text = String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim();

        return text || fallback;
    }

    function isVisible(element) {
        if (!(element instanceof Element)) {
            return false;
        }

        const style = window.getComputedStyle(element);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) !== 0 &&
            element.getClientRects().length > 0
        );
    }

    function findTimerRoot() {
        return (
            document.querySelector(
                '.c-timer[data-test="pomodoro"]'
            ) ||
            document.querySelector(
                'pomodoro-timer .c-timer'
            ) ||
            document.querySelector(
                '.c-timer.pomodoro'
            ) ||
            document.querySelector(
                'pomodoro-timer'
            )
        );
    }

    function getTimerText() {
        const root = findTimerRoot();

        const selectors = [
            '.c-timer_time',
            '.c-timer__time',
            '[data-test="timer"]',
            '[data-test="time"]'
        ];

        for (const selector of selectors) {
            const element =
                root?.querySelector?.(selector) ||
                document.querySelector(selector);

            if (!element) {
                continue;
            }

            const match = normalizeText(
                element.textContent
            )
                .replace(/\s+/g, '')
                .match(/\d{1,3}:\d{2}/);

            if (match) {
                return match[0];
            }
        }

        return '00:00';
    }

    function getHeaderText() {
        const root = findTimerRoot();

        const header =
            root?.querySelector?.('.c-head') ||
            root?.querySelector?.(
                '[data-test*="head"]'
            ) ||
            root?.querySelector?.(
                '[data-test*="title"]'
            );

        if (!header) {
            return '';
        }

        const clone = header.cloneNode(true);

        clone
            .querySelectorAll(
                'i, svg, button, input'
            )
            .forEach((element) => {
                element.remove();
            });

        return normalizeText(
            clone.textContent
        ).toUpperCase();
    }

    function getMode() {
        const root = findTimerRoot();
        const title = getHeaderText();

        const identifiers = [
            title,
            root?.className,
            root?.getAttribute?.('data-test'),
            root?.getAttribute?.('data-state'),
            root?.getAttribute?.('data-test-state')
        ]
            .filter(Boolean)
            .join(' ')
            .toUpperCase();

        if (
            identifiers.includes('PAUSA LONGA') ||
            identifiers.includes('LONG BREAK') ||
            identifiers.includes('LONG-BREAK')
        ) {
            return 'longBreak';
        }

        if (
            identifiers.includes('PAUSA') ||
            identifiers.includes('DESCANSO') ||
            identifiers.includes('BREAK')
        ) {
            return 'shortBreak';
        }

        return 'focus';
    }

    function getStatus() {
        const root = findTimerRoot();

        const stateText = [
            root?.getAttribute?.('data-test-state'),
            root?.getAttribute?.('data-state'),
            root?.className
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (
            stateText.includes('started') ||
            stateText.includes('running')
        ) {
            return 'running';
        }

        if (
            stateText.includes('paused')
        ) {
            return 'paused';
        }

        const texts = getNativeButtons().map((button) => {
            return normalizeText(
                button.textContent
            ).toUpperCase();
        });

        if (
            texts.some((text) => {
                return (
                    text.includes('PAUSAR') ||
                    text.includes('PAUSE')
                );
            })
        ) {
            return 'running';
        }

        if (
            texts.some((text) => {
                return (
                    text.includes('CONTINUAR') ||
                    text.includes('RETOMAR') ||
                    text.includes('RESUME')
                );
            })
        ) {
            return 'paused';
        }

        return 'idle';
    }

    function getNativeButtons() {
        const root = findTimerRoot();

        if (!root) {
            return [];
        }

        return [
            ...root.querySelectorAll(
                'button, [role="button"]'
            )
        ].filter((element) => {
            if (!isVisible(element)) {
                return false;
            }

            const title = normalizeText(
                element.getAttribute('title')
            ).toLowerCase();

            return !title.includes('prolongar');
        });
    }

    function findNativeButton(texts) {
        const wanted = texts.map((text) => {
            return text.toUpperCase();
        });

        return getNativeButtons().find((button) => {
            const content = (
                normalizeText(button.textContent) +
                ' ' +
                normalizeText(
                    button.getAttribute('title')
                )
            ).toUpperCase();

            return wanted.some((text) => {
                return content.includes(text);
            });
        });
    }

    function clickNativeButton(button) {
        if (!button) {
            return false;
        }

        button.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window
            })
        );

        button.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window
            })
        );

        button.click();

        return true;
    }

    function performMainAction() {
        const status = getStatus();

        let button = null;

        if (status === 'running') {
            button = findNativeButton([
                'PAUSAR',
                'PAUSE'
            ]);
        } else if (status === 'paused') {
            button = findNativeButton([
                'CONTINUAR',
                'RETOMAR',
                'RESUME'
            ]);
        } else {
            button = findNativeButton([
                'INICIAR',
                'COMEÇAR',
                'START'
            ]);
        }

        if (!button) {
            // Fallback: alguns estados (ex.: "Continuar" só com ícone, sem
            // texto reconhecível) não batem com os rótulos exatos acima.
            // Buscamos o botão principal restante na área de controles,
            // excluindo ações secundárias conhecidas (parar/config/reset).
            button = getNativeButtons().find((candidate) => {
                const content = (
                    normalizeText(candidate.textContent) +
                    ' ' +
                    normalizeText(
                        candidate.getAttribute('title')
                    )
                ).toUpperCase();

                return (
                    !content.includes('PARAR') &&
                    !content.includes('STOP') &&
                    !content.includes('CONFIG') &&
                    !content.includes('RESET')
                );
            });
        }

        if (!clickNativeButton(button)) {
            showMessage(
                'Não localizei o controle principal do site.'
            );

            console.error(
                '[Pomodoro PiP] Controle principal não encontrado.'
            );

            return;
        }

        window.setTimeout(updatePip, 80);
        window.setTimeout(updatePip, 350);
    }

    function performExtendAction() {
        const root = findTimerRoot();

        const selectors = [
            '[title="prolongar o tempo"]',
            '[title*="prolongar" i]',
            'i.fa-plus-circle',
            '.fa-plus-circle'
        ];

        let element = null;

        for (const selector of selectors) {
            element =
                root?.querySelector?.(selector) ||
                document.querySelector(selector);

            if (element) {
                break;
            }
        }

        if (!element) {
            showMessage(
                'Não localizei o botão de prolongar.'
            );

            console.error(
                '[Pomodoro PiP] Botão de prolongar não encontrado.'
            );

            return;
        }

        element.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            })
        );

        window.setTimeout(updatePip, 100);
    }

    function readPomodoroInputValue(fieldLabel, dataTest, ref) {
        const selectors = [
            'form.c-pomo input[data-test="' + dataTest + '"]',
            'input[data-test="' + dataTest + '"]',
            'input[ref="' + ref + '"]'
        ];

        let input = null;

        for (const selector of selectors) {
            input = document.querySelector(selector);

            if (input) {
                break;
            }
        }

        if (!input) {
            console.warn(
                '[Pomodoro PiP] Campo de ' + fieldLabel +
                ' não encontrado na página (seletores testados: ' +
                selectors.join(' | ') +
                '). Mantendo o último valor conhecido.'
            );
            return null;
        }

        return normalizeText(input.value);
    }

    function getTaskData() {
        const category = readPomodoroInputValue(
            'categoria',
            'pomo-category',
            'category'
        );

        const description = readPomodoroInputValue(
            'descrição',
            'pomo-description',
            'description'
        );

        if (category !== null) {
            lastKnownCategory = category;
        }

        if (description !== null) {
            lastKnownDescription = description;
        }

        return {
            category: normalizeText(
                lastKnownCategory,
                'Sem categoria'
            ),
            description: normalizeText(
                lastKnownDescription,
                'Sem descrição'
            )
        };
    }

    function getMainPresentation() {
        const status = getStatus();

        if (status === 'running') {
            return {
                label: 'Pausar',
                icon: 'pause'
            };
        }

        if (status === 'paused') {
            return {
                label: 'Continuar',
                icon: 'play'
            };
        }

        return {
            label: 'Iniciar',
            icon: 'play'
        };
    }

    function getSessionState() {
        if (getMode() === 'focus') {
            return {
                label: 'Em foco',
                color: '#f0444b'
            };
        }

        return {
            label: 'Pausa',
            color: '#f2b134'
        };
    }

    function iconSvg(type) {
        const icons = {
            play: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M8 5.5v13l10-6.5z"
                        fill="currentColor"
                    />
                </svg>
            `,

            pause: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect
                        x="6.5"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="currentColor"
                    />
                    <rect
                        x="13.5"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="currentColor"
                    />
                </svg>
            `,

            plus: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M12 5v14M5 12h14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                    />
                </svg>
            `,

            tag: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M4 5.5v6.1L12.4 20l7.1-7.1L11.1 4.5H5A1 1 0 0 0 4 5.5Z"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linejoin="round"
                    />
                    <circle
                        cx="8"
                        cy="8.5"
                        r="1.3"
                        fill="currentColor"
                    />
                </svg>
            `,

            document: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect
                        x="5"
                        y="3.5"
                        width="14"
                        height="17"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                    />
                    <path
                        d="M8.5 8h7M8.5 12h7M8.5 16h5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                    />
                </svg>
            `,

            timer: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle
                        cx="12"
                        cy="13"
                        r="8"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                    />
                    <path
                        d="M12 9v4l3 2"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                    <path
                        d="M9.5 2.5h5M12 2.5v2.2"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                    />
                </svg>
            `,

            expand: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M9 4H4v5M20 9V4h-5M4 15v5h5M15 20h5v-5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            `,

            close: `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M6 6l12 12M18 6L6 18"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                    />
                </svg>
            `
        };

        return icons[type] || '';
    }

    function createPipDocument(targetDocument) {
        targetDocument.open();

        targetDocument.write(`
            <!doctype html>

            <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">

                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1"
                    >

                    <title>Pomodoro Tracker</title>

                    <style>
                        :root {
                            color-scheme: dark;
                        }

                        @property --accent {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #f0444b;
                        }

                        @property --accent-soft {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #e86161;
                        }

                        @property --background-start {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #742a31;
                        }

                        @property --background-middle {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #4b252a;
                        }

                        @property --background-end {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #202126;
                        }

                        @property --session-color {
                            syntax: '<color>';
                            inherits: true;
                            initial-value: #f0444b;
                        }

                        * {
                            box-sizing: border-box;
                        }

                        html,
                        body {
                            width: 100%;
                            height: 100%;
                            min-width: 0;
                            min-height: 0;

                            margin: 0;
                            padding: 0;

                            /*
                                Última rede de segurança: se o
                                conteúdo do miniplayer realmente não
                                couber, preferimos uma rolagem nativa
                                a cortar informação silenciosamente.
                            */
                            overflow: auto;
                        }

                        body {
                            --accent: #f0444b;
                            --accent-soft: #e86161;
                            --background-start: #742a31;
                            --background-middle: #4b252a;
                            --background-end: #202126;
                            --session-color: #f0444b;

                            display: flex;
                            align-items: stretch;
                            justify-content: stretch;

                            background: #17181d;
                            color: #f8f8f8;

                            font-family:
                                Inter,
                                ui-sans-serif,
                                system-ui,
                                -apple-system,
                                BlinkMacSystemFont,
                                "Segoe UI",
                                Arial,
                                sans-serif;

                            transition:
                                --accent 0.6s ease,
                                --accent-soft 0.6s ease,
                                --background-start 0.6s ease,
                                --background-middle 0.6s ease,
                                --background-end 0.6s ease,
                                --session-color 0.4s ease;
                        }

                        button {
                            font: inherit;
                        }

                        #modern-app {
                            position: relative;

                            width: 100%;
                            height: 100%;
                            min-width: 0;
                            min-height: 0;

                            padding:
                                clamp(9px, 2.4vw, 16px);

                            display: grid;

                            grid-template-columns:
                                auto 1fr auto;

                            grid-template-areas:
                                "status status extend"
                                "timer  timer  timer"
                                "dots   dots   dots"
                                "info   info   info"
                                "action action action";

                            align-content: center;
                            justify-items: stretch;

                            gap:
                                clamp(5px, 1.4vh, 10px);

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.14);

                            border-radius:
                                clamp(12px, 3vw, 18px);

                            background:
                                radial-gradient(
                                    circle at 50% 0%,
                                    color-mix(
                                        in srgb,
                                        var(--accent) 15%,
                                        transparent
                                    ),
                                    transparent 36%
                                ),
                                linear-gradient(
                                    145deg,
                                    var(--background-start) 0%,
                                    var(--background-middle) 48%,
                                    var(--background-end) 100%
                                );

                            box-shadow:
                                inset 0 1px 0
                                rgba(255, 255, 255, 0.06),
                                0 22px 46px
                                rgba(0, 0, 0, 0.32);

                            /*
                                overflow:clip (não "hidden"): corta
                                sem nunca criar barra de rolagem, mas
                                só entra em ação se o dimensionamento
                                abaixo falhar por arredondamento — o
                                objetivo é que o conteúdo caiba de
                                verdade, não depender disto.
                            */
                            overflow: clip;
                        }

                        #status-dot {
                            position: relative;

                            width: 7px;
                            height: 7px;
                            flex: 0 0 auto;

                            border-radius: 50%;
                            background: var(--session-color);

                            opacity: 0.55;

                            transition:
                                background 0.4s ease,
                                opacity 0.3s ease;
                        }

                        #status-dot.is-running,
                        #status-dot.is-paused {
                            opacity: 1;
                        }

                        #status-dot.is-running::after {
                            content: "";

                            position: absolute;
                            inset: -4px;

                            border-radius: 50%;
                            background: var(--session-color);
                            opacity: 0.55;

                            animation:
                                status-pulse 1.6s ease-out infinite;
                        }

                        @keyframes status-pulse {
                            0% {
                                transform: scale(0.6);
                                opacity: 0.55;
                            }

                            100% {
                                transform: scale(2.4);
                                opacity: 0;
                            }
                        }

                        .main-row {
                            display: contents;
                        }

                        .timer-left {
                            display: contents;
                        }

                        .status-pill {
                            grid-area: status;

                            align-self: center;
                            justify-self: start;

                            display: flex;
                            align-items: center;

                            gap: 6px;

                            min-width: 0;
                        }

                        #mode-title {
                            min-width: 0;
                            font-weight: 700;

                            /*
                                O texto do status nunca deve truncar
                                com reticências — se precisar de mais
                                espaço, os breakpoints reduzem fonte/
                                padding em vez de cortar.
                            */
                            overflow: visible;
                            text-overflow: clip;
                            white-space: nowrap;
                        }

                        #extend-button {
                            grid-area: extend;

                            align-self: center;
                            justify-self: end;

                            flex: 0 0 auto;

                            width:
                                clamp(
                                    24px,
                                    min(7vw, 7vh),
                                    32px
                                );

                            height:
                                clamp(
                                    24px,
                                    min(7vw, 7vh),
                                    32px
                                );

                            padding: 0;

                            display: flex;
                            align-items: center;
                            justify-content: center;

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.5);

                            border-radius: 50%;

                            background:
                                rgba(255, 255, 255, 0.04);

                            color: #f8f8f8;

                            cursor: pointer;

                            transition:
                                background-color 0.2s ease,
                                border-color 0.2s ease,
                                transform 0.15s ease;
                        }

                        #extend-button svg {
                            width: 46%;
                            height: 46%;
                            display: block;
                        }

                        #extend-button:hover {
                            background:
                                rgba(255, 255, 255, 0.14);

                            border-color:
                                rgba(255, 255, 255, 0.8);
                        }

                        #extend-button:active {
                            transform: scale(0.9);
                        }

                        .timer-row {
                            grid-area: timer;

                            width: 100%;
                            min-width: 0;

                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }

                        .timer-group {
                            /*
                                Fonte única da verdade para o tamanho
                                do relógio: #clock e .timer-icon
                                derivam desta mesma variável (via
                                calc() abaixo), então nunca mais
                                dessincronizam entre si — cada
                                breakpoint só precisa redefinir este
                                um valor.
                            */
                            --timer-font-size:
                                clamp(
                                    42px,
                                    min(18vw, 29vh),
                                    112px
                                );

                            display: inline-flex;
                            align-items: center;
                            justify-content: center;

                            gap:
                                clamp(6px, 2vw, 14px);

                            min-width: 0;
                            max-width: 100%;
                        }

                        .timer-icon {
                            flex: 0 0 auto;

                            display: block;

                            width:
                                calc(
                                    var(--timer-font-size) * 0.6
                                );

                            height:
                                calc(
                                    var(--timer-font-size) * 0.6
                                );

                            color: var(--accent-soft);

                            transition: color 0.6s ease;
                        }

                        .timer-icon svg {
                            width: 100%;
                            height: 100%;
                            display: block;
                        }

                        #clock {
                            min-width: 0;
                            max-width: 100%;

                            margin: 0;
                            padding: 0;

                            color: #ffffff;

                            font-size: var(--timer-font-size);

                            font-weight: 700;
                            line-height: 0.92;

                            letter-spacing: -0.055em;

                            font-variant-numeric:
                                tabular-nums;

                            white-space: nowrap;

                            overflow: hidden;
                            text-overflow: clip;

                            text-shadow:
                                0 8px 26px
                                rgba(0, 0, 0, 0.28);
                        }

                        .carousel-dots {
                            grid-area: dots;

                            min-height: 8px;

                            display: flex;
                            align-items: center;
                            justify-content: center;

                            gap: 8px;
                        }

                        .carousel-dot {
                            width: 8px;
                            height: 8px;

                            padding: 0;
                            border: none;
                            border-radius: 50%;

                            background:
                                rgba(255, 255, 255, 0.16);

                            cursor: pointer;

                            transition:
                                background-color 0.4s ease,
                                transform 0.4s ease;
                        }

                        .carousel-dot.active {
                            background: var(--accent);
                            transform: scale(1.18);
                        }

                        .carousel {
                            grid-area: info;

                            position: relative;

                            width: 100%;
                            min-width: 0;

                            min-height:
                                clamp(30px, 8vh, 38px);
                        }

                        .carousel-slide {
                            position: absolute;
                            inset: 0;

                            opacity: 0;
                            transform: translateX(10px);
                            pointer-events: none;

                            transition:
                                opacity 0.35s ease,
                                transform 0.35s ease;
                        }

                        .carousel-slide.active {
                            opacity: 1;
                            transform: translateX(0);
                            pointer-events: auto;
                        }

                        .task-chip {
                            min-width: 0;

                            min-height:
                                clamp(30px, 8vh, 38px);

                            padding:
                                0
                                clamp(8px, 2vw, 12px);

                            display: flex;
                            align-items: center;

                            gap: 7px;

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.12);

                            border-radius:
                                clamp(9px, 2.5vw, 12px);

                            background:
                                rgba(255, 255, 255, 0.055);

                            backdrop-filter: blur(6px);

                            overflow: hidden;
                        }

                        .chip-icon {
                            width:
                                clamp(13px, 3.5vw, 17px);

                            height:
                                clamp(13px, 3.5vw, 17px);

                            flex: 0 0 auto;

                            color: var(--accent-soft);

                            transition: color 0.6s ease;
                        }

                        .chip-icon svg {
                            width: 100%;
                            height: 100%;
                            display: block;
                        }

                        .chip-label {
                            flex: 0 0 auto;

                            color: var(--accent-soft);

                            font-size:
                                clamp(
                                    8px,
                                    min(2.5vw, 2.5vh),
                                    11px
                                );

                            font-weight: 700;
                            white-space: nowrap;

                            transition: color 0.6s ease;
                        }

                        .chip-value {
                            min-width: 0;

                            color: #f8f8f8;

                            font-size:
                                clamp(
                                    8px,
                                    min(2.5vw, 2.5vh),
                                    11px
                                );

                            font-weight: 500;

                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }

                        .chip-expand {
                            width:
                                clamp(14px, 3.5vw, 17px);

                            height:
                                clamp(14px, 3.5vw, 17px);

                            flex: 0 0 auto;
                            margin-left: auto;

                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 0;

                            border: none;
                            background: transparent;

                            color: var(--accent-soft);
                            cursor: pointer;

                            transition:
                                color 0.2s ease,
                                transform 0.15s ease;
                        }

                        .chip-expand:hover {
                            color: #ffffff;
                            transform: scale(1.12);
                        }

                        .chip-expand svg {
                            width: 100%;
                            height: 100%;
                            display: block;
                        }

                        #description-slide {
                            cursor: pointer;

                            transition:
                                background-color 0.2s ease;
                        }

                        #description-slide:hover,
                        #description-slide:focus-visible {
                            background:
                                rgba(255, 255, 255, 0.09);
                        }

                        .description-panel {
                            grid-area: panel;

                            display: none;
                            flex-direction: column;

                            flex: 1 1 auto;
                            min-height: 0;

                            gap: 8px;
                        }

                        /*
                            286x342 (tamanho fixo da descrição
                            expandida) sempre cai na faixa
                            ultracompacta por largura, então
                            #modern-app já está em display:flex;
                            flex-direction:column (regra do
                            ultracompacto). .main-row e
                            .description-panel só precisam se
                            comportar como os dois itens flex dessa
                            coluna: main-row mostra apenas o
                            .timer-row (ainda visível) centralizado,
                            e o painel cresce (flex:1 1 auto) para
                            ocupar o resto.
                        */
                        body.is-description-open
                        .description-panel {
                            display: flex;
                        }

                        body.is-description-open
                        .status-pill,
                        body.is-description-open
                        #extend-button,
                        body.is-description-open
                        .carousel-dots,
                        body.is-description-open
                        .carousel,
                        body.is-description-open
                        #main-button {
                            display: none;
                        }

                        body.is-description-open
                        .timer-group {
                            --timer-font-size:
                                clamp(32px, 10vw, 56px);
                        }

                        .description-panel-header {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;

                            gap: 10px;

                            color: var(--accent-soft);

                            font-size: 11px;
                            font-weight: 700;
                            letter-spacing: 0.08em;
                            text-transform: uppercase;
                        }

                        .modal-close {
                            width: 24px;
                            height: 24px;
                            flex: 0 0 auto;

                            display: flex;
                            align-items: center;
                            justify-content: center;

                            border: none;
                            border-radius: 50%;

                            background:
                                rgba(255, 255, 255, 0.06);

                            color: #f8f8f8;
                            cursor: pointer;

                            transition:
                                background-color 0.2s ease;
                        }

                        .modal-close:hover {
                            background:
                                rgba(255, 255, 255, 0.16);
                        }

                        .modal-close svg {
                            width: 55%;
                            height: 55%;
                            display: block;
                        }

                        .description-panel-body {
                            flex: 1 1 auto;
                            min-height: 0;

                            padding: 10px 12px;
                            overflow-y: auto;

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.12);

                            border-radius:
                                clamp(9px, 2.5vw, 12px);

                            background:
                                rgba(255, 255, 255, 0.055);

                            backdrop-filter: blur(6px);

                            color: #f8f8f8;

                            font-size: 13px;
                            line-height: 1.5;

                            white-space: pre-wrap;
                            word-break: break-word;
                        }

                        #main-button {
                            grid-area: action;

                            width:
                                min(100%, 300px);

                            min-height:
                                clamp(45px, 13vh, 58px);

                            margin-inline: auto;

                            padding:
                                0
                                18px;

                            display: flex;
                            align-items: center;
                            justify-content: center;

                            gap: 10px;

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.14);

                            border-radius:
                                clamp(9px, 2.5vw, 12px);

                            background:
                                linear-gradient(
                                    135deg,
                                    var(--accent),
                                    var(--accent-soft)
                                );

                            color: #ffffff;

                            font-size:
                                clamp(
                                    15px,
                                    min(4vw, 4vh),
                                    19px
                                );

                            font-weight: 700;
                            cursor: pointer;

                            box-shadow:
                                0 13px 28px
                                rgba(0, 0, 0, 0.26);

                            transition:
                                background 0.6s ease,
                                box-shadow 0.2s ease,
                                filter 0.2s ease,
                                transform 0.15s ease;
                        }

                        #main-button:hover {
                            filter: brightness(1.07);

                            box-shadow:
                                0 16px 32px
                                rgba(0, 0, 0, 0.32);

                            transform: translateY(-1px);
                        }

                        #main-button:active {
                            transform:
                                translateY(1px)
                                scale(0.992);
                        }

                        #main-icon {
                            width:
                                clamp(17px, 4.5vw, 22px);

                            height:
                                clamp(17px, 4.5vw, 22px);

                            display: block;
                            flex: 0 0 auto;
                        }

                        #main-icon svg {
                            width: 100%;
                            height: 100%;
                            display: block;
                        }

                        #message {
                            position: absolute;
                            left: 50%;
                            bottom:
                                clamp(7px, 2vh, 12px);

                            max-width:
                                calc(100% - 24px);

                            padding:
                                7px
                                10px;

                            border:
                                1px solid
                                rgba(255, 255, 255, 0.16);

                            border-radius: 8px;

                            background:
                                rgba(17, 18, 22, 0.86);

                            backdrop-filter: blur(10px);

                            color: #f8f8f8;

                            font-size: 11px;
                            text-align: center;

                            opacity: 0;
                            pointer-events: none;

                            transform:
                                translate(-50%, 7px);

                            transition:
                                opacity 0.25s
                                cubic-bezier(0.16, 1, 0.3, 1),
                                transform 0.25s
                                cubic-bezier(0.16, 1, 0.3, 1);
                        }

                        #message.visible {
                            opacity: 1;

                            transform:
                                translate(-50%, 0);
                        }

                        button:focus-visible {
                            outline:
                                2px solid
                                #ffffff;

                            outline-offset: 2px;
                        }

                        /*
                            Modo compacto: largura <=420px OU
                            altura <=180px.
                        */
                        @media
                            (max-width: 420px),
                            (max-height: 180px) {
                            #modern-app {
                                /*
                                    padding e gap eram valores fixos
                                    (9px/6px) — não encolhiam conforme
                                    a altura caía em direção aos
                                    130px. Isso, somado ao min-height
                                    fixo do botão principal (ver
                                    abaixo), fazia o conteúdo estourar
                                    a janela em ~120-160px de altura
                                    (testado com Playwright em
                                    diversas combinações de largura x
                                    altura — chegava a cortar 10px dos
                                    botões de cima/baixo). Agora ambos
                                    escalam com vh.
                                */
                                padding:
                                    clamp(5px, 3vh, 9px);

                                gap:
                                    clamp(3px, 3vh, 6px);
                            }

                            .timer-group {
                                --timer-font-size:
                                    clamp(
                                        26px,
                                        min(19vw, 24vh),
                                        68px
                                    );
                            }

                            .carousel,
                            .task-chip {
                                min-height:
                                    clamp(20px, 7vh, 34px);
                            }

                            .task-chip {
                                padding:
                                    0
                                    7px;

                                gap: 5px;
                            }

                            .chip-label {
                                display: none;
                            }

                            #main-button {
                                min-height:
                                    clamp(28px, 20vh, 40px);
                            }
                        }

                        /*
                            Ultracompacto: largura <=300px OU altura
                            <=130px (cobre o tamanho padrão de
                            abertura, 240x117 — este é o modo
                            "normal" do miniplayer, não um caso raro).

                            #modern-app vira flex-column simples com
                            só 2 linhas: .main-row (status + play +
                            relógio + "+", um grupo flex único
                            centralizado como bloco — justify-
                            content:center garante margens laterais
                            iguais dos dois lados, em vez do grid
                            1fr/auto/1fr anterior, que dava mais folga
                            de um lado por causa da assimetria de
                            conteúdo entre os flancos) e .carousel
                            (categoria + descrição lado a lado, sem
                            alternância — ver JS: o intervalo do
                            carrossel é pausado neste tamanho).
                        */
                        @media
                            (max-width: 300px),
                            (max-height: 130px) {
                            #modern-app {
                                display: flex;
                                flex-direction: column;
                                justify-content: center;

                                padding: 3px;

                                gap: 4px;
                            }

                            /*
                                Grid de 3 colunas com os dois flancos
                                na MESMA largura mínima
                                (minmax(70px,1fr) nos dois lados, não
                                "auto"): isso é o que garante o
                                relógio no centro geométrico real da
                                linha, e não apenas no espaço que
                                sobra entre os controles — mesmo o
                                grupo esquerdo (estado + play) sendo
                                visualmente mais "pesado" que o botão
                                "+" sozinho à direita, as duas colunas
                                sempre ocupam a mesma largura.
                            */
                            .main-row {
                                display: grid;

                                grid-template-columns:
                                    minmax(70px, 1fr)
                                    auto
                                    minmax(70px, 1fr);

                                grid-template-areas:
                                    "left center right";

                                align-items: center;

                                column-gap: 2px;

                                width: 100%;
                                min-width: 0;
                            }

                            .timer-left {
                                grid-area: left;
                                justify-self: start;

                                display: flex;
                                align-items: center;

                                gap: 3px;

                                min-width: 0;
                            }

                            .status-pill {
                                width: auto;
                                min-width: max-content;
                                max-width: none;
                                flex: 0 0 auto;

                                padding: 2px 4px;
                                border-radius: 8px;

                                gap: 3px;

                                background:
                                    rgba(255, 255, 255, 0.06);
                            }

                            #mode-title {
                                font-size:
                                    clamp(8px, 3.6vw, 10px);
                            }

                            #status-dot {
                                width: 6px;
                                height: 6px;
                            }

                            #main-button {
                                flex: 0 0 auto;

                                width: 18px;
                                min-height: 18px;

                                padding: 0;
                                gap: 0;

                                border-radius: 50%;
                            }

                            #main-label {
                                display: none;
                            }

                            #main-icon {
                                width: 11px;
                                height: 11px;
                            }

                            .timer-row {
                                grid-area: center;
                                justify-self: center;

                                width: auto;
                                min-width: 0;
                            }

                            .timer-group {
                                /*
                                    Ícone amarrado ao tamanho da fonte
                                    do relógio via calc() (ver regra
                                    base de .timer-icon) — os dois
                                    crescem juntos em vez de usarem
                                    clamp()s afinados separadamente,
                                    que era a causa do ícone ficar
                                    pequeno demais.
                                */
                                --timer-font-size:
                                    clamp(
                                        18px,
                                        min(9vw, 20vh),
                                        23px
                                    );

                                gap: 3px;
                            }

                            #extend-button {
                                grid-area: right;
                                justify-self: end;

                                width: 18px;
                                height: 18px;
                            }

                            .carousel-dots {
                                display: none;
                            }

                            /*
                                Carrossel desligado: as duas fichas
                                ficam lado a lado, sempre visíveis,
                                em vez de alternar por slide.
                                Categoria ~40%, Descrição ~60%, com
                                fonte bem maior que antes para leitura
                                rápida.
                            */
                            .carousel {
                                display: flex;
                                align-items: stretch;

                                gap: 5px;

                                width: 100%;
                                min-width: 0;

                                min-height: 26px;
                            }

                            .carousel-slide {
                                position: static;

                                opacity: 1;
                                transform: none;
                                pointer-events: auto;

                                min-width: 0;
                            }

                            .carousel-slide[data-index="0"] {
                                flex: 0 0 40%;
                            }

                            .carousel-slide[data-index="1"] {
                                flex: 1 1 60%;
                            }

                            .task-chip {
                                padding: 3px 6px;
                                gap: 5px;
                            }

                            .chip-icon,
                            .chip-expand {
                                width: 12px;
                                height: 12px;
                            }

                            .chip-value {
                                font-size:
                                    clamp(10px, 4.5vw, 12px);
                            }
                        }

                        /*
                            Rede de segurança: larguras bem abaixo dos
                            ~240px validados. O grupo principal pode
                            quebrar em duas linhas em vez de espremer
                            ou cortar algo.
                        */
                        @media (max-width: 200px) {
                            .main-row {
                                grid-template-columns:
                                    minmax(56px, 1fr)
                                    auto
                                    minmax(56px, 1fr);
                            }

                            .timer-left {
                                flex-wrap: wrap;

                                row-gap: 2px;
                            }
                        }

                        @media (prefers-reduced-motion: reduce) {
                            * {
                                animation-duration: 0.001ms !important;
                                transition-duration: 0.001ms !important;
                            }
                        }
                    </style>
                </head>

                <body>
                    <main id="modern-app">
                        <div class="main-row">
                            <div class="timer-left">
                                <span class="status-pill">
                                    <span
                                        id="status-dot"
                                        aria-hidden="true"
                                    ></span>

                                    <span
                                        id="mode-title"
                                        class="chip-value"
                                    >
                                        Em foco
                                    </span>
                                </span>

                                <button
                                    id="main-button"
                                    type="button"
                                >
                                    <span id="main-icon">
                                        ${iconSvg('play')}
                                    </span>

                                    <span id="main-label">
                                        Iniciar
                                    </span>
                                </button>
                            </div>

                            <div class="timer-row">
                                <div class="timer-group">
                                    <span
                                        class="timer-icon"
                                        aria-hidden="true"
                                    >
                                        ${iconSvg('timer')}
                                    </span>

                                    <div
                                        id="clock"
                                        aria-live="polite"
                                    >
                                        00:00
                                    </div>
                                </div>
                            </div>

                            <button
                                id="extend-button"
                                type="button"
                                aria-label="Prolongar o tempo"
                                title="Prolongar o tempo"
                            >
                                ${iconSvg('plus')}
                            </button>
                        </div>

                        <div
                            class="carousel-dots"
                            id="carousel-dots"
                        >
                            <button
                                class="carousel-dot active"
                                type="button"
                                data-index="0"
                                aria-label="Mostrar categoria"
                            ></button>

                            <button
                                class="carousel-dot"
                                type="button"
                                data-index="1"
                                aria-label="Mostrar descrição"
                            ></button>
                        </div>

                        <div
                            class="carousel"
                            id="info-carousel"
                        >
                            <div
                                class="task-chip carousel-slide active"
                                data-index="0"
                                title="Categoria atual"
                            >
                                <span class="chip-icon">
                                    ${iconSvg('tag')}
                                </span>

                                <span class="chip-label">
                                    Categoria:
                                </span>

                                <span
                                    id="category"
                                    class="chip-value"
                                >
                                    Sem categoria
                                </span>
                            </div>

                            <div
                                class="task-chip carousel-slide"
                                data-index="1"
                                title="Descrição atual — clique para expandir"
                                id="description-slide"
                                role="button"
                                tabindex="0"
                                aria-label="Ver descrição completa"
                            >
                                <span class="chip-icon">
                                    ${iconSvg('document')}
                                </span>

                                <span class="chip-label">
                                    Descrição:
                                </span>

                                <span
                                    id="description"
                                    class="chip-value"
                                >
                                    Sem descrição
                                </span>

                                <span
                                    class="chip-expand"
                                    aria-hidden="true"
                                >
                                    ${iconSvg('expand')}
                                </span>
                            </div>
                        </div>

                        <div
                            class="description-panel"
                            id="description-panel"
                        >
                            <div class="description-panel-header">
                                <span>Descrição</span>

                                <button
                                    id="description-panel-close"
                                    type="button"
                                    class="modal-close"
                                    aria-label="Fechar"
                                    title="Fechar"
                                >
                                    ${iconSvg('close')}
                                </button>
                            </div>

                            <div
                                id="description-panel-body"
                                class="description-panel-body"
                            ></div>
                        </div>

                        <div
                            id="message"
                            role="status"
                        ></div>
                    </main>
                </body>
            </html>
        `);

        targetDocument.close();

        targetDocument
            .getElementById('main-button')
            ?.addEventListener(
                'click',
                performMainAction
            );

        targetDocument
            .getElementById('extend-button')
            ?.addEventListener(
                'click',
                performExtendAction
            );

        targetDocument
            .getElementById('description-slide')
            ?.addEventListener('click', () => {
                toggleDescriptionExpansion(
                    targetDocument
                );
            });

        targetDocument
            .getElementById('description-slide')
            ?.addEventListener('keydown', (event) => {
                if (
                    event.key === 'Enter' ||
                    event.key === ' '
                ) {
                    event.preventDefault();

                    toggleDescriptionExpansion(
                        targetDocument
                    );
                }
            });

        targetDocument
            .getElementById('description-panel-close')
            ?.addEventListener('click', () => {
                if (isDescriptionExpanded) {
                    toggleDescriptionExpansion(
                        targetDocument
                    );
                }
            });

        targetDocument.addEventListener(
            'keydown',
            (event) => {
                if (
                    event.key === 'Escape' &&
                    isDescriptionExpanded
                ) {
                    toggleDescriptionExpansion(
                        targetDocument
                    );
                }
            }
        );

        targetDocument
            .querySelectorAll('.carousel-dot')
            .forEach((dot, index) => {
                dot.addEventListener('click', () => {
                    goToSlide(targetDocument, index);
                    restartCarousel(targetDocument);
                });
            });

        const carouselElement =
            targetDocument.getElementById(
                'info-carousel'
            );

        let touchStartX = null;

        carouselElement?.addEventListener(
            'touchstart',
            (event) => {
                touchStartX =
                    event.touches[0]?.clientX ??
                    null;
            },
            { passive: true }
        );

        carouselElement?.addEventListener(
            'touchend',
            (event) => {
                if (touchStartX === null) {
                    return;
                }

                const endX =
                    event.changedTouches[0]
                        ?.clientX ?? touchStartX;

                const deltaX =
                    endX - touchStartX;

                touchStartX = null;

                if (Math.abs(deltaX) < 30) {
                    return;
                }

                goToSlide(
                    targetDocument,
                    carouselIndex +
                        (deltaX < 0 ? 1 : -1)
                );

                restartCarousel(targetDocument);
            }
        );
    }

    function animateWindowResize(
        fromWidth,
        fromHeight,
        toWidth,
        toHeight,
        durationMs
    ) {
        return new Promise((resolve) => {
            if (
                !pipWindow ||
                pipWindow.closed ||
                typeof pipWindow.resizeTo !==
                    'function'
            ) {
                resolve();
                return;
            }

            const start = performance.now();

            const step = (now) => {
                if (!pipWindow || pipWindow.closed) {
                    resolve();
                    return;
                }

                const elapsed = now - start;

                const t = Math.min(
                    1,
                    elapsed / durationMs
                );

                // ease-out cubic
                const eased =
                    1 - Math.pow(1 - t, 3);

                const width = Math.round(
                    fromWidth +
                        (toWidth - fromWidth) *
                            eased
                );

                const height = Math.round(
                    fromHeight +
                        (toHeight - fromHeight) *
                            eased
                );

                try {
                    pipWindow.resizeTo(
                        width,
                        height
                    );
                } catch (error) {
                    // Redimensionar a janela PiP via script pode não
                    // ser permitido em todo navegador. O painel
                    // interno já anima via CSS independentemente
                    // disso, então apenas paramos aqui.
                    resolve();
                    return;
                }

                if (t < 1) {
                    window.requestAnimationFrame(
                        step
                    );
                } else {
                    resolve();
                }
            };

            window.requestAnimationFrame(step);
        });
    }

    async function toggleDescriptionExpansion(
        targetDocument
    ) {
        if (
            isExpandAnimating ||
            !pipWindow ||
            pipWindow.closed
        ) {
            return;
        }

        const body = targetDocument.body;

        isExpandAnimating = true;

        if (!isDescriptionExpanded) {
            compactWindowSize = {
                width: pipWindow.innerWidth,
                height: pipWindow.innerHeight
            };

            const panelBody =
                targetDocument.getElementById(
                    'description-panel-body'
                );

            if (panelBody) {
                panelBody.textContent =
                    getTaskData().description;
            }

            isDescriptionExpanded = true;

            body?.classList.add(
                'is-description-open'
            );

            await animateWindowResize(
                compactWindowSize.width,
                compactWindowSize.height,
                CONFIG.expandedWidth,
                CONFIG.expandedHeight,
                CONFIG.resizeAnimationMs
            );
        } else {
            isDescriptionExpanded = false;

            body?.classList.remove(
                'is-description-open'
            );

            const target =
                compactWindowSize || {
                    width: CONFIG.pipWidth,
                    height: CONFIG.pipHeight
                };

            await animateWindowResize(
                pipWindow.innerWidth,
                pipWindow.innerHeight,
                target.width,
                target.height,
                CONFIG.resizeAnimationMs
            );
        }

        isExpandAnimating = false;
    }

    function showMessage(message) {
        if (
            !pipWindow ||
            pipWindow.closed
        ) {
            return;
        }

        const element =
            pipWindow.document
                .getElementById('message');

        if (!element) {
            return;
        }

        window.clearTimeout(
            messageTimeout
        );

        element.textContent = message;
        element.classList.add('visible');

        messageTimeout =
            window.setTimeout(() => {
                if (
                    !pipWindow ||
                    pipWindow.closed
                ) {
                    return;
                }

                element.classList.remove(
                    'visible'
                );
            }, 2600);
    }

    function updatePip() {
        if (
            !pipWindow ||
            pipWindow.closed
        ) {
            return;
        }

        const targetDocument =
            pipWindow.document;

        const mode = getMode();
        const theme = CONFIG.theme[mode];
        const task = getTaskData();
        const main = getMainPresentation();
        const status = getStatus();
        const session = getSessionState();

        const body = targetDocument.body;

        body?.style.setProperty(
            '--session-color',
            session.color
        );

        body?.style.setProperty(
            '--accent',
            theme.accent
        );

        body?.style.setProperty(
            '--accent-soft',
            theme.accentSoft
        );

        body?.style.setProperty(
            '--background-start',
            theme.start
        );

        body?.style.setProperty(
            '--background-middle',
            theme.middle
        );

        body?.style.setProperty(
            '--background-end',
            theme.end
        );

        const title =
            targetDocument.getElementById(
                'mode-title'
            );

        const statusDot =
            targetDocument.getElementById(
                'status-dot'
            );

        const clock =
            targetDocument.getElementById(
                'clock'
            );

        const category =
            targetDocument.getElementById(
                'category'
            );

        const description =
            targetDocument.getElementById(
                'description'
            );

        const mainLabel =
            targetDocument.getElementById(
                'main-label'
            );

        const mainIcon =
            targetDocument.getElementById(
                'main-icon'
            );

        if (title) {
            title.textContent = session.label;
        }

        if (statusDot) {
            statusDot.classList.toggle(
                'is-running',
                status === 'running'
            );

            statusDot.classList.toggle(
                'is-paused',
                status === 'paused'
            );
        }

        if (clock) {
            clock.textContent = getTimerText();
        }

        if (category) {
            category.textContent =
                task.category;

            category.title =
                task.category;
        }

        if (description) {
            description.textContent =
                task.description;

            description.title =
                task.description;
        }

        if (isDescriptionExpanded) {
            const panelBody =
                targetDocument.getElementById(
                    'description-panel-body'
                );

            if (panelBody) {
                panelBody.textContent =
                    task.description;
            }
        }

        if (mainLabel) {
            mainLabel.textContent =
                main.label;
        }

        if (mainIcon) {
            mainIcon.innerHTML =
                iconSvg(main.icon);
        }
    }

    function goToSlide(targetDocument, index) {
        const slides = [
            ...targetDocument.querySelectorAll(
                '.carousel-slide'
            )
        ];

        const dots = [
            ...targetDocument.querySelectorAll(
                '.carousel-dot'
            )
        ];

        if (!slides.length) {
            return;
        }

        carouselIndex =
            ((index % slides.length) +
                slides.length) %
            slides.length;

        slides.forEach((slide, i) => {
            slide.classList.toggle(
                'active',
                i === carouselIndex
            );
        });

        dots.forEach((dot, i) => {
            dot.classList.toggle(
                'active',
                i === carouselIndex
            );
        });
    }

    function restartCarousel(targetDocument) {
        window.clearInterval(
            carouselInterval
        );

        carouselInterval =
            window.setInterval(() => {
                goToSlide(
                    targetDocument,
                    carouselIndex + 1
                );
            }, 3500);
    }

    function startCarousel(targetDocument) {
        stopCarousel();
        goToSlide(targetDocument, 0);
        restartCarousel(targetDocument);
    }

    function stopCarousel() {
        if (carouselInterval) {
            window.clearInterval(
                carouselInterval
            );

            carouselInterval = null;
        }
    }

    function isUltracompactSize(win) {
        return (
            win.innerWidth <= 300 ||
            win.innerHeight <= 130
        );
    }

    function syncCarouselMode(targetDocument) {
        if (
            !pipWindow ||
            pipWindow.closed
        ) {
            return;
        }

        if (isUltracompactSize(pipWindow)) {
            // Categoria e Descrição ficam lado a lado no
            // ultracompacto (ver CSS); a alternância automática
            // não faz sentido nesse tamanho e só desperdiçaria
            // ciclos.
            stopCarousel();
        } else if (!carouselInterval) {
            startCarousel(targetDocument);
        }
    }

    function startSync() {
        stopSync();

        inputListener = (event) => {
            if (
                event.target?.matches?.(
                    'form.c-pomo input[data-test="pomo-category"], ' +
                    'form.c-pomo input[data-test="pomo-description"], ' +
                    'input[data-test="pomo-category"], ' +
                    'input[data-test="pomo-description"], ' +
                    'input[ref="category"], ' +
                    'input[ref="description"]'
                )
            ) {
                updatePip();
            }
        };

        document.addEventListener(
            'input',
            inputListener,
            true
        );

        document.addEventListener(
            'change',
            inputListener,
            true
        );

        document.addEventListener(
            'blur',
            inputListener,
            true
        );

        // O polling abaixo (CONFIG.updateRate, 200ms) já cobre o caso de
        // preenchimento programático que não dispara eventos input/change,
        // então nenhum intervalo adicional é necessário além deste.
        syncInterval =
            window.setInterval(
                updatePip,
                CONFIG.updateRate
            );

        updatePip();
    }

    function stopSync() {
        if (inputListener) {
            document.removeEventListener(
                'input',
                inputListener,
                true
            );

            document.removeEventListener(
                'change',
                inputListener,
                true
            );

            document.removeEventListener(
                'blur',
                inputListener,
                true
            );

            inputListener = null;
        }

        if (syncInterval) {
            window.clearInterval(
                syncInterval
            );

            syncInterval = null;
        }
    }

    function updateLaunchButton(open) {
        const button =
            document.getElementById(
                CONFIG.launchButtonId
            );

        if (!button) {
            return;
        }

        const label = button.querySelector(
            '.studiuns-pip-btn-label'
        );

        if (label) {
            label.textContent =
                open
                    ? 'Fechar cronômetro PiP'
                    : 'Abrir cronômetro em PiP';
        }

        button.dataset.open =
            String(open);
    }

    function handlePipClosed() {
        stopSync();
        stopCarousel();

        window.clearTimeout(
            messageTimeout
        );

        pipWindow = null;
        isDescriptionExpanded = false;
        isExpandAnimating = false;
        compactWindowSize = null;

        updateLaunchButton(false);
    }

    async function togglePip() {
        if (
            !(
                'documentPictureInPicture'
                in window
            )
        ) {
            alert(
                'A API Document Picture-in-Picture não está disponível.\n\n' +
                'Use uma versão atualizada do Google Chrome ou Microsoft Edge.'
            );

            return;
        }

        if (
            pipWindow &&
            !pipWindow.closed
        ) {
            pipWindow.close();
            return;
        }

        if (!findTimerRoot()) {
            alert(
                'O cronômetro do Pomodoro Tracker não foi encontrado.\n\n' +
                'Aguarde o carregamento da página e tente novamente.'
            );

            return;
        }

        try {
            pipWindow =
                await window
                    .documentPictureInPicture
                    .requestWindow({
                        width:
                            CONFIG.pipWidth,

                        height:
                            CONFIG.pipHeight
                    });

            createPipDocument(
                pipWindow.document
            );

            startSync();
            syncCarouselMode(pipWindow.document);
            updateLaunchButton(true);

            pipWindow.addEventListener(
                'resize',
                () => {
                    syncCarouselMode(
                        pipWindow.document
                    );
                }
            );

            pipWindow.addEventListener(
                'pagehide',
                handlePipClosed,
                {
                    once: true
                }
            );

            pipWindow.addEventListener(
                'unload',
                handlePipClosed,
                {
                    once: true
                }
            );
        } catch (error) {
            console.error(
                '[Pomodoro PiP] Erro:',
                error
            );

            handlePipClosed();

            alert(
                'Não foi possível abrir o Picture-in-Picture.\n\n' +
                (
                    error?.message ||
                    String(error)
                )
            );
        }
    }

    function removePreviousButtons() {
        [
            'studiuns-pomodoro-pip-button',
            'studiuns-minimal-pip-button',
            CONFIG.launchButtonId
        ].forEach((id) => {
            document
                .getElementById(id)
                ?.remove();
        });
    }

    function injectGlobalStyles() {
        if (
            document.getElementById(
                CONFIG.stylesId
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id = CONFIG.stylesId;

        style.textContent = `
            #${CONFIG.launchButtonId} {
                transition:
                    transform 0.15s ease,
                    box-shadow 0.2s ease,
                    filter 0.2s ease;
            }

            #${CONFIG.launchButtonId}:hover {
                transform: translateY(-2px);
                filter: brightness(1.06);

                box-shadow:
                    0 14px 32px rgba(0, 0, 0, 0.45);
            }

            #${CONFIG.launchButtonId}:active {
                transform: translateY(0) scale(0.97);
            }

            #${CONFIG.launchButtonId}:focus-visible {
                outline: 2px solid #ffffff;
                outline-offset: 2px;
            }

            .studiuns-pip-btn-icon {
                width: 18px;
                height: 18px;

                display: flex;
                flex: 0 0 auto;
            }

            .studiuns-pip-btn-icon svg {
                width: 100%;
                height: 100%;
                display: block;
            }
        `;

        document.head.appendChild(style);
    }

    function createLaunchButton() {
        if (
            document.getElementById(
                CONFIG.launchButtonId
            )
        ) {
            return;
        }

        removePreviousButtons();
        injectGlobalStyles();

        const button =
            document.createElement('button');

        button.id =
            CONFIG.launchButtonId;

        button.type = 'button';

        button.title =
            'Abrir cronômetro moderno em Picture-in-Picture';

        button.innerHTML = `
            <span class="studiuns-pip-btn-icon">
                ${iconSvg('timer')}
            </span>

            <span class="studiuns-pip-btn-label">
                Abrir cronômetro em PiP
            </span>
        `;

        Object.assign(
            button.style,
            {
                position: 'fixed',
                right: '20px',
                bottom: '20px',
                zIndex: '2147483647',

                minHeight: '46px',
                padding: '11px 17px',

                display: 'flex',
                alignItems: 'center',
                gap: '9px',

                border:
                    '1px solid rgba(255,255,255,.46)',

                borderRadius: '10px',

                background:
                    'linear-gradient(135deg,#f0444b,#e86161)',

                color: '#ffffff',

                fontFamily:
                    'Inter,Arial,sans-serif',

                fontSize: '14px',
                fontWeight: '700',

                cursor: 'pointer',

                boxShadow:
                    '0 9px 26px rgba(0,0,0,.38)'
            }
        );

        button.addEventListener(
            'click',
            togglePip
        );

        document.body.appendChild(button);
    }

    function initialize() {
        createLaunchButton();

        buttonObserver =
            new MutationObserver(() => {
                if (
                    !document.getElementById(
                        CONFIG.launchButtonId
                    )
                ) {
                    createLaunchButton();
                }
            });

        buttonObserver.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );

        window.addEventListener(
            'pagehide',
            () => {
                stopSync();

                buttonObserver?.disconnect();

                if (
                    pipWindow &&
                    !pipWindow.closed
                ) {
                    pipWindow.close();
                }
            }
        );

        console.info(
            `[Pomodoro PiP] Versão ${VERSION} carregada.`
        );
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }
})();
