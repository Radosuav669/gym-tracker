// Workout Logging and Rendering Logic

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

    const { data: exercises, error } = await supabaseClient
        .from('exercises')
        .select('*')
        .eq('day', todayName)
        .eq('week_option', weekOption);

    if (error) {
        document.getElementById('workout-container').innerHTML = `<p>Error loading data: ${error.message}</p>`;
        return;
    }

    if (!exercises || exercises.length === 0) {
        document.getElementById('week-info').innerText = `Week: ${weekOption} | Today: Rest Day`;
        document.getElementById('today-title').innerText = todayName;
        document.getElementById('workout-container').innerHTML = `
            <div class="card" style="text-align:center;">
                <h3>Rest day. No training plan for today</h3>
                <p>In database there are no exercises assigned for: <strong>${todayName} (${weekOption})</strong>.</p>
            </div>`;
        return;
    }

    const currentRoutine = exercises[0].routine_type || "Workout";
    document.getElementById('week-info').innerText = `Week: ${weekOption} | Routine: ${currentRoutine}`;
    document.getElementById('today-title').innerText = todayName;

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
                        <button class="btn-status btn-success" data-ex="${ex.id}" data-set="${i}" data-status="Success">✓</button>
                        <button class="btn-status btn-fail" data-ex="${ex.id}" data-set="${i}" data-status="Fail">✕</button>
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

// Global Event delegation or explicit binding for dynamically built rows
function attachWorkoutEventListeners() {
    const container = document.getElementById('workout-container');
    container.querySelectorAll('.btn-status').forEach(button => {
        button.addEventListener('click', (e) => {
            const exId = e.currentTarget.getAttribute('data-ex');
            const setNum = e.currentTarget.getAttribute('data-set');
            const status = e.currentTarget.getAttribute('data-status');
            saveSeries(exId, setNum, status);
        });
    });
}

async function saveSeries(exerciseId, setNum, status) {
    const weightInput = document.getElementById(`w-${exerciseId}-${setNum}`).value;
    const repsInput = document.getElementById(`r-${exerciseId}-${setNum}`).value;

    if (!weightInput || !repsInput) {
        alert("Please provide weight and reps for the set first!");
        return;
    }

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
    // 1. Find last training date for this exercise
    const { data: dateData, error: dateError } = await supabaseClient
        .from('workout_logs')
        .select('workout_date')
        .eq('exercise_id', exerciseId)
        .order('workout_date', { ascending: false })
        .limit(1);

    const historyDiv = document.getElementById(`history-${exerciseId}`);

    // If no data is found, display a default message
    if (dateError || !dateData || dateData.length === 0) {
        historyDiv.innerText = "No prior history for this exercise.";
        historyDiv.style.color = "#888888";
        return;
    }

    const latestDate = dateData[0].workout_date;

    const todayDate = new Date().toISOString().split('T')[0];


    // 2. Fetch all entries (sets) only for this latest date
    const { data, error } = await supabaseClient
        .from('workout_logs')
        .select('weight, reps_done, status')
        .eq('exercise_id', exerciseId)
        .eq('workout_date', latestDate)
        .order('set_number', { ascending: true });

    if (data && data.length > 0) {
        let historyText = ""; 
        
        // Logic to determine if the latest date is today or not, and set the color accordingly
        if (latestDate === todayDate) {
            historyText = "Today: "; 
            historyDiv.style.color = "var(--success)"; 
        } else {
            historyText = "Recently: ";
            historyDiv.style.color = "#888888";
        }

        data.forEach(log => {
            historyText += `[${log.weight}kg x ${log.reps_done} ${log.status === 'Success' ? '✅' : '❌'}] `;
        });
        
        historyDiv.innerText = historyText;
    } else {
        historyDiv.innerText = "No prior history for this exercise.";
        historyDiv.style.color = "#888888";
    }
}