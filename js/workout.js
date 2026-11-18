// Workout Logging and Rendering Logic
async function getCurrentUserId() {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) {
        console.error("Error fetching user:", error);
        return null;
    }
    return user.id;
}

function getISOWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Shift to the nearest Thursday: the Thursday of the current week determines the ISO year
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    // Count full weeks since the start of the ISO year
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

async function getWeekOption() {
    const today = new Date();
    const weekNumber = getISOWeekNumber(today);
    
    return (weekNumber % 2 !== 0) ? 'Odd' : 'Even';
}

async function loadTodayWorkout() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const todayName = days[now.getDay()];
    const weekOption = await getWeekOption();

    document.getElementById('day-select').value = todayName;
    document.getElementById('week-select').value = weekOption;

    await loadWorkoutData();
}

async function loadWorkoutData() {
    const userId = await getCurrentUserId();
    if (!userId) return;

    const selectedDay = document.getElementById('day-select').value;
    const selectedWeek = document.getElementById('week-select').value;

    const { data: exercises, error } = await supabaseClient
        .from('exercises')
        .select('*')
        .eq('user_id', userId)
        .eq('day', selectedDay)          
        .eq('week_option', selectedWeek)  
        .order('order_index', { ascending: true }); 

    if (error) {
        document.getElementById('workout-container').innerHTML = `<p>Error loading data: ${escapeHtml(error.message)}</p>`;
        return;
    }

    if (!exercises || exercises.length === 0) {
        document.getElementById('week-info').innerText = `Week: ${selectedWeek}`;
        document.getElementById('today-title').innerText = selectedDay;
        document.getElementById('workout-container').innerHTML = `
            <div class="card" style="text-align:center;">
                <h3>Rest day. No training plan</h3>
                <p>In database there are no exercises assigned for: <strong>${selectedDay} (${selectedWeek})</strong>.</p>
            </div>`;
        return;
    }

    const currentRoutine = exercises[0].routine_type || "Workout";
    document.getElementById('week-info').innerText = `Week: ${selectedWeek} | Routine: ${currentRoutine}`;
    document.getElementById('today-title').innerText = selectedDay;

    let html = '';
    exercises.forEach(ex => {
        html += `
            <div class="card exercise-card">
                <div class="exercise-header">
                    <h3>${escapeHtml(ex.exercise_name)}</h3>
                    <button class="btn-history" data-ex-id="${ex.id}" data-ex-name="${escapeHtml(ex.exercise_name)}" title="View history">⏱</button>
                </div>
                <p style="text-align:center; color:var(--muted-text); margin:0;">Target sets: ${ex.target_sets}x ${ex.target_reps}</p>
                <div id="history-${ex.id}" class="logged-indicator">Loading last result...</div>
                <div style="margin-top:10px;">
        `;

        for (let i = 1; i <= ex.target_sets; i++) {
            html += `
                <div class="series-row">
                    <span>Set ${i}</span>
                    <div class="series-inputs">
                        <input type="number" step="0.1" min="0" inputmode="decimal" id="w-${ex.id}-${i}" placeholder="kg">
                        <input type="number" min="1" step="1" inputmode="numeric" id="r-${ex.id}-${i}" placeholder="reps">
                    </div>
                    <div>
                        <button class="btn-save" data-ex="${ex.id}" data-set="${i}" data-target="${ex.target_reps}">Save</button>
                    </div>
                </div>
            `;
        }
        html += `</div></div>`;
    });

    document.getElementById('workout-container').innerHTML = html;
    attachWorkoutEventListeners();

    // Load last results only after the cards exist in the DOM
    exercises.forEach(ex => loadLastLoggedWorkout(ex.id));
}

// Event listener, for loading selected day-training to refresh view.
document.addEventListener('DOMContentLoaded', () => {
    const daySelect = document.getElementById('day-select');
    const weekSelect = document.getElementById('week-select');

    if (daySelect && weekSelect) {
        daySelect.addEventListener('change', loadWorkoutData);
        weekSelect.addEventListener('change', loadWorkoutData);
    }

    // History modal close button
    const historyModalClose = document.getElementById('history-modal-close');
    if (historyModalClose) {
        historyModalClose.addEventListener('click', closeExerciseHistory);
    }
});

// Global Event delegation or explicit binding for dynamically built rows
function attachWorkoutEventListeners() {
    const container = document.getElementById('workout-container');
    container.querySelectorAll('.btn-save').forEach(button => {
        button.addEventListener('click', (e) => {
            const exId = e.currentTarget.getAttribute('data-ex');
            const setNum = e.currentTarget.getAttribute('data-set');
            const targetReps = e.currentTarget.getAttribute('data-target');

            saveSeries(exId, setNum, targetReps, e.currentTarget);
        });
    });

    // History button handlers
    container.querySelectorAll('.btn-history').forEach(button => {
        button.addEventListener('click', (e) => {
            const exId = e.currentTarget.getAttribute('data-ex-id');
            const exName = e.currentTarget.getAttribute('data-ex-name');
            openExerciseHistory(exId, exName);
        });
    });
}

/**
 * Briefly shows the result of a save on the button itself ("Saved ✓" / "Failed ✗"),
 * then restores it. Avoids blocking alert() dialogs, which are annoying on phones.
 */
function flashSaveButton(button, ok, label) {
    if (!button) return;
    const originalText = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', originalText);

    button.textContent = label;
    button.classList.remove('saved', 'failed');
    button.classList.add(ok ? 'saved' : 'failed');
    button.disabled = true;

    setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('saved', 'failed');
        button.disabled = false;
    }, 1500);
}

async function saveSeries(exerciseId, setNum, targetRepsStr, button) {
    const weightEl = document.getElementById(`w-${exerciseId}-${setNum}`);
    const repsEl = document.getElementById(`r-${exerciseId}-${setNum}`);
    if (!weightEl || !repsEl) return;

    weightEl.classList.remove('input-error');
    repsEl.classList.remove('input-error');

    const weight = parseFloat(weightEl.value);
    const repsDone = parseInt(repsEl.value, 10);

    // Validate: highlight the offending fields instead of showing an alert
    const weightValid = Number.isFinite(weight) && weight >= 0;
    const repsValid = Number.isInteger(repsDone) && repsDone >= 1;
    if (!weightValid || !repsValid) {
        if (!weightValid) weightEl.classList.add('input-error');
        if (!repsValid) repsEl.classList.add('input-error');
        (weightValid ? repsEl : weightEl).focus();
        flashSaveButton(button, false, 'Check ✗');
        return;
    }

    // Lock the button while saving so a double tap cannot create duplicate rows
    if (button) button.disabled = true;

    const result = await persistSeries(exerciseId, setNum, targetRepsStr, weight, repsDone);

    if (result.ok) {
        flashSaveButton(button, true, 'Saved ✓');
        loadLastLoggedWorkout(exerciseId);
        if (typeof window.refreshProgress === 'function') window.refreshProgress();
    } else {
        console.error(result.message);
        if (button) button.title = result.message;
        flashSaveButton(button, false, 'Failed ✗');
    }
}

/** Inserts or updates today's log for a set. Returns { ok, message }. */
async function persistSeries(exerciseId, setNum, targetRepsStr, weight, repsDone) {
    const userId = await getCurrentUserId();
    if (!userId) return { ok: false, message: 'Not logged in.' };

    const minTarget = parseInt(String(targetRepsStr).split('-')[0], 10);
    const status = repsDone >= minTarget ? 'Success' : 'Fail';

    const todayDate = toLocalISODate();

    const { data: existingLog, error: fetchError } = await supabaseClient
        .from('workout_logs')
        .select('id')
        .eq('user_id', userId)
        .eq('workout_date', todayDate)
        .eq('exercise_id', exerciseId)
        .eq('set_number', setNum)
        .maybeSingle();

    if (fetchError) return { ok: false, message: 'Error checking history: ' + fetchError.message };

    if (existingLog) {
        const { error: updateError } = await supabaseClient
            .from('workout_logs')
            .update({ weight: weight, reps_done: repsDone, status: status })
            .eq('id', existingLog.id);

        if (updateError) return { ok: false, message: 'Could not update: ' + updateError.message };
    } else {
        const { error: insertError } = await supabaseClient
            .from('workout_logs')
            .insert([{
                user_id: userId,
                workout_date: todayDate,
                exercise_id: exerciseId,
                set_number: setNum,
                weight: weight,
                reps_done: repsDone,
                status: status
            }]);

        if (insertError) return { ok: false, message: 'Could not save: ' + insertError.message };
    }

    return { ok: true, message: '' };
}

async function loadLastLoggedWorkout(exerciseId) {
    // Fetch the sets of the most recent logged session (a single date) for the given exercise
    // and display them in the history div. Sets from older sessions are never mixed in.
    const historyDivId = `history-${exerciseId}`;

    const { data: latestRow, error: latestError } = await supabaseClient
        .from('workout_logs')
        .select('workout_date')
        .eq('exercise_id', exerciseId)
        .order('workout_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Look the element up after the await: the view may have been re-rendered meanwhile
    let historyDiv = document.getElementById(historyDivId);
    if (!historyDiv) return;

    if (latestError || !latestRow) {
        historyDiv.innerHTML = "No prior history for this exercise.";
        return;
    }

    const { data, error } = await supabaseClient
        .from('workout_logs')
        .select('workout_date, set_number, weight, reps_done, status')
        .eq('exercise_id', exerciseId)
        .eq('workout_date', latestRow.workout_date)
        .order('set_number', { ascending: true });

    historyDiv = document.getElementById(historyDivId);
    if (!historyDiv) return;

    if (error || !data || data.length === 0) {
        historyDiv.innerHTML = "No prior history for this exercise.";
        return;
    }

    const todayDate = toLocalISODate();

    let historyHTML = "";
    data.forEach(log => {
        const isToday = log.workout_date === todayDate;
        const color = isToday ? "var(--success)" : "var(--muted-text)";
        const icon = log.status === 'Success' ? '✅' : '❌';

        historyHTML += `<span style="color: ${color}; margin-right: 4px;">[${log.weight}kg x ${log.reps_done}${icon}]</span>`;
    });

    historyDiv.innerHTML = historyHTML;
}

// ─── Exercise History Modal ──────────────────────────────
let historyChartInstance = null;

async function openExerciseHistory(exerciseId, exName) {
    const userId = await getCurrentUserId();
    if (!userId) return;

    // Fetch all logs for this exercise (all dates), ordered by date ascending for chart timeline
    const { data: logs, error } = await supabaseClient
        .from('workout_logs')
        .select('workout_date, set_number, weight, reps_done, status')
        .eq('exercise_id', exerciseId)
        .order('workout_date', { ascending: true });

    // Resolve CSS theme variables for Chart.js config
    const rootStyles = getComputedStyle(document.documentElement);
    const resolvedAccent = rootStyles.getPropertyValue('--accent').trim() || '#4a9eff';
    const resolvedMutedText = rootStyles.getPropertyValue('--muted-text').trim() || '#888';

    const modal = document.getElementById('history-modal');
    const titleEl = document.getElementById('history-modal-title');
    const tableContainer = document.getElementById('history-table-container');

    if (error || !logs || logs.length === 0) {
        titleEl.textContent = exName;
        tableContainer.innerHTML = `<p>No history found for ${escapeHtml(exName)}.</p>`;
        // Clear any previous chart
        destroyHistoryChart();
        modal.classList.remove('hidden');
        return;
    }

    titleEl.textContent = `${exName} — History`;

    // Group logs by workout_date, keeping sets for display
    const sessionsMap = new Map();
    logs.forEach(log => {
        if (!sessionsMap.has(log.workout_date)) {
            sessionsMap.set(log.workout_date, { date: log.workout_date, sets: [], hasFail: false });
        }
        const session = sessionsMap.get(log.workout_date);
        session.sets.push(log);
        if (log.status === 'Fail') session.hasFail = true;
    });

    // Sort sessions by workout_date descending (most recent first) for table view
    const sessions = Array.from(sessionsMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Build summary table — show sets inline like "70kg x 8", no total volume column
    let tableHTML = `<table class="history-table"><thead><tr><th>Date</th><th>Sets</th></tr></thead><tbody>`;
    sessions.forEach(session => {
        const statusClass = session.hasFail ? 'fail-row' : 'success-row';
        const formattedDate = new Date(session.date + 'T00:00:00').toLocaleDateString();

        // Build inline sets display sorted by set number
        session.sets.sort((a, b) => a.set_number - b.set_number);
        const setsDisplay = session.sets.map(s => {
            const icon = s.status === 'Success' ? '✅' : '❌';
            return `${s.weight}kg x ${s.reps_done}${icon}`;
        }).join(' &nbsp;');

        tableHTML += `<tr class="${statusClass}"><td>${formattedDate}</td><td>${setsDisplay}</td></tr>`;
    });
    tableHTML += `</tbody></table>`;
    tableContainer.innerHTML = tableHTML;

    // Build chart data (chronological order: oldest first)
    const chronSessions = Array.from(sessionsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    destroyHistoryChart();

    historyChartInstance = new Chart(document.getElementById('history-chart'), {
        type: 'line',
        data: {
            labels: chronSessions.map(s => new Date(s.date + 'T00:00:00').toLocaleDateString()),
            datasets: [{
                label: 'Avg Set Weight (kg)',
                data: chronSessions.map(s => {
                    const avgWeight = s.sets.reduce((sum, st) => sum + st.weight, 0) / s.sets.length;
                    return Math.round(avgWeight * 10) / 10;
                }),
                borderColor: resolvedAccent,
                backgroundColor: resolvedAccent + '1a', // 10% opacity hex
                tension: 0.3,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                x: { ticks: { color: resolvedMutedText }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: resolvedMutedText } }
            }
        }
    });

    modal.classList.remove('hidden');
}

function closeExerciseHistory() {
    destroyHistoryChart();
    document.getElementById('history-table-container').innerHTML = '';
    document.getElementById('history-modal').classList.add('hidden');
}

function destroyHistoryChart() {
    if (historyChartInstance) {
        historyChartInstance.destroy();
        historyChartInstance = null;
    }
}