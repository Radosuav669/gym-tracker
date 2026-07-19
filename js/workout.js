// Workout Logging and Rendering Logic
async function getCurrentUserId() {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) {
        console.error("Error fetching user:", error);
        return null;
    }
    return user.id;
}


function getWeekOption() {
    const currentdate = new Date();
    const oneJan = new Date(currentdate.getFullYear(), 0, 1);
    const numberOfDays = Math.floor((currentdate - oneJan) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((currentdate.getDay() + 1 + numberOfDays) / 7);
    return (weekNumber % 2 === 0) ? 'Even' : 'Odd';
}

async function loadTodayWorkout() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const todayName = days[now.getDay()];
    const weekOption = getWeekOption();

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
                <h3>${ex.exercise_name}</h3>
                <p style="text-align:center; color:#aaa; margin:0;">Target sets: ${ex.target_sets}x ${ex.target_reps}</p>
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
}

async function saveSeries(exerciseId, setNum, status) {
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
        else loadLastLoggedWorkout(exerciseId);
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
        else loadLastLoggedWorkout(exerciseId);
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
        historyDiv.style.color = "#888888";
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
        const color = isToday ? "var(--success)" : "#888888"; 
        const icon = log.status === 'Success' ? '✅' : '❌';
        
        historyHTML += `<span style="color: ${color}; margin-right: 4px;">[${log.weight}kg x ${log.reps_done} ${icon}]</span>`;
    });
    
    historyDiv.innerHTML = historyHTML;
    historyDiv.style.color = "#aaaaaa"; // Domyślny kolor dla ewentualnego przedrostka
}