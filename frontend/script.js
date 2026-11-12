const API_URL = "http://localhost:5000/api/tasks";

const LISTS_KEY = "taskflow_lists";
const THEME_KEY = "taskflow_theme";
const VIEW_KEY = "taskflow_view";
const DEFAULT_LIST = "Inbox";
const STATUSES = ["Pending", "In Progress", "Completed"];
const UNDO_MS = 5000;

// Lists are stored in the browser and each task's `category` field holds its list name,
// so no backend changes are needed.
let allTasks = [];
let storedLists = loadLists();
let view = loadView();
let editingTaskId = null;
let loading = true;
let loadError = false;

const pendingDeletes = new Map();
let lastDeleteId = null;
let toastTimer = null;
let celebrateTimer = null;

const $ = id => document.getElementById(id);

/* ---------------- Utilities ---------------- */

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
}

function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function loadLists() {
    try {
        const parsed = JSON.parse(safeGet(LISTS_KEY));
        if (Array.isArray(parsed) && parsed.length) {
            return parsed.filter(n => typeof n === "string" && n.trim());
        }
    } catch { /* ignore */ }
    return [DEFAULT_LIST];
}

function saveLists() {
    safeSet(LISTS_KEY, JSON.stringify(storedLists));
}

function loadView() {
    try {
        const parsed = JSON.parse(safeGet(VIEW_KEY));
        if (parsed && ["all", "completed", "list"].includes(parsed.type)) return parsed;
    } catch { /* ignore */ }
    return { type: "all" };
}

function setView(next) {
    view = next;
    safeSet(VIEW_KEY, JSON.stringify(view));
    closeDrawer();
    render();
}

const sameList = (a, b) =>
    String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function pad(n) { return String(n).padStart(2, "0"); }

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dueKey(task) {
    const d = new Date(task.dueDate);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function dayDiff(key) {
    return Math.round((Date.parse(key) - Date.parse(todayKey())) / 86400000);
}

function shortDate(key) {
    return new Date(key).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function dueBadge(task) {
    const key = dueKey(task);
    if (!key) return "";

    const done = task.status === "Completed";
    const diff = dayDiff(key);

    if (done) return `<span class="badge">&#128197; ${shortDate(key)}</span>`;
    if (diff < 0) return `<span class="badge due-overdue">&#9888; Overdue &middot; ${shortDate(key)}</span>`;
    if (diff === 0) return `<span class="badge due-today">&#128197; Today</span>`;
    if (diff === 1) return `<span class="badge">&#128197; Tomorrow</span>`;
    return `<span class="badge">&#128197; ${shortDate(key)}</span>`;
}

function listColor(name) {
    let hash = 0;
    for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${hash}, 70%, 58%)`;
}

const priorityClass = p => ({ High: "priority-high", Medium: "priority-medium", Low: "priority-low" }[p] || "");
const statusClass = s => ({ "Pending": "status-pending", "In Progress": "status-progress", "Completed": "status-completed" }[s] || "");

async function request(url, method = "GET", body) {
    const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });

    let result = {};
    try { result = await response.json(); } catch { /* no body */ }

    if (!response.ok || result.success === false) {
        throw new Error(result.message || "Request failed");
    }
    return result;
}

/* ---------------- Theme ---------------- */

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("themeIcon").textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
    $("themeLabel").textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    safeSet(THEME_KEY, next);
    applyTheme(next);
}

if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
        if (!safeGet(THEME_KEY)) applyTheme(event.matches ? "dark" : "light");
    });
}

/* ---------------- Lists ---------------- */

function getLists() {
    const map = new Map();
    storedLists.forEach(name => map.set(name.toLowerCase(), name));
    allTasks.forEach(task => {
        const name = (task.category || "").trim();
        if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), name);
    });
    return [...map.values()];
}

function currentList() {
    if (view.type === "list") return view.name;
    return getLists()[0] || DEFAULT_LIST;
}

function tasksInList(name) {
    return allTasks.filter(task => sameList(task.category, name));
}

function scopeTasks() {
    if (view.type === "list") return tasksInList(view.name);
    if (view.type === "completed") return allTasks.filter(t => t.status === "Completed");
    return allTasks;
}

function addList(name) {
    const existing = getLists().find(l => sameList(l, name));
    if (existing) {
        if (!storedLists.some(l => sameList(l, existing))) {
            storedLists.push(existing);
            saveLists();
        }
        return existing;
    }
    storedLists.push(name);
    saveLists();
    return name;
}

async function deleteList(name) {
    const tasks = tasksInList(name);
    const message = tasks.length
        ? `Delete the list "${name}" and its ${tasks.length} task${tasks.length === 1 ? "" : "s"}?`
        : `Delete the list "${name}"?`;

    if (!confirm(message)) return;

    const results = await Promise.allSettled(
        tasks.map(task => request(`${API_URL}/${task._id}`, "DELETE"))
    );
    const failed = results.filter(r => r.status === "rejected").length;

    storedLists = getLists().filter(l => !sameList(l, name));
    if (!storedLists.length) storedLists.push(DEFAULT_LIST);
    saveLists();

    if (view.type === "list" && sameList(view.name, name)) {
        view = { type: "all" };
        safeSet(VIEW_KEY, JSON.stringify(view));
    }

    showToast(failed ? "List deleted, but some tasks could not be removed." : `Deleted list "${name}".`);
    await loadTasks(false);
}

/* ---------------- Toast ---------------- */

function showToast(message, options = {}) {
    const toast = $("toast");
    const action = $("toastAction");

    $("toastText").textContent = message;
    clearTimeout(toastTimer);

    if (options.actionLabel && options.onAction) {
        action.textContent = options.actionLabel;
        action.hidden = false;
        action.onclick = () => {
            options.onAction();
            toast.classList.remove("show");
        };
    } else {
        action.hidden = true;
        action.onclick = null;
    }

    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), options.duration || 3000);
}

/* ---------------- Cat artwork ---------------- */

function happyCatSVG() {
    return `
    <svg viewBox="0 0 200 225" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A cat celebrating">
        <g class="cat-bounce">
            <path class="cat-tail" d="M140 195 Q190 190 182 150 Q180 138 170 142" fill="none" stroke="#f4a259" stroke-width="14" stroke-linecap="round"/>
            <ellipse cx="100" cy="165" rx="44" ry="50" fill="#f4a259"/>
            <ellipse cx="100" cy="175" rx="27" ry="34" fill="#fde3c4"/>
            <path d="M78 140 q6 -4 8 4 M122 140 q-6 -4 -8 4" stroke="#e08a3c" stroke-width="3" fill="none" stroke-linecap="round"/>
            <ellipse cx="82" cy="212" rx="15" ry="8" fill="#f9b872"/>
            <ellipse cx="118" cy="212" rx="15" ry="8" fill="#f9b872"/>

            <g class="arm-l">
                <path d="M68 150 Q40 125 46 92" fill="none" stroke="#f4a259" stroke-width="16" stroke-linecap="round"/>
                <circle cx="46" cy="90" r="10" fill="#f9b872"/>
            </g>
            <g class="arm-r">
                <path d="M132 150 Q160 125 154 92" fill="none" stroke="#f4a259" stroke-width="16" stroke-linecap="round"/>
                <circle cx="154" cy="90" r="10" fill="#f9b872"/>
            </g>

            <path d="M64 78 L62 42 L92 62 Z" fill="#f4a259"/>
            <path d="M136 78 L138 42 L108 62 Z" fill="#f4a259"/>
            <path d="M68 70 L67 52 L82 63 Z" fill="#f7a5b4"/>
            <path d="M132 70 L133 52 L118 63 Z" fill="#f7a5b4"/>
            <circle cx="100" cy="98" r="40" fill="#f4a259"/>
            <ellipse cx="100" cy="108" rx="22" ry="17" fill="#fde3c4"/>

            <path d="M100 8 L82 62 L118 62 Z" fill="#7c5cff"/>
            <path d="M92 32 L108 32 M88 46 L112 46" stroke="#ffd166" stroke-width="4" stroke-linecap="round"/>
            <circle cx="100" cy="8" r="6" fill="#ffd166"/>

            <path d="M80 94 Q86 84 92 94" fill="none" stroke="#3b2a20" stroke-width="3.5" stroke-linecap="round"/>
            <path d="M108 94 Q114 84 120 94" fill="none" stroke="#3b2a20" stroke-width="3.5" stroke-linecap="round"/>
            <circle cx="73" cy="106" r="6" fill="#f7a5b4" opacity="0.7"/>
            <circle cx="127" cy="106" r="6" fill="#f7a5b4" opacity="0.7"/>
            <path d="M96 102 L104 102 L100 107 Z" fill="#e57a8d"/>
            <path d="M92 110 Q100 124 108 110 Z" fill="#7a2e2e"/>
            <path d="M96 117 Q100 122 104 117 Q100 114 96 117 Z" fill="#f28ba0"/>
            <path d="M70 100 L52 96 M70 106 L52 108 M130 100 L148 96 M130 106 L148 108" stroke="#3b2a20" stroke-width="1.6" stroke-linecap="round"/>
        </g>
    </svg>`;
}

function sleepingCatSVG() {
    return `
    <svg viewBox="0 0 250 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A cat sleeping">
        <ellipse cx="125" cy="156" rx="90" ry="7" fill="currentColor" opacity="0.08"/>
        <g class="sleep-body">
            <path d="M188 128 Q232 130 222 92 Q218 76 202 84" fill="none" stroke="#f4a259" stroke-width="15" stroke-linecap="round"/>
            <ellipse cx="125" cy="118" rx="72" ry="38" fill="#f4a259"/>
            <path d="M120 84 q4 14 -2 24 M144 86 q4 14 -2 26 M168 92 q3 12 -2 22" stroke="#e08a3c" stroke-width="5" fill="none" stroke-linecap="round"/>
            <circle cx="72" cy="112" r="32" fill="#f4a259"/>
            <path d="M48 92 L48 64 L68 80 Z" fill="#f4a259"/>
            <path d="M80 80 L98 64 L96 94 Z" fill="#f4a259"/>
            <path d="M52 86 L52 72 L62 80 Z" fill="#f7a5b4"/>
            <path d="M85 80 L93 72 L92 86 Z" fill="#f7a5b4"/>
            <ellipse cx="72" cy="122" rx="17" ry="12" fill="#fde3c4"/>
            <path d="M56 110 Q62 117 68 110" fill="none" stroke="#3b2a20" stroke-width="3" stroke-linecap="round"/>
            <path d="M76 110 Q82 117 88 110" fill="none" stroke="#3b2a20" stroke-width="3" stroke-linecap="round"/>
            <path d="M69 119 L75 119 L72 123 Z" fill="#e57a8d"/>
            <path d="M72 123 Q68 128 64 126 M72 123 Q76 128 80 126" fill="none" stroke="#3b2a20" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="52" cy="120" r="5" fill="#f7a5b4" opacity="0.6"/>
            <circle cx="92" cy="120" r="5" fill="#f7a5b4" opacity="0.6"/>
            <ellipse cx="104" cy="142" rx="18" ry="8" fill="#f9b872"/>
        </g>
        <text class="zzz z1" x="108" y="56" font-size="22">z</text>
        <text class="zzz z2" x="124" y="40" font-size="17">z</text>
        <text class="zzz z3" x="138" y="26" font-size="13">z</text>
    </svg>`;
}

/* ---------------- Celebration ---------------- */

const CHEERS = ["Purrfect!", "Meow-velous!", "Pawsitively done!", "Nailed it!", "Fur-tastic work!", "Cat-tastic!"];
const CONFETTI_COLORS = ["#7c5cff", "#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#f4a259"];

function celebrate(task) {
    const overlay = $("celebration");
    const confetti = $("confetti");

    $("celebrationCat").innerHTML = happyCatSVG();
    $("celebrationTitle").textContent = CHEERS[Math.floor(Math.random() * CHEERS.length)];
    $("celebrationTask").textContent = `"${task.title}" is done`;

    confetti.innerHTML = "";
    for (let i = 0; i < 40; i++) {
        const piece = document.createElement("span");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.width = `${6 + Math.random() * 6}px`;
        confetti.appendChild(piece);
    }

    overlay.classList.remove("show");
    void overlay.offsetWidth; // restart the animation
    overlay.classList.add("show");

    clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(() => {
        overlay.classList.remove("show");
        confetti.innerHTML = "";
    }, 2700);
}

/* ---------------- Data ---------------- */

async function loadTasks(showSkeleton = true) {
    if (showSkeleton) {
        loading = true;
        render();
    }

    try {
        const result = await request(API_URL);
        allTasks = result.data || [];
        loadError = false;

        // Remember any list names that came from existing tasks
        storedLists = getLists();
        saveLists();

        if (view.type === "list" && !getLists().some(l => sameList(l, view.name))) {
            view = { type: "all" };
        }
    } catch (error) {
        console.error("Fetch error:", error);
        loadError = true;
    }

    loading = false;
    render();
}

async function setStatus(id, status) {
    const task = allTasks.find(t => t._id === id);
    if (!task || task.status === status) return;

    const previous = task.status;
    task.status = status;
    render();

    if (status === "Completed") celebrate(task);

    try {
        await request(`${API_URL}/${id}`, "PUT", { status });
    } catch (error) {
        console.error("Status update error:", error);
        task.status = previous;
        render();
        showToast(error.message || "Couldn't update the task.");
    }
}

function toggleDone(id) {
    const task = allTasks.find(t => t._id === id);
    if (!task) return;
    setStatus(id, task.status === "Completed" ? "Pending" : "Completed");
}

function deleteTask(id) {
    const task = allTasks.find(t => t._id === id);
    if (!task) return;

    allTasks = allTasks.filter(t => t._id !== id);
    render();

    const timer = setTimeout(async () => {
        pendingDeletes.delete(id);
        try {
            await request(`${API_URL}/${id}`, "DELETE");
        } catch (error) {
            console.error("Delete error:", error);
            allTasks.push(task);
            render();
            showToast("Couldn't delete the task, it was restored.");
        }
    }, UNDO_MS);

    pendingDeletes.set(id, { task, timer });
    lastDeleteId = id;

    showToast("Task deleted", {
        actionLabel: "Undo",
        duration: UNDO_MS,
        onAction: () => undoDelete(id)
    });
}

function undoDelete(id) {
    const pending = pendingDeletes.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingDeletes.delete(id);
    allTasks.push(pending.task);
    render();
}

// If the tab closes during the undo window, still finish the deletes
window.addEventListener("pagehide", () => {
    pendingDeletes.forEach(({ timer }, id) => {
        clearTimeout(timer);
        try { fetch(`${API_URL}/${id}`, { method: "DELETE", keepalive: true }); } catch { /* ignore */ }
    });
});

/* ---------------- Rendering ---------------- */

function getVisibleTasks(scope) {
    const search = $("searchInput").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const priority = $("priorityFilter").value;
    const [sortBy, order] = $("sortFilter").value.split("-");
    const weight = { High: 3, Medium: 2, Low: 1 };

    const filtered = scope.filter(task => {
        const text = [task.title, task.description, task.category, task.taskId, ...(task.tags || [])]
            .join(" ").toLowerCase();

        return text.includes(search)
            && (!status || task.status === status)
            && (!priority || task.priority === priority);
    });

    filtered.sort((a, b) => {
        // Finished tasks sink to the bottom so open work stays on top
        if (view.type !== "completed") {
            const aDone = a.status === "Completed";
            const bDone = b.status === "Completed";
            if (aDone !== bDone) return aDone ? 1 : -1;
        }

        let result = 0;
        if (sortBy === "dueDate") result = new Date(a.dueDate) - new Date(b.dueDate);
        else if (sortBy === "title") result = (a.title || "").localeCompare(b.title || "");
        else if (sortBy === "priority") result = (weight[a.priority] || 0) - (weight[b.priority] || 0);

        return order === "desc" ? -result : result;
    });

    return filtered;
}

function renderSidebar() {
    const open = allTasks.filter(t => t.status !== "Completed").length;
    const done = allTasks.length - open;

    $("allCount").textContent = open;
    $("doneCount").textContent = done;
    $("allLink").classList.toggle("active", view.type === "all");
    $("completedLink").classList.toggle("active", view.type === "completed");

    const lists = getLists();
    $("listNav").innerHTML = lists.length
        ? lists.map(name => {
            const openCount = tasksInList(name).filter(t => t.status !== "Completed").length;
            const active = view.type === "list" && sameList(view.name, name);
            return `
                <li>
                    <button class="list-item ${active ? "active" : ""}" type="button" data-list="${escapeHTML(name)}">
                        <span class="dot" style="background:${listColor(name)}"></span>
                        <span class="list-name">${escapeHTML(name)}</span>
                        <span class="count">${openCount}</span>
                    </button>
                    <button class="list-del" type="button" data-delete-list="${escapeHTML(name)}"
                        aria-label="Delete list ${escapeHTML(name)}" title="Delete list">&times;</button>
                </li>`;
        }).join("")
        : `<li class="list-empty">No lists yet. Press + to add one.</li>`;
}

function renderHeader() {
    let title = "All Tasks";
    if (view.type === "completed") title = "Completed";
    if (view.type === "list") title = view.name;

    $("pageTitle").textContent = title;
    document.title = `${title} | TaskFlow`;

    const scope = view.type === "list" ? tasksInList(view.name) : allTasks;
    const open = scope.filter(t => t.status !== "Completed").length;
    $("pageSubtitle").textContent = view.type === "completed"
        ? `${scope.filter(t => t.status === "Completed").length} finished tasks`
        : `${open} open \u00B7 ${scope.length} total`;

    $("quickForm").hidden = view.type === "completed";
    $("quickAdd").placeholder = `Add a task to ${currentList()} and press Enter`;
}

function renderStats() {
    const scope = view.type === "list" ? tasksInList(view.name) : allTasks;
    const count = status => scope.filter(t => t.status === status).length;
    const completed = count("Completed");

    $("totalTasks").textContent = scope.length;
    $("pendingTasks").textContent = count("Pending");
    $("progressTasks").textContent = count("In Progress");
    $("completedTasks").textContent = completed;

    const percent = scope.length ? Math.round((completed / scope.length) * 100) : 0;
    $("progressBar").style.width = `${percent}%`;
    $("progressText").textContent = scope.length ? `${percent}% done` : "";
    $("progressWrap").hidden = view.type === "completed" || scope.length === 0;
    $("stats").hidden = view.type === "completed";
}

function stateHTML({ cat = true, title, text, button }) {
    return `
        <div class="state">
            ${cat ? `<div class="state-cat">${sleepingCatSVG()}</div>` : ""}
            <h3>${escapeHTML(title)}</h3>
            <p>${escapeHTML(text)}</p>
            ${button || ""}
        </div>`;
}

function taskHTML(task) {
    const done = task.status === "Completed";
    const id = escapeHTML(task._id);
    const tags = (task.tags || []).map(tag => `<span class="tag">#${escapeHTML(tag)}</span>`).join("");

    return `
        <li class="task ${done ? "done" : ""}" data-id="${id}">
            <button class="check" type="button" data-action="toggle" aria-pressed="${done}"
                aria-label="${done ? "Mark as not done" : "Mark as done"}">
                <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            </button>

            <div class="task-body" data-action="view" title="View details">
                <div class="task-title">${escapeHTML(task.title)}</div>
                ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ""}
                <div class="task-meta">
                    <span class="badge ${priorityClass(task.priority)}">${escapeHTML(task.priority)}</span>
                    ${dueBadge(task)}
                    ${view.type !== "list" ? `<span class="badge list-chip">${escapeHTML(task.category)}</span>` : ""}
                    ${tags}
                </div>
            </div>

            <div class="task-actions">
                <button class="icon-btn" type="button" data-action="view" title="View details" aria-label="View task details">
                    <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <select class="status-select ${statusClass(task.status)}" data-action="status" aria-label="Change status">
                    ${STATUSES.map(s => `<option value="${s}" ${s === task.status ? "selected" : ""}>${s}</option>`).join("")}
                </select>
                <button class="icon-btn" type="button" data-action="edit" title="Edit" aria-label="Edit task">
                    <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
                </button>
                <button class="icon-btn danger" type="button" data-action="delete" title="Delete" aria-label="Delete task">
                    <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                </button>
            </div>
        </li>`;
}

function renderTasks() {
    const container = $("taskContainer");
    const toolbar = $("toolbar");
    const count = $("taskCount");

    if (loading) {
        toolbar.hidden = true;
        count.textContent = "";
        container.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
        return;
    }

    if (loadError) {
        toolbar.hidden = true;
        count.textContent = "";
        container.innerHTML = stateHTML({
            cat: false,
            title: "Can't reach the server",
            text: "Make sure your backend is running on localhost:5000, then try again.",
            button: `<button class="primary-btn" type="button" data-action="retry">Try again</button>`
        });
        return;
    }

    const scope = scopeTasks();

    if (scope.length === 0) {
        toolbar.hidden = true;
        count.textContent = "";

        if (view.type === "list") {
            container.innerHTML = stateHTML({
                title: `No tasks in ${view.name} yet`,
                text: "Add one above and this cat will be very proud of you.",
                button: `<button class="primary-btn" type="button" data-action="focus-add">Add a task</button>`
            });
        } else if (view.type === "completed") {
            container.innerHTML = stateHTML({
                title: "Nothing completed yet",
                text: "Finish a task and a celebrating cat will show up."
            });
        } else {
            container.innerHTML = stateHTML({
                title: "No tasks yet",
                text: "Add your first task above, or create a list in the sidebar to stay organised.",
                button: `<button class="primary-btn" type="button" data-action="focus-add">Add a task</button>`
            });
        }
        return;
    }

    toolbar.hidden = false;
    const visible = getVisibleTasks(scope);

    if (visible.length === 0) {
        container.innerHTML = stateHTML({
            title: "No tasks match",
            text: "Try a different search or reset the filters.",
            button: `<button class="secondary-btn" type="button" data-action="reset">Reset filters</button>`
        });
    } else {
        container.innerHTML = `<ul class="task-list">${visible.map(taskHTML).join("")}</ul>`;
    }

    count.textContent = `Showing ${visible.length} of ${scope.length} task${scope.length === 1 ? "" : "s"}`;
}

function render() {
    renderSidebar();
    renderHeader();
    renderStats();
    renderTasks();
}

/* ---------------- Modal ---------------- */

const taskModal = $("taskModal");
const taskForm = $("taskForm");

function fillListSelect(selected) {
    const lists = getLists();
    if (!lists.length) lists.push(DEFAULT_LIST);

    $("taskCategory").innerHTML = lists
        .map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`)
        .join("");

    const match = lists.find(l => sameList(l, selected));
    $("taskCategory").value = match || lists[0];
}

function openAddModal(prefillTitle = "") {
    editingTaskId = null;
    taskForm.reset();

    $("modalTitle").textContent = "New task";
    $("saveTaskBtn").textContent = "Add task";
    $("statusField").hidden = true;

    fillListSelect(currentList());
    $("taskDueDate").value = todayKey();
    $("taskTitle").value = prefillTitle;

    taskModal.style.display = "flex";
    $("taskTitle").focus();
}

function editTask(id) {
    const task = allTasks.find(t => t._id === id);
    if (!task) return showToast("Task not found.");

    editingTaskId = id;
    taskForm.reset();

    $("modalTitle").textContent = "Edit task";
    $("saveTaskBtn").textContent = "Save changes";
    $("statusField").hidden = false;

    fillListSelect(task.category);
    $("taskTitle").value = task.title;
    $("taskDescription").value = task.description || "";
    $("taskPriority").value = task.priority;
    $("taskDueDate").value = dueKey(task) || todayKey();
    $("taskStatus").value = task.status;
    $("taskTags").value = (task.tags || []).join(", ");

    taskModal.style.display = "flex";
    $("taskTitle").focus();
}

function closeModal() {
    taskModal.style.display = "none";
    taskForm.reset();
    editingTaskId = null;
}

taskForm.addEventListener("submit", async event => {
    event.preventDefault();

    const taskData = {
        title: $("taskTitle").value.trim(),
        description: $("taskDescription").value.trim(),
        category: $("taskCategory").value,
        priority: $("taskPriority").value,
        dueDate: $("taskDueDate").value,
        tags: $("taskTags").value.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean)
    };

    if (!taskData.title || !taskData.category || !taskData.dueDate) {
        return showToast("Please add a title and a due date.");
    }

    const isEditing = editingTaskId !== null;
    const saveButton = $("saveTaskBtn");
    const label = saveButton.textContent;
    let justCompleted = null;

    if (isEditing) {
        taskData.status = $("taskStatus").value;
        const existing = allTasks.find(t => t._id === editingTaskId);
        if (existing && existing.status !== "Completed" && taskData.status === "Completed") {
            justCompleted = taskData;
        }
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
        await request(isEditing ? `${API_URL}/${editingTaskId}` : API_URL, isEditing ? "PUT" : "POST", taskData);

        addList(taskData.category);
        closeModal();
        showToast(isEditing ? "Task updated." : "Task added.");
        if (justCompleted) celebrate(justCompleted);

        await loadTasks(false);
    } catch (error) {
        console.error("Save error:", error);
        showToast(error.message || "Unable to save task.");
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = label;
    }
});

/* ---------------- Task details ---------------- */

const detailsModal = $("detailsModal");
let viewingTaskId = null;

function formatDateTime(value) {
    const d = new Date(value);
    if (!value || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFullDate(key) {
    if (!key) return "Not set";
    return new Date(key).toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    });
}

function detailRow(label, valueHTML) {
    return `<div class="detail-row"><span class="detail-label">${label}</span><div class="detail-value">${valueHTML}</div></div>`;
}

function renderDetails(task) {
    const done = task.status === "Completed";
    const tags = (task.tags || []).map(tag => `<span class="tag">#${escapeHTML(tag)}</span>`).join("");
    const created = formatDateTime(task.createdAt);
    const updated = formatDateTime(task.updatedAt);

    $("detailsBody").innerHTML = `
        <h3 class="detail-title ${done ? "done" : ""}" id="detailsTitle">${escapeHTML(task.title)}</h3>
        <div class="task-meta">
            <span class="badge ${statusClass(task.status)}">${escapeHTML(task.status)}</span>
            <span class="badge ${priorityClass(task.priority)}">${escapeHTML(task.priority)} priority</span>
            ${dueBadge(task)}
        </div>
        ${detailRow("Description", task.description
            ? `<p class="detail-desc">${escapeHTML(task.description)}</p>`
            : `<span class="muted">No description</span>`)}
        ${detailRow("List", `<span class="badge list-chip">${escapeHTML(task.category || "None")}</span>`)}
        ${detailRow("Due date", escapeHTML(formatFullDate(dueKey(task))))}
        ${detailRow("Tags", tags || `<span class="muted">No tags</span>`)}
        ${task.taskId ? detailRow("Task ID", escapeHTML(task.taskId)) : ""}
        ${created ? detailRow("Created", escapeHTML(created)) : ""}
        ${updated ? detailRow("Last updated", escapeHTML(updated)) : ""}`;
}

async function openDetails(id) {
    const local = allTasks.find(t => t._id === id);
    if (!local) return showToast("Task not found.");

    viewingTaskId = id;
    renderDetails(local);
    detailsModal.style.display = "flex";
    $("detailsEdit").focus();

    // Refresh from the API (GET /api/tasks/:id); keep the local copy if it fails
    try {
        const result = await request(`${API_URL}/${id}`);
        let fresh = result.data ?? result.task ?? null;
        if (Array.isArray(fresh)) fresh = fresh[0];

        if (fresh && typeof fresh === "object" && fresh.title
            && viewingTaskId === id && detailsModal.style.display === "flex") {
            renderDetails({ ...local, ...fresh });
        }
    } catch (error) {
        console.error("Details fetch error:", error);
    }
}

function closeDetails() {
    detailsModal.style.display = "none";
    viewingTaskId = null;
}

$("closeDetails").addEventListener("click", closeDetails);
detailsModal.addEventListener("click", event => {
    if (event.target === detailsModal) closeDetails();
});
$("detailsEdit").addEventListener("click", () => {
    const id = viewingTaskId;
    closeDetails();
    if (id) editTask(id);
});
$("detailsDelete").addEventListener("click", () => {
    const id = viewingTaskId;
    closeDetails();
    if (id) deleteTask(id);
});

/* ---------------- Quick add ---------------- */

$("quickForm").addEventListener("submit", async event => {
    event.preventDefault();

    const input = $("quickAdd");
    const title = input.value.trim();
    if (!title) return;

    input.disabled = true;

    try {
        await request(API_URL, "POST", {
            title,
            description: "",
            category: currentList(),
            priority: "Medium",
            dueDate: todayKey(),
            tags: []
        });

        input.value = "";
        await loadTasks(false);
    } catch (error) {
        console.error("Quick add error:", error);
        showToast(error.message || "Unable to add task.");
    } finally {
        input.disabled = false;
        input.focus();
    }
});

$("quickDetails").addEventListener("click", () => {
    const title = $("quickAdd").value.trim();
    $("quickAdd").value = "";
    openAddModal(title);
});

/* ---------------- Mobile drawer ---------------- */

function openDrawer() { document.body.classList.add("nav-open"); }
function closeDrawer() { document.body.classList.remove("nav-open"); }

$("menuBtn").addEventListener("click", openDrawer);
$("backdrop").addEventListener("click", closeDrawer);

/* ---------------- Events ---------------- */

$("taskContainer").addEventListener("click", event => {
    const el = event.target.closest("[data-action]");
    if (!el || el.tagName === "SELECT") return;

    const action = el.dataset.action;
    const row = el.closest(".task");
    const id = row ? row.dataset.id : null;

    if (action === "toggle") toggleDone(id);
    else if (action === "view") openDetails(id);
    else if (action === "edit") editTask(id);
    else if (action === "delete") deleteTask(id);
    else if (action === "retry") loadTasks();
    else if (action === "focus-add") $("quickAdd").focus();
    else if (action === "reset") clearFilters();
});

$("taskContainer").addEventListener("change", event => {
    const select = event.target.closest('select[data-action="status"]');
    if (!select) return;
    const row = select.closest(".task");
    if (row) setStatus(row.dataset.id, select.value);
});

$("listNav").addEventListener("click", event => {
    const del = event.target.closest("[data-delete-list]");
    if (del) return deleteList(del.dataset.deleteList);

    const item = event.target.closest("[data-list]");
    if (item) setView({ type: "list", name: item.dataset.list });
});

$("allLink").addEventListener("click", () => setView({ type: "all" }));
$("completedLink").addEventListener("click", () => setView({ type: "completed" }));

$("addListBtn").addEventListener("click", () => {
    const form = $("listForm");
    form.hidden = !form.hidden;
    if (!form.hidden) $("listInput").focus();
});

$("listForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("listInput").value.trim();
    if (!name) return;

    const finalName = addList(name);
    $("listInput").value = "";
    $("listForm").hidden = true;
    setView({ type: "list", name: finalName });
    $("quickAdd").focus();
});

function clearFilters() {
    $("searchInput").value = "";
    $("statusFilter").value = "";
    $("priorityFilter").value = "";
    $("sortFilter").value = "dueDate-asc";
    renderTasks();
}

["searchInput"].forEach(id => $(id).addEventListener("input", renderTasks));
["statusFilter", "priorityFilter", "sortFilter"].forEach(id => $(id).addEventListener("change", renderTasks));
$("clearFiltersBtn").addEventListener("click", clearFilters);

$("addTaskBtn").addEventListener("click", () => openAddModal());
$("closeModal").addEventListener("click", closeModal);
$("cancelModal").addEventListener("click", closeModal);
$("themeToggle").addEventListener("click", toggleTheme);

taskModal.addEventListener("click", event => {
    if (event.target === taskModal) closeModal();
});

$("celebration").addEventListener("click", () => $("celebration").classList.remove("show"));

document.addEventListener("keydown", event => {
    const detailsOpen = detailsModal.style.display === "flex";
    const modalOpen = taskModal.style.display === "flex" || detailsOpen;
    const tag = (event.target.tagName || "").toLowerCase();
    const typing = ["input", "textarea", "select"].includes(tag);

    if (event.key === "Escape") {
        if (detailsOpen) closeDetails();
        else if (modalOpen) closeModal();
        else if (!$("listForm").hidden) $("listForm").hidden = true;
        else closeDrawer();
        return;
    }

    if (typing || modalOpen || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openAddModal();
    } else if (event.key === "/") {
        event.preventDefault();
        $("searchInput").focus();
    } else if (event.key.toLowerCase() === "z" && lastDeleteId && pendingDeletes.has(lastDeleteId)) {
        undoDelete(lastDeleteId);
    }
});

/* ---------------- Boot ---------------- */

applyTheme(document.documentElement.getAttribute("data-theme") || "light");
render();
loadTasks();