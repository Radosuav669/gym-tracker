// Progress Tracking — weekly training volume chart
(function () {
    'use strict';

    let chartInstance = null;

    // ─── Initialization ──────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', () => {
        initTabNavigation();
        initProgressFilters();
    });

    function initTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');

                // Update active state on buttons
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Show/hide tab content
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    if (content.id === `tab-${targetTab}`) {
                        content.classList.add('active');
                    }
                });

                // When switching to progress tab, load data
                if (targetTab === 'progress') {
                    initProgressView();
                }
            });
        });
    }

    async function initProgressView() {
        setDefaultDateRange();
        await renderWeeklyVolume(await getCurrentUserId());
    }

    function initProgressFilters() {
        const fromInput = document.getElementById('progress-date-from');
        const toInput = document.getElementById('progress-date-to');

        if (fromInput) {
            fromInput.addEventListener('change', () => {
                updateDateDisplaySpan(fromInput);
                renderWeeklyVolume(getCurrentUserId());
            });
        }
        if (toInput) {
            toInput.addEventListener('change', () => {
                updateDateDisplaySpan(toInput);
                renderWeeklyVolume(getCurrentUserId());
            });
        }
    }

    // ─── Data Fetching ──────────────────────────────────────────────

    /** Fetches workout logs for a user within an optional date range */
    async function fetchWorkoutLogs(userId, dateFrom, dateTo) {
        if (!userId) return [];

        let query = supabaseClient
            .from('workout_logs')
            .select('workout_date, exercise_id, set_number, weight, reps_done, status')
            .eq('user_id', userId);

        if (dateFrom) query = query.gte('workout_date', dateFrom);
        if (dateTo) query = query.lte('workout_date', dateTo);

        const { data, error } = await query.order('workout_date', { ascending: true });
        if (error) { console.error(error); return []; }
        return data || [];
    }

    // ─── Date Format Helpers ────────────────────────────────────────

    /** Converts ISO date "YYYY-MM-DD" to display format "DD/MM/YYYY" */
    function formatDateDisplay(isoDate) {
        if (!isoDate) return '';
        const parts = isoDate.split('-');  // [YYYY, MM, DD]
        return `${parts[2]}/${parts[1]}/${parts[0]}`;  // dd/mm/yyyy
    }

    /** Updates the display span next to a hidden date input with formatted ISO value */
    function updateDateDisplaySpan(inputEl) {
        const spanId = inputEl.id + '-display';
        const span = document.getElementById(spanId);
        if (span && inputEl.value) {
            span.textContent = formatDateDisplay(inputEl.value);
        } else if (span) {
            span.textContent = 'dd/mm/yyyy';
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function setDefaultDateRange() {
        const dateFrom = document.getElementById('progress-date-from');
        const dateTo = document.getElementById('progress-date-to');

        // Set hidden inputs to ISO dates, display spans show dd/mm/yyyy
        const todayISO = new Date().toISOString().split('T')[0];
        if (dateTo) {
            dateTo.value = todayISO;
            updateDateDisplaySpan(dateTo);
        }

        // Default: last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        if (dateFrom) {
            dateFrom.value = sixMonthsAgo.toISOString().split('T')[0];
            updateDateDisplaySpan(dateFrom);
        }
    }

    // ─── Chart Rendering Utilities ─────────────────────────────────

    function getChartThemeColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            text: style.getPropertyValue('--text').trim() || '#ffffff',
            mutedText: style.getPropertyValue('--muted-text').trim() || '#888888',
            cardBg: style.getPropertyValue('--card-bg').trim() || '#232340',
            accent: style.getPropertyValue('--accent').trim() || '#007d89',
        };
    }

    function destroyChart() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    function createChart(type, data, options) {
        const canvas = document.getElementById('progress-chart');
        if (!canvas) return;

        destroyChart();
        const ctx = canvas.getContext('2d');
        const colors = getChartThemeColors();

        // Default config — override with provided options
        const defaultConfig = {
            type: type,
            data: data,
            options: Object.assign({
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: colors.text } },
                    tooltip: {
                        backgroundColor: colors.cardBg,
                        titleColor: colors.text,
                        bodyColor: colors.mutedText,
                        borderColor: colors.accent,
                        borderWidth: 1,
                    },
                },
                scales: Object.assign({
                    x: { ticks: { color: colors.mutedText }, grid: { color: `${colors.mutedText}22` } },
                    y: { ticks: { color: colors.mutedText }, grid: { color: `${colors.mutedText}33` } }
                }, (options && options.scales) || {}),
            }, (options && options.options) || {}),
        };

        chartInstance = new Chart(ctx, defaultConfig);
    }

    // ─── Weekly Volume Chart (all exercises aggregated per week) ─────

    async function renderWeeklyVolume(userId, dateFrom, dateTo) {
        const logs = await fetchWorkoutLogs(userId, dateFrom || '', dateTo || '');

        if (!logs.length) {
            createChart('bar', { labels: [], datasets: [] }, {
                options: { plugins: { title: { display: true, text: 'No data found' } } }
            });
            return;
        }

        // Group by date, compute total volume per session
        const dailyVolume = new Map();
        logs.forEach(log => {
            const vol = log.weight * log.reps_done;
            dailyVolume.set(log.workout_date, (dailyVolume.get(log.workout_date) || 0) + vol);
        });

        // Convert to week-based aggregation (ISO week starting Monday)
        const weeklyVolumes = new Map(); // weekKey -> [] of daily volumes
        dailyVolume.forEach((vol, dateStr) => {
            const weekKey = getISOWEEK(dateStr);
            if (!weeklyVolumes.has(weekKey)) weeklyVolumes.set(weekKey, []);
            weeklyVolumes.get(weekKey).push(vol);
        });

        // Sum volumes per week and sort by week
        const sortedWeeks = Array.from(weeklyVolumes.entries())
            .map(([key, vols]) => [key, vols.reduce((a, b) => a + b, 0)])
            .sort((a, b) => a[0].localeCompare(b[0]));

        // Format week labels nicely (e.g., "Week 23" or date range)
        const labels = sortedWeeks.map(([key]) => {
            const parts = key.split('-');
            return `W${parts[1]} (${parts[0]})`;
        });
        const values = sortedWeeks.map(([, val]) => Math.round(val));

        createChart('bar', {
            labels: labels,
            datasets: [{
                label: 'Volume (kg)',
                data: values,
                backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() + '88',
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
                borderWidth: 1,
                borderRadius: 4,
            }],
        }, {
            options: {
                plugins: {
                    title: { display: true, text: 'Total Volume per Workout', color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() },
                },
                scales: {
                    x: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted-text').trim() }, grid: { color: '#88888822' } },
                    y: { title: { display: true, text: 'kg', color: getComputedStyle(document.documentElement).getPropertyValue('--muted-text').trim() }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted-text').trim() }, grid: { color: '#88888833' } },
                },
            }
        });
    }

    // ─── Utility Functions ──────────────────────────────────────────

    function getCurrentUserId() {
        return supabaseClient.auth.getUser().then(r => r.data?.user?.id || null);
    }

    /** Returns ISO week key as "YYYY-Www" (e.g., "2025-W13") */
    function getISOWEEK(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        // Copy to avoid mutating original
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        // Set to nearest Thursday: current date + 4 - day
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const year = d.getUTCFullYear();
        const weekNo = Math.ceil(((+d - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
        return `${year}-W${String(weekNo).padStart(2, '0')}`;
    }

    // Expose public API for external use (e.g., refresh after saving a workout)
    window.refreshProgress = async function () {
        await initProgressView();
    };

    window.initProgressView = initProgressView;
})();
