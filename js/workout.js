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
    // Ustawienie na najbliższy czwartek: czwartek w bieżącym tygodniu określa rok ISO
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    // Obliczenie pełnych tygodni
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
        document.getElementById('workout-container').innerHTML = `<p>Error loading data: ${error.message}</p>`;
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
                    <h3>${ex.exercise_name}</h3>
                    <button class="btn-history" data-ex-id="${ex.id}" data-ex-name="${ex.exercise_name}" title="View history">⏱</button>
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
                        <input type="number" step="0.1" id="w-${ex.id}-${i}" placeholder="kg">
                        <input type="number" id="r-${ex.id}-${i}" placeholder="reps">
                    </div>
                    <div>
                        <button class="btn-save" data-ex="${ex.id}" data-set="${i}" data-target="${ex.target_reps}">Save</button>
                    </div>
                </div>
            `;
        }
        html += `</div></div>`;

        loadLastLoggedWorkout(ex.id);
    });

    document.getElementById('workout-container').innerHTML = html;
    attachWorkoutEventListeners();
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

            saveSeries(exId, setNum, targetReps);
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

async function saveSeries(exerciseId, setNum, targetRepsStr) {
    const userId = await getCurrentUserId();
    if (!userId) return;

    const weightInput = document.getElementById(`w-${exerciseId}-${setNum}`).value;
    const repsInput = document.getElementById(`r-${exerciseId}-${setNum}`).value;

    if (!weightInput || !repsInput) {
        alert("Please provide weight and reps for the set first!");
        return;
    }

    const repsDone = parseInt(repsInput);

    let minTarget = 0;
    if (targetRepsStr.includes('-')) {
        minTarget = parseInt(targetRepsStr.split('-')[0]);
    } else {
        minTarget = parseInt(targetRepsStr);
    }

    const status = repsDone >= minTarget ? 'Success' : 'Fail';

    const todayDate = new Date().toISOString().split('T')[0];

    const { data: existingLog, error: fetchError } = await supabaseClient
        .from('workout_logs')
        .select('id')
        .eq('workout_date', todayDate)
        .eq('exercise_id', exerciseId)
        .eq('set_number', setNum)
        .maybeSingle();

    if (fetchError) {
        alert("Error checking history: " + fetchError.message);
        return;
    }

    if (existingLog) {
        const { error: updateError } = await supabaseClient
            .from('workout_logs')
            .update({
                weight: parseFloat(weightInput),
                reps_done: parseInt(repsInput),
                status: status
            })
            .eq('id', existingLog.id);

        if (updateError) alert("Could not update: " + updateError.message);
        else {
            loadLastLoggedWorkout(exerciseId);
            if (typeof window.refreshProgress === 'function') window.refreshProgress();
        }
    } else {
        const { error: insertError } = await supabaseClient
            .from('workout_logs')
            .insert([{
                user_id: userId,
                workout_date: todayDate,
                exercise_id: exerciseId,
                set_number: setNum,
                weight: parseFloat(weightInput),
                reps_done: parseInt(repsInput),
                status: status
            }]);

        if (insertError) alert("Could not save: " + insertError.message);
        else {
            loadLastLoggedWorkout(exerciseId);
            if (typeof window.refreshProgress === 'function') window.refreshProgress();
        }
    }
}

async function loadLastLoggedWorkout(exerciseId) {
    // Fetch the last logged workout for the given exercise, grouped by set number, and display it in the history div.  
    const { data, error } = await supabaseClient
        .from('workout_logs')
        .select('workout_date, set_number, weight, reps_done, status')
        .eq('exercise_id', exerciseId)
        .order('workout_date', { ascending: false })
        .limit(20); 

    const historyDiv = document.getElementById(`history-${exerciseId}`);
    
    if (error || !data || data.length === 0) {
        historyDiv.innerHTML = "No prior history for this exercise.";
        return;
    }

    const todayDate = new Date().toISOString().split('T')[0];

    // 1. Group the results by set number, keeping only the latest entry for each set
    const latestSets = new Map();
    data.forEach(log => {
        if (!latestSets.has(log.set_number)) {
            latestSets.set(log.set_number, log);
        }
    });

    // 2. Sort the sets by set number to display them in order
    const sortedSets = Array.from(latestSets.values()).sort((a, b) => a.set_number - b.set_number);

    // 3. Budujemy HTML, kolorując każdą serię osobno na podstawie jej daty
    let historyHTML = ""; 
    
    sortedSets.forEach(log => {
        const isToday = log.workout_date === todayDate;
        const color = isToday ? "var(--success)" : "var(--muted-text)"; 
        const icon = log.status === 'Success' ? '✅' : '❌';
        
        historyHTML += `<span style="color: ${color}; margin-right: 4px;">[${log.weight}kg x ${log.reps_done} ${icon}]</span>`;
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
        tableContainer.innerHTML = `<p>No history found for ${exName}.</p>`;
        // Clear any previous chart
        destroyHistoryChart();
        modal.classList.remove('hidden');
        return;
    }

    titleEl.textContent = `${exName} — History`;

    // Group logs by workout_date and compute per-session summary
    const sessionsMap = new Map(); // date -> { sets: [], totalVolume, hasFail }
    logs.forEach(log => {
        if (!sessionsMap.has(log.workout_date)) {
            sessionsMap.set(log.workout_date, { date: log.workout_date, sets: [], totalVolume: 0, hasFail: false });
        }
        const session = sessionsMap.get(log.workout_date);
        session.sets.push(log);
        session.totalVolume += (log.weight * log.reps_done);
        if (log.status === 'Fail') session.hasFail = true;
    });

    // Sort sessions by workout_date descending (most recent first) for table view
    const sessions = Array.from(sessionsMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Build summary table
    let tableHTML = `<table class="history-table"><thead><tr><th>Date</th><th>Total Volume (kg)</th><th>Sets</th><th>Status</th></tr></thead><tbody>`;
    sessions.forEach(session => {
        const statusClass = session.hasFail ? 'fail-row' : 'success-row';
        const statusIcon = session.hasFail ? '❌' : '✅';
        const formattedDate = new Date(session.date + 'T00:00:00').toLocaleDateString();
        tableHTML += `<tr class="${statusClass}"><td>${formattedDate}</td><td>${session.totalVolume.toFixed(1)}</td><td>${session.sets.length}</td><td>${statusIcon}</td></tr>`;
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
                label: 'Total Volume (kg)',
                data: chronSessions.map(s => s.totalVolume),
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