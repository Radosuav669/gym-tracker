// Plan editor — edit existing workouts, reorder/replace exercises, change sets/reps,
// create new workouts and change which day / week (Even/Odd) a workout is on.
//
// A "workout" is the set of rows in the `exercises` table that share the same
// (user_id, day, week_option). Moving a workout = updating day/week_option on those rows,
// so exercise ids (and therefore logged history) are preserved.
(function () {
    'use strict';

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const WEEKS = [
        { value: 'Even', label: 'Even Week' },
        { value: 'Odd', label: 'Odd Week' },
    ];
    const MAX_SETS = 20;
    const REPS_PATTERN = /^\d+(-\d+)?$/; // "12" or "8-10"
    const DEFAULT_ROUTINE = 'Workout';

    let current = { day: 'Monday', week: 'Even' };
    let savedRows = [];                       // rows currently stored in DB for the selected slot
    let draft = { routine: '', rows: [] };    // editable copy: rows = { id|null, name, sets, reps }
    let dirty = false;
    let schedule = new Map();                 // "Day|Week" -> { routine, count }
    let busy = false;

    // ─── Small helpers ───────────────────────────────────────────────

    const $ = (id) => document.getElementById(id);
    const slotKey = (day, week) => `${day}|${week}`;
    const slotLabel = (slot) => `${slot.day} (${slot.week})`;

    async function getUserId() {
        const { data: { user }, error } = await supabaseClient.auth.getUser();
        if (error || !user) {
            console.error('Error fetching user:', error);
            return null;
        }
        return user.id;
    }

    function setStatus(message, isError) {
        const el = $('plan-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('error', !!isError);
    }

    function markDirty(value) {
        dirty = value;
        if (value) setStatus('Unsaved changes');
        else if ($('plan-status') && $('plan-status').textContent === 'Unsaved changes') setStatus('');
    }

    function setBusy(value) {
        busy = value;
        // Row up/down buttons are excluded: their disabled state is managed by renderEditor().
        document.querySelectorAll('#plan-editor button:not(.btn-icon)').forEach(b => { b.disabled = value; });
    }

    function confirmDiscardIfDirty() {
        return !dirty || confirm('You have unsaved changes. Discard them?');
    }

    function fillSelect(select, options, selected) {
        select.innerHTML = options
            .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
            .join('');
        if (selected) select.value = selected;
    }

    // ─── Data access ─────────────────────────────────────────────────

    async function fetchSlotRows(userId, day, week) {
        const { data, error } = await supabaseClient
            .from('exercises')
            .select('*')
            .eq('user_id', userId)
            .eq('day', day)
            .eq('week_option', week)
            .order('order_index', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function fetchSchedule(userId) {
        const { data, error } = await supabaseClient
            .from('exercises')
            .select('day, week_option, routine_type')
            .eq('user_id', userId);
        if (error) throw error;

        const map = new Map();
        (data || []).forEach(row => {
            const key = slotKey(row.day, row.week_option);
            if (!map.has(key)) map.set(key, { routine: row.routine_type || DEFAULT_ROUTINE, count: 0 });
            map.get(key).count++;
        });
        return map;
    }

    async function countLogs(exerciseIds) {
        if (!exerciseIds.length) return 0;
        const { count, error } = await supabaseClient
            .from('workout_logs')
            .select('id', { count: 'exact', head: true })
            .in('exercise_id', exerciseIds);
        if (error) {
            console.error(error);
            return 0;
        }
        return count || 0;
    }

    async function refreshWorkoutTab() {
        if (typeof window.loadWorkoutData === 'function') {
            await window.loadWorkoutData();
        } else if (typeof loadWorkoutData === 'function') {
            await loadWorkoutData();
        }
    }

    // ─── Loading / rendering ─────────────────────────────────────────

    async function reloadSchedule(userId) {
        schedule = await fetchSchedule(userId);
        renderSchedule();
    }

    async function loadSlot(day, week) {
        const userId = await getUserId();
        if (!userId) return;

        current = { day, week };
        $('plan-day-select').value = day;
        $('plan-week-select').value = week;

        try {
            savedRows = await fetchSlotRows(userId, day, week);
        } catch (err) {
            setStatus('Error loading workout: ' + err.message, true);
            return;
        }

        resetDraftFromSaved();
        renderSchedule();
    }

    function resetDraftFromSaved() {
        const routine = savedRows.length ? (savedRows[0].routine_type || '') : '';
        draft = {
            routine: routine === DEFAULT_ROUTINE ? '' : routine,
            rows: savedRows.map(r => ({
                id: r.id,
                name: r.exercise_name || '',
                sets: String(r.target_sets ?? 3),
                reps: String(r.target_reps ?? ''),
            })),
        };
        dirty = false;
        setStatus(savedRows.length ? '' : 'Empty slot — add exercises to create a new workout.');
        renderEditor();
    }

    function renderSchedule() {
        const container = $('plan-schedule');
        if (!container) return;

        let html = '<table class="plan-schedule-table"><thead><tr><th></th>';
        WEEKS.forEach(w => { html += `<th>${escapeHtml(w.value)}</th>`; });
        html += '</tr></thead><tbody>';

        DAYS.forEach(day => {
            html += `<tr><th scope="row">${escapeHtml(day.slice(0, 3))}</th>`;
            WEEKS.forEach(w => {
                const info = schedule.get(slotKey(day, w.value));
                const selected = current.day === day && current.week === w.value;
                const cls = 'plan-slot' + (info ? '' : ' empty') + (selected ? ' selected' : '');
                const label = info
                    ? `${escapeHtml(info.routine)} <small>(${info.count})</small>`
                    : '—';
                html += `<td><button class="${cls}" data-day="${day}" data-week="${w.value}">${label}</button></td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function renderEditor() {
        $('plan-routine').value = draft.routine;

        const container = $('plan-exercises');
        if (!draft.rows.length) {
            container.innerHTML = '<p class="plan-empty">No exercises yet.</p>';
            return;
        }

        const last = draft.rows.length - 1;
        container.innerHTML = draft.rows.map((row, i) => `
            <div class="plan-exercise" data-idx="${i}">
                <input type="text" class="plan-name" data-field="name" placeholder="Exercise name"
                       maxlength="80" value="${escapeHtml(row.name)}">
                <div class="plan-exercise-controls">
                    <input type="number" class="plan-sets" data-field="sets" min="1" max="${MAX_SETS}"
                           inputmode="numeric" title="Sets" value="${escapeHtml(row.sets)}">
                    <span>×</span>
                    <input type="text" class="plan-reps" data-field="reps" placeholder="8-10"
                           inputmode="text" title="Reps (e.g. 10 or 8-12)" maxlength="7" value="${escapeHtml(row.reps)}">
                    <button class="btn-icon" data-action="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
                    <button class="btn-icon" data-action="down" title="Move down" ${i === last ? 'disabled' : ''}>▼</button>
                    <button class="btn-icon btn-icon-danger" data-action="remove" title="Remove">✕</button>
                </div>
            </div>
        `).join('');
    }

    // ─── Editing actions (local draft) ───────────────────────────────

    function onExercisesInput(e) {
        const field = e.target.getAttribute('data-field');
        const rowEl = e.target.closest('.plan-exercise');
        if (!field || !rowEl) return;
        draft.rows[Number(rowEl.getAttribute('data-idx'))][field] = e.target.value;
        markDirty(true);
    }

    function onExercisesClick(e) {
        const btn = e.target.closest('button[data-action]');
        const rowEl = e.target.closest('.plan-exercise');
        if (!btn || !rowEl || btn.disabled) return;

        const idx = Number(rowEl.getAttribute('data-idx'));
        const action = btn.getAttribute('data-action');
        const rows = draft.rows;

        if (action === 'up' && idx > 0) {
            [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]];
        } else if (action === 'down' && idx < rows.length - 1) {
            [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]];
        } else if (action === 'remove') {
            rows.splice(idx, 1);
        } else {
            return;
        }
        markDirty(true);
        renderEditor();
    }

    function addExercise() {
        draft.rows.push({ id: null, name: '', sets: '3', reps: '8-12' });
        markDirty(true);
        renderEditor();
        const names = document.querySelectorAll('#plan-exercises .plan-name');
        if (names.length) names[names.length - 1].focus();
    }

    function discardChanges() {
        if (!dirty) return;
        resetDraftFromSaved();
    }

    // ─── Saving ──────────────────────────────────────────────────────

    function validateDraft() {
        for (let i = 0; i < draft.rows.length; i++) {
            const row = draft.rows[i];
            const n = i + 1;
            if (!row.name.trim()) return `Exercise #${n}: name is required.`;
            const sets = Number(row.sets);
            if (!Number.isInteger(sets) || sets < 1 || sets > MAX_SETS) {
                return `Exercise #${n}: sets must be a whole number between 1 and ${MAX_SETS}.`;
            }
            if (!REPS_PATTERN.test(row.reps.trim())) {
                return `Exercise #${n}: reps must look like "10" or "8-12".`;
            }
        }
        return null;
    }

    async function saveWorkout() {
        if (busy) return;

        if (!draft.rows.length) {
            alert(savedRows.length
                ? 'A workout needs at least one exercise. Use "Delete whole workout" to remove it.'
                : 'Add at least one exercise first.');
            return;
        }

        const problem = validateDraft();
        if (problem) {
            alert(problem);
            return;
        }

        const userId = await getUserId();
        if (!userId) return;

        const keptIds = new Set(draft.rows.filter(r => r.id !== null).map(r => String(r.id)));
        const removedIds = savedRows.filter(r => !keptIds.has(String(r.id))).map(r => r.id);

        if (removedIds.length) {
            const logs = await countLogs(removedIds);
            const msg = `Remove ${removedIds.length} exercise(s) from this workout?` +
                (logs ? `\n${logs} logged set(s) for them may be deleted too.` : '');
            if (!confirm(msg)) return;
        }

        const routine = draft.routine.trim() || DEFAULT_ROUTINE;

        setBusy(true);
        setStatus('Saving...');
        try {
            // 1) update existing rows (name, sets, reps, new order)
            for (let i = 0; i < draft.rows.length; i++) {
                const row = draft.rows[i];
                if (row.id === null) continue;
                const { error } = await supabaseClient
                    .from('exercises')
                    .update({
                        exercise_name: row.name.trim(),
                        target_sets: Number(row.sets),
                        target_reps: row.reps.trim(),
                        order_index: i + 1,
                        routine_type: routine,
                    })
                    .eq('id', row.id)
                    .eq('user_id', userId);
                if (error) throw error;
            }

            // 2) insert new rows
            const newRows = draft.rows
                .map((row, i) => ({ row, i }))
                .filter(({ row }) => row.id === null)
                .map(({ row, i }) => ({
                    user_id: userId,
                    day: current.day,
                    week_option: current.week,
                    routine_type: routine,
                    exercise_name: row.name.trim(),
                    target_sets: Number(row.sets),
                    target_reps: row.reps.trim(),
                    order_index: i + 1,
                }));
            if (newRows.length) {
                const { data: inserted, error } = await supabaseClient
                    .from('exercises')
                    .insert(newRows)
                    .select('id, order_index');
                if (error) throw error;

                // Remember the new ids in the draft right away. If a later step (delete) fails
                // and the user retries, these rows are treated as existing instead of being
                // inserted a second time.
                (inserted || []).forEach(created => {
                    const row = draft.rows[created.order_index - 1];
                    if (row && row.id === null) row.id = created.id;
                });
            }

            // 3) delete removed rows
            if (removedIds.length) {
                const { error } = await supabaseClient
                    .from('exercises')
                    .delete()
                    .in('id', removedIds)
                    .eq('user_id', userId);
                if (error) throw error;
            }
        } catch (err) {
            console.error(err);
            setBusy(false);
            setStatus('Save failed: ' + err.message, true);
            // Reload what's really in the DB so the editor can't drift from it,
            // but keep the user's draft untouched so nothing is lost.
            try { savedRows = await fetchSlotRows(userId, current.day, current.week); } catch (_) { /* ignore */ }
            return;
        }

        setBusy(false);
        await afterChange(userId);
        setStatus('Saved ✓');
    }

    // Reload current slot + schedule + workout tab after any DB change.
    async function afterChange(userId) {
        try {
            savedRows = await fetchSlotRows(userId, current.day, current.week);
            schedule = await fetchSchedule(userId);
        } catch (err) {
            setStatus('Error reloading: ' + err.message, true);
            return;
        }
        resetDraftFromSaved();
        renderSchedule();
        refreshWorkoutTab();
    }

    // ─── Schedule changes: move / swap / copy / delete ───────────────

    function getTargetSlot() {
        return { day: $('plan-target-day').value, week: $('plan-target-week').value };
    }

    function requireSavedWorkout() {
        if (dirty) {
            alert('Save or discard your changes first.');
            return false;
        }
        if (!savedRows.length) {
            alert('This slot has no saved workout.');
            return false;
        }
        return true;
    }

    async function updateSlot(userId, ids, slot) {
        const { error } = await supabaseClient
            .from('exercises')
            .update({ day: slot.day, week_option: slot.week })
            .in('id', ids)
            .eq('user_id', userId);
        if (error) throw error;
    }

    async function moveWorkout() {
        if (busy || !requireSavedWorkout()) return;

        const target = getTargetSlot();
        if (target.day === current.day && target.week === current.week) {
            alert('Choose a different day / week to move this workout to.');
            return;
        }

        const userId = await getUserId();
        if (!userId) return;

        setBusy(true);
        try {
            const source = { ...current };
            const sourceIds = savedRows.map(r => r.id);
            const targetRows = await fetchSlotRows(userId, target.day, target.week);
            const targetIds = targetRows.map(r => r.id);

            if (targetRows.length) {
                const name = targetRows[0].routine_type || DEFAULT_ROUTINE;
                if (!confirm(`${slotLabel(target)} already has "${name}". Swap the two workouts?`)) {
                    setBusy(false);
                    return;
                }
            }

            await updateSlot(userId, sourceIds, target);
            if (targetIds.length) {
                try {
                    await updateSlot(userId, targetIds, source);
                } catch (err) {
                    // roll back the first step so two workouts don't end up in one slot
                    await updateSlot(userId, sourceIds, source).catch(console.error);
                    throw err;
                }
            }

            current = target;
            $('plan-day-select').value = target.day;
            $('plan-week-select').value = target.week;
            setBusy(false);
            await afterChange(userId);
            setStatus(targetIds.length ? `Swapped with ${slotLabel(source)} ✓` : `Moved to ${slotLabel(target)} ✓`);
        } catch (err) {
            console.error(err);
            setBusy(false);
            setStatus('Move failed: ' + err.message, true);
        }
    }

    async function copyWorkout() {
        if (busy || !requireSavedWorkout()) return;

        const target = getTargetSlot();
        if (target.day === current.day && target.week === current.week) {
            alert('Choose a different day / week to copy this workout to.');
            return;
        }

        const userId = await getUserId();
        if (!userId) return;

        setBusy(true);
        try {
            const existing = await fetchSlotRows(userId, target.day, target.week);
            if (existing.length) {
                alert(`${slotLabel(target)} already has a workout. Pick an empty slot, or move/delete it first.`);
                setBusy(false);
                return;
            }

            const copies = savedRows.map((r, i) => ({
                user_id: userId,
                day: target.day,
                week_option: target.week,
                routine_type: r.routine_type || DEFAULT_ROUTINE,
                exercise_name: r.exercise_name,
                target_sets: r.target_sets,
                target_reps: r.target_reps,
                order_index: i + 1,
            }));
            const { error } = await supabaseClient.from('exercises').insert(copies);
            if (error) throw error;

            setBusy(false);
            await reloadSchedule(userId);
            setStatus(`Copied to ${slotLabel(target)} ✓`);
        } catch (err) {
            console.error(err);
            setBusy(false);
            setStatus('Copy failed: ' + err.message, true);
        }
    }

    async function deleteWorkout() {
        if (busy) return;
        if (!savedRows.length) {
            alert('This slot has no saved workout.');
            return;
        }

        const userId = await getUserId();
        if (!userId) return;

        const ids = savedRows.map(r => r.id);
        const logs = await countLogs(ids);
        const name = savedRows[0].routine_type || DEFAULT_ROUTINE;
        const msg = `Delete "${name}" (${slotLabel(current)}) with ${ids.length} exercise(s)?` +
            (logs ? `\n${logs} logged set(s) for these exercises may be deleted too.` : '') +
            '\nThis cannot be undone.';
        if (!confirm(msg)) return;

        setBusy(true);
        try {
            const { error } = await supabaseClient
                .from('exercises')
                .delete()
                .in('id', ids)
                .eq('user_id', userId);
            if (error) throw error;
        } catch (err) {
            console.error(err);
            setBusy(false);
            setStatus('Delete failed: ' + err.message, true);
            return;
        }

        setBusy(false);
        await afterChange(userId);
        setStatus('Workout deleted.');
    }

    // ─── Slot selection ──────────────────────────────────────────────

    async function selectSlot(day, week) {
        if (busy || (day === current.day && week === current.week)) return;
        if (!confirmDiscardIfDirty()) {
            $('plan-day-select').value = current.day;
            $('plan-week-select').value = current.week;
            return;
        }
        await loadSlot(day, week);
    }

    // ─── Init ────────────────────────────────────────────────────────

    async function openPlanTab() {
        const userId = await getUserId();
        if (!userId) return;

        try {
            await reloadSchedule(userId);
        } catch (err) {
            setStatus('Error loading schedule: ' + err.message, true);
            return;
        }

        // Keep unsaved edits if the user just switched tabs back and forth.
        if (dirty) return;

        // Start on whatever the Workout tab is showing.
        const wDay = $('day-select') && $('day-select').value;
        const wWeek = $('week-select') && $('week-select').value;
        const day = DAYS.includes(wDay) ? wDay : current.day;
        const week = WEEKS.some(w => w.value === wWeek) ? wWeek : current.week;
        await loadSlot(day, week);
    }

    function resetState() {
        savedRows = [];
        draft = { routine: '', rows: [] };
        dirty = false;
        schedule = new Map();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const dayOptions = DAYS.map(d => ({ value: d, label: d }));
        fillSelect($('plan-day-select'), dayOptions, current.day);
        fillSelect($('plan-week-select'), WEEKS, current.week);
        fillSelect($('plan-target-day'), dayOptions, current.day);
        fillSelect($('plan-target-week'), WEEKS, current.week === 'Even' ? 'Odd' : 'Even');

        $('plan-day-select').addEventListener('change', () => selectSlot($('plan-day-select').value, $('plan-week-select').value));
        $('plan-week-select').addEventListener('change', () => selectSlot($('plan-day-select').value, $('plan-week-select').value));

        $('plan-schedule').addEventListener('click', (e) => {
            const btn = e.target.closest('button.plan-slot');
            if (btn) selectSlot(btn.getAttribute('data-day'), btn.getAttribute('data-week'));
        });

        $('plan-routine').addEventListener('input', (e) => {
            draft.routine = e.target.value;
            markDirty(true);
        });
        $('plan-exercises').addEventListener('input', onExercisesInput);
        $('plan-exercises').addEventListener('click', onExercisesClick);

        $('plan-add-exercise').addEventListener('click', addExercise);
        $('plan-save').addEventListener('click', saveWorkout);
        $('plan-discard').addEventListener('click', discardChanges);
        $('plan-move').addEventListener('click', moveWorkout);
        $('plan-copy').addEventListener('click', copyWorkout);
        $('plan-delete').addEventListener('click', deleteWorkout);

        const planTabBtn = document.querySelector('.tab-btn[data-tab="plan"]');
        if (planTabBtn) planTabBtn.addEventListener('click', openPlanTab);

        const logoutBtn = $('btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', resetState);

        window.addEventListener('beforeunload', (e) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    });
})();
