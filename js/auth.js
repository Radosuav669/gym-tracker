// Authentication & Session Management
async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
        alert("Please enter both email and password.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) alert("Error: " + error.message);
    else checkUser();
}

async function logout() {
    await supabaseClient.auth.signOut();
    checkUser();
}

async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const loginBox = document.getElementById('login-box');
    const appBox = document.getElementById('app-box');

    if (session) {
        loginBox.classList.add('hidden');
        appBox.classList.remove('hidden');
        loadTodayWorkout();
    } else {
        loginBox.classList.remove('hidden');
        appBox.classList.add('hidden');
    }
}

// Bind event listeners safely once the DOM loads
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', login);
    document.getElementById('btn-logout').addEventListener('click', logout);

    // Initial check execution
    checkUser();
});