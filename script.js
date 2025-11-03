const {
  initializeApp,
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  getFirestore,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  serverTimestamp,
  Timestamp,
  setLogLevel,
} = window.firebase;

// --- KONFIGURASI FIREBASE ANDA (dari screenshot) ---
const firebaseConfig = {
  apiKey: "AIzaSyDkurarNmpm1tDs0D0nza2ofv2Apes",
  authDomain: "taskhub-fb8f4.firebaseapp.com",
  projectId: "taskhub-fb8f4",
  storageBucket: "taskhub-fb8f4.appspot.com",
  messagingSenderId: "981022175877",
  appId: "1:981022175877:web:f0d10170d65a9d8bdc07ec",
  measurementId: "G-LNEJXJMGH6",
};
// ---------------------------------------------

// --- Event Listener Utama ---
document.addEventListener("DOMContentLoaded", () => {
  // --- Logika Theme Toggle ---
  const themeToggleBtn = document.getElementById("theme-toggle");
  const themeIconMoon = document.getElementById("theme-icon-moon");
  const themeIconSun = document.getElementById("theme-icon-sun");
  const htmlElement = document.documentElement;

  function updateThemeIcons(isDarkMode) {
    if (isDarkMode) {
      themeIconMoon.classList.add("hidden");
      themeIconSun.classList.remove("hidden");
    } else {
      themeIconMoon.classList.remove("hidden");
      themeIconSun.classList.add("hidden");
    }
  }

  function loadTheme() {
    const storedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;

    let isDark;
    if (storedTheme === "dark") {
      isDark = true;
    } else if (storedTheme === "light") {
      isDark = false;
    } else {
      isDark = systemPrefersDark;
    }

    if (isDark) {
      htmlElement.classList.add("dark");
    } else {
      htmlElement.classList.remove("dark");
    }
    updateThemeIcons(isDark);
  }

  function toggleTheme() {
    const isDark = htmlElement.classList.toggle("dark");
    if (isDark) {
      localStorage.setItem("theme", "dark");
    } else {
      localStorage.setItem("theme", "light");
    }
    updateThemeIcons(isDark);
  }

  themeToggleBtn.addEventListener("click", toggleTheme);
  loadTheme();

  // --- Variabel Global ---
  const taskForm = document.getElementById("add-task-form");
  const submitBtn = taskForm.querySelector('button[type="submit"]');
  const taskInput = document.getElementById("task-input");
  const descriptionInput = document.getElementById("task-description-input");
  const categoryInput = document.getElementById("task-category-input");
  const deadlineDateInput = document.getElementById("deadline-date-input");
  const deadlineTimeInput = document.getElementById("deadline-time-input");
  const pendingList = document.getElementById("pending-list");
  const completedList = document.getElementById("completed-list");
  const pendingEmpty = document.getElementById("pending-empty");
  const completedEmpty = document.getElementById("completed-empty");
  const filterButtons = document.getElementById("filter-buttons");
  const deleteModal = document.getElementById("delete-modal");
  const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
  const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
  const statsModal = document.getElementById("stats-modal");
  const showStatsBtn = document.getElementById("show-stats-btn");
  const closeStatsBtn = document.getElementById("close-stats-btn");
  const statsContent = document.getElementById("stats-content");
  const pomodoroModal = document.getElementById("pomodoro-modal");
  const pomodoroTaskName = document.getElementById("pomodoro-task-name");
  const pomodoroTimerDisplay = document.getElementById("pomodoro-timer");
  const pomodoroStartPause = document.getElementById("pomodoro-start-pause");
  const pomodoroStop = document.getElementById("pomodoro-stop");
  const pomodoroSoundSelect = document.getElementById("pomodoro-sound");
  const pomodoroVolumeSlider = document.getElementById("pomodoro-volume");

  // --- Variabel State Aplikasi ---
  let tasks = [];
  let taskIdToDelete = null;
  let currentFilter = "all";
  let pomodoroInterval = null;
  let pomodoroSecondsRemaining = 25 * 60;
  let isPomodoroRunning = false;

  // --- Variabel Firebase ---
  let db, auth;
  let userId;
  let tasksCollectionRef;
  let unsubscribeFromTasks;

  // --- Logika Audio Pomodoro (White Noise) ---
  let audioContext = null;
  let whiteNoiseNode = null;
  let gainNode = null;

  function initAudio() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(
        pomodoroVolumeSlider.value,
        audioContext.currentTime
      );
      gainNode.connect(audioContext.destination);
    } catch (e) {
      console.error("Web Audio API tidak didukung di browser ini");
    }
  }

  async function createWhiteNoise() {
    if (!audioContext) return;
    if (whiteNoiseNode) {
      whiteNoiseNode.disconnect();
    }

    const bufferSize = 2 * audioContext.sampleRate;
    const noiseBuffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    whiteNoiseNode = audioContext.createBufferSource();
    whiteNoiseNode.buffer = noiseBuffer;
    whiteNoiseNode.loop = true;
    whiteNoiseNode.connect(gainNode);
  }

  function playWhiteNoise() {
    if (!audioContext || pomodoroSoundSelect.value !== "white-noise") return;

    if (!whiteNoiseNode) {
      createWhiteNoise();
    }

    try {
      audioContext.resume();
      whiteNoiseNode.start(0);
    } catch (e) {
      //
    }
  }

  function stopWhiteNoise() {
    if (whiteNoiseNode) {
      try {
        whiteNoiseNode.stop(0);
        whiteNoiseNode = null;
      } catch (e) {
        //
      }
    }
  }

  pomodoroVolumeSlider.addEventListener("input", (e) => {
    if (gainNode) {
      gainNode.gain.setValueAtTime(e.target.value, audioContext.currentTime);
    }
  });

  pomodoroSoundSelect.addEventListener("change", (e) => {
    if (isPomodoroRunning) {
      stopWhiteNoise();
      if (e.target.value === "white-noise") {
        playWhiteNoise();
      }
    }
  });

  // --- Logika CRUD Tugas (Firebase) ---

  function loadTasks() {
    if (unsubscribeFromTasks) {
      unsubscribeFromTasks();
    }

    if (!tasksCollectionRef) {
      console.error("Referensi koleksi tugas belum siap.");
      return;
    }

    console.log("Membuat listener snapshot untuk tasks...");

    unsubscribeFromTasks = onSnapshot(
      tasksCollectionRef,
      (snapshot) => {
        console.log(
          "Snapshot data diterima, jumlah dokumen:",
          snapshot.docs.length
        );
        tasks = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          tasks.push({
            id: doc.id,
            ...data,
            deadline: data.deadline
              ? data.deadline.toDate().toISOString()
              : null,
            completedAt: data.completedAt
              ? data.completedAt.toDate().toISOString()
              : null,
            createdAt: data.createdAt
              ? data.createdAt.toDate().toISOString()
              : null,
          });
        });
        renderTasks();
      },
      (error) => {
        console.error("Error saat mendengarkan snapshot:", error);
      }
    );
  }

  async function addTask(e) {
    e.preventDefault();
    const taskName = taskInput.value.trim();
    const description = descriptionInput.value.trim();
    const category = categoryInput.value;
    const deadlineDate = deadlineDateInput.value;
    const deadlineTime = deadlineTimeInput.value;

    if (taskName === "") {
      console.error("Nama tugas tidak boleh kosong");
      return;
    }

    let deadlineTimestamp = null;
    if (deadlineDate && deadlineTime) {
      deadlineTimestamp = Timestamp.fromDate(
        new Date(`${deadlineDate}T${deadlineTime}`)
      );
    } else if (deadlineDate) {
      const date = new Date(deadlineDate);
      date.setHours(23, 59, 59, 999);
      deadlineTimestamp = Timestamp.fromDate(date);
    }

    const newTask = {
      name: taskName,
      description: description,
      category: category,
      deadline: deadlineTimestamp,
      completed: false,
      completedAt: null,
      createdAt: serverTimestamp(),
    };

    try {
      if (!tasksCollectionRef) {
        console.error("Koleksi tugas belum siap. Coba lagi nanti.");
        return;
      }
      await addDoc(tasksCollectionRef, newTask);

      taskInput.value = "";
      descriptionInput.value = "";
      categoryInput.value = "umum";
      deadlineDateInput.value = "";
      deadlineTimeInput.value = "";
    } catch (error) {
      console.error("Error menambahkan tugas:", error);
    }
  }

  async function toggleTaskComplete(id) {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      if (!tasksCollectionRef) {
        console.error("Koleksi tugas belum siap.");
        return;
      }
      const taskRef = doc(tasksCollectionRef, id);
      const newCompletedStatus = !task.completed;

      try {
        await updateDoc(taskRef, {
          completed: newCompletedStatus,
          completedAt: newCompletedStatus ? Timestamp.now() : null,
        });

        if (newCompletedStatus && typeof confetti === "function") {
          confetti({
            particleCount: 150,
            spread: 90,
            origin: { y: 0.6 },
            zIndex: 10000,
          });
        }
      } catch (error) {
        console.error("Error mengubah status tugas:", error);
      }
    }
  }

  async function updateTask(id, newValues) {
    if (!tasksCollectionRef) {
      console.error("Koleksi tugas belum siap.");
      return;
    }
    const taskRef = doc(tasksCollectionRef, id);

    let deadlineTimestamp = null;
    if (newValues.deadline) {
      if (newValues.deadline.includes("T")) {
        deadlineTimestamp = Timestamp.fromDate(new Date(newValues.deadline));
      } else {
        const date = new Date(newValues.deadline);
        date.setUTCHours(23, 59, 59, 999);
        deadlineTimestamp = Timestamp.fromDate(date);
      }
    }

    try {
      await updateDoc(taskRef, {
        name: newValues.name,
        description: newValues.description,
        category: newValues.category,
        deadline: deadlineTimestamp,
      });
    } catch (error) {
      console.error("Error memperbarui tugas:", error);
    }
  }

  // --- Logika Modal Hapus ---
  function showDeleteModal(id) {
    taskIdToDelete = id;
    deleteModal.classList.remove("hidden");
  }

  function hideDeleteModal() {
    taskIdToDelete = null;
    deleteModal.classList.add("hidden");
  }

  async function confirmDelete() {
    if (taskIdToDelete) {
      if (!tasksCollectionRef) {
        console.error("Koleksi tugas belum siap.");
        return;
      }
      const taskRef = doc(tasksCollectionRef, taskIdToDelete);
      try {
        await deleteDoc(taskRef);
        hideDeleteModal();
      } catch (error) {
        console.error("Error menghapus tugas:", error);
      }
    }
  }

  cancelDeleteBtn.addEventListener("click", hideDeleteModal);
  confirmDeleteBtn.addEventListener("click", confirmDelete);

  // --- Logika Modal Statistik ---
  function showStatsModal() {
    const completedTasks = tasks.filter((t) => t.completed && t.completedAt);
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeekDate = new Date(now);
    startOfWeekDate.setDate(
      now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)
    );
    startOfWeekDate.setHours(0, 0, 0, 0);

    const tasksThisWeek = completedTasks.filter(
      (t) => new Date(t.completedAt) >= startOfWeekDate
    );

    const tasksToday = completedTasks.filter(
      (t) => new Date(t.completedAt) >= startOfToday
    );

    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const dayNames = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    completedTasks.forEach((t) => {
      const dayIndex = new Date(t.completedAt).getDay();
      dayCounts[dayIndex]++;
    });

    const maxDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
    const mostProductiveDay =
      completedTasks.length > 0 ? dayNames[maxDayIndex] : "Belum ada data";

    statsContent.innerHTML = `
      <p class="text-lg">Total tugas selesai: <span class="font-bold text-blue-500">${
        completedTasks.length
      }</span></p>
      <p class="text-lg">Tugas selesai minggu ini: <span class="font-bold text-green-500">${
        tasksThisWeek.length
      }</span></p>
       <p class="text-lg">Tugas selesai hari ini: <span class="font-bold text-green-500">${
         tasksToday.length
       }</span></p>
      <p class="text-lg">Hari paling produktif: <span class="font-bold text-yellow-500">${mostProductiveDay}</span></p>
      <p class="text-lg">Tugas belum dikerjakan: <span class="font-bold text-red-500">${
        tasks.filter((t) => !t.completed).length
      }</span></p>
    `;
    statsModal.classList.remove("hidden");
  }
  function hideStatsModal() {
    statsModal.classList.add("hidden");
  }
  showStatsBtn.addEventListener("click", showStatsModal);
  closeStatsBtn.addEventListener("click", hideStatsModal);

  // --- Logika Mode Fokus (Pomodoro) ---
  function updateTimerDisplay() {
    const minutes = Math.floor(pomodoroSecondsRemaining / 60);
    const seconds = pomodoroSecondsRemaining % 60;
    pomodoroTimerDisplay.textContent = `${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  function startPomodoro() {
    isPomodoroRunning = true;
    pomodoroStartPause.textContent = "Pause";

    if (pomodoroSoundSelect.value === "white-noise") {
      playWhiteNoise();
    }

    pomodoroInterval = setInterval(() => {
      pomodoroSecondsRemaining--;
      updateTimerDisplay();
      if (pomodoroSecondsRemaining <= 0) {
        clearInterval(pomodoroInterval);
        isPomodoroRunning = false;
        console.log("Waktu fokus selesai! Saatnya istirahat.");
        stopPomodoro();
      }
    }, 1000);
  }
  function pausePomodoro() {
    isPomodoroRunning = false;
    pomodoroStartPause.textContent = "Mulai";
    clearInterval(pomodoroInterval);
    stopWhiteNoise();
  }
  function stopPomodoro() {
    pausePomodoro();
    pomodoroSecondsRemaining = 25 * 60;
    updateTimerDisplay();
    pomodoroModal.classList.add("hidden");
    stopWhiteNoise();
  }
  function startFocusMode(taskName) {
    pomodoroTaskName.textContent = taskName;
    pomodoroModal.classList.remove("hidden");

    initAudio();

    if (isPomodoroRunning) {
      pausePomodoro();
    }
    pomodoroSecondsRemaining = 25 * 60;
    updateTimerDisplay();
  }
  pomodoroStartPause.addEventListener("click", () => {
    if (isPomodoroRunning) {
      pausePomodoro();
    } else {
      startPomodoro();
    }
  });
  pomodoroStop.addEventListener("click", stopPomodoro);

  // --- Logika Render ---

  function formatDeadline(deadlineString) {
    if (!deadlineString) {
      return {
        text: "Tidak ada deadline",
        class: "text-gray-500 dark:text-gray-400",
      };
    }

    const hasTime = deadlineString.includes("T");
    const deadline = new Date(deadlineString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    let formattedDate = "";

    const hasTimeComponent =
      (deadline.getUTCHours() !== 0 ||
        deadline.getUTCMinutes() !== 0 ||
        deadline.getUTCSeconds() > 0) &&
      (deadline.getUTCHours() !== 23 || deadline.getUTCMinutes() !== 59);

    if (hasTimeComponent) {
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
      formattedDate = deadline.toLocaleString("id-ID", options);
    } else {
      formattedDate = deadline.toLocaleDateString("id-ID", options);
    }

    const now = new Date();

    if (deadline < now) {
      return {
        text: `TERLAMBAT (${formattedDate})`,
        class: "text-red-500 dark:text-red-400 font-bold",
      };
    } else {
      const diffMs = deadline.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 24) {
        return {
          text: `SEGERA (${formattedDate})`,
          class: "text-yellow-500 dark:text-yellow-300 font-semibold",
        };
      }

      const deadlineDay = new Date(deadline);
      deadlineDay.setHours(0, 0, 0, 0);

      if (deadlineDay.getTime() === today.getTime()) {
        return {
          text: `Hari Ini (${formattedDate})`,
          class: "text-yellow-500 dark:text-yellow-300 font-semibold",
        };
      }

      return {
        text: formattedDate,
        class: "text-yellow-500 dark:text-yellow-300",
      };
    }
  }

  function formatCompletionTime(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    return `Selesai: ${date.toLocaleString("id-ID", options)}`;
  }

  function getCategoryBadge(category) {
    if (!category || category === "umum") {
      return "";
    }
    let text,
      bgColor,
      textColor = "text-white";
    if (category === "teori") {
      text = "Teori";
      bgColor = "bg-purple-600";
    } else if (category === "praktikum") {
      text = "Praktikum";
      bgColor = "bg-indigo-600";
    }
    return `<span class="text-xs font-semibold ${bgColor} ${textColor} px-2 py-0.5 rounded-full mr-2">${text}</span>`;
  }

  function createTaskElement(task) {
    const li = document.createElement("li");
    li.className = `bg-white dark:bg-gray-800 shadow-md p-4 rounded-lg flex flex-col transition-all duration-300 ${
      task.completed ? "opacity-60" : ""
    }`;
    li.setAttribute("data-id", task.id);

    const deadlineInfo = formatDeadline(task.deadline);
    let secondaryText = "";

    if (task.completed && task.completedAt) {
      const completionTime = formatCompletionTime(task.completedAt);
      secondaryText = `<p class="text-sm text-green-600 dark:text-green-300">${completionTime}</p>`;
    } else if (!task.completed) {
      secondaryText = `<p class="text-sm ${deadlineInfo.class}">${deadlineInfo.text}</p>`;
    }

    const categoryBadge = getCategoryBadge(task.category);

    li.innerHTML = `
      <div class="task-display w-full">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between">
              <div class="flex-grow mb-3 sm:mb-0 min-w-0">
                  <div class="flex items-center mb-1">
                    ${categoryBadge}
                    <p class="task-name-text font-semibold text-lg break-words ${
                      task.completed
                        ? "line-through text-gray-500 dark:text-gray-400"
                        : ""
                    }" title="${task.name}">${task.name}</p>
                  </div>
                  ${
                    task.description
                      ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2 whitespace-pre-wrap break-words">${task.description}</p>`
                      : ""
                  }
                  ${secondaryText}
              </div>
              <div class="task-controls flex-shrink-0 flex gap-2 w-full sm:w-auto">
                  ${
                    task.completed
                      ? `<button class="undo-btn w-1/2 sm:w-auto text-xs py-2 px-3 rounded-full bg-yellow-600 hover:bg-yellow-700 font-medium transition-colors text-white">Batal</button>`
                      : `<button class="complete-btn w-1/4 sm:w-auto text-xs py-2 px-3 rounded-full bg-green-600 hover:bg-green-700 font-medium transition-colors text-white">Selesai</button>`
                  }
                  <button class="focus-btn w-1/4 sm:w-auto text-xs py-2 px-3 rounded-full bg-cyan-600 hover:bg-cyan-700 font-medium transition-colors text-white ${
                    task.completed ? "hidden" : ""
                  }">Fokus</button>
                  <button class="edit-btn w-1/4 sm:w-auto text-xs py-2 px-3 rounded-full bg-blue-600 hover:bg-blue-700 font-medium transition-colors text-white ${
                    task.completed ? "hidden" : ""
                  }">Edit</button>
                  <button class="delete-btn ${
                    task.completed ? "w-1/2" : "w-1/4"
                  } sm:w-auto text-xs py-2 px-3 rounded-full bg-red-600 hover:bg-red-700 font-medium transition-colors text-white">Hapus</button>
              </div>
          </div>
      </div>

      <div class="task-edit hidden w-full space-y-3">
          <input type="text" value="${
            task.name
          }" class="edit-name-input w-full p-3 rounded-md bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600" />
          <textarea class="edit-desc-input w-full p-3 rounded-md bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600" rows="3">${
            task.description || ""
          }</textarea>
          <div class="flex flex-wrap gap-2">
            <select class="edit-category-input sm:flex-1 p-3 rounded-md bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
              <option value="umum">Umum</option>
              <option value="teori">Teori</option>
              <option value="praktikum">Praktikum</option>
            </select>
            <input type="date" class="edit-date-input p-3 rounded-md bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600" />
            <input type="time" class="edit-time-input p-3 rounded-md bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600" />
          </div>
          <div class="flex gap-2 mt-3">
              <button class="save-edit-btn w-1/2 p-2 rounded-md bg-green-600 hover:bg-green-700 text-white font-medium">Simpan</button>
              <button class="cancel-edit-btn w-1/2 p-2 rounded-md bg-gray-400 hover:bg-gray-500 text-white font-medium">Batal</button>
          </div>
      </div>
    `;

    // --- Event Listener per Tugas ---
    const taskDisplay = li.querySelector(".task-display");
    const taskEdit = li.querySelector(".task-edit");
    const deleteBtn = li.querySelector(".delete-btn");
    const editBtn = li.querySelector(".edit-btn");
    const completeBtn = li.querySelector(".complete-btn");
    const undoBtn = li.querySelector(".undo-btn");
    const focusBtn = li.querySelector(".focus-btn");

    const editNameInput = li.querySelector(".edit-name-input");
    const editDescInput = li.querySelector(".edit-desc-input");
    const editCategoryInput = li.querySelector(".edit-category-input");
    const editDateInput = li.querySelector(".edit-date-input");
    const editTimeInput = li.querySelector(".edit-time-input");
    const saveEditBtn = li.querySelector(".save-edit-btn");
    const cancelEditBtn = li.querySelector(".cancel-edit-btn");

    deleteBtn.addEventListener("click", () => showDeleteModal(task.id));

    if (completeBtn) {
      completeBtn.addEventListener("click", () => toggleTaskComplete(task.id));
    }
    if (undoBtn) {
      undoBtn.addEventListener("click", () => toggleTaskComplete(task.id));
    }
    if (focusBtn) {
      focusBtn.addEventListener("click", () => startFocusMode(task.name));
    }
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        editNameInput.value = task.name;
        editDescInput.value = task.description || "";
        editCategoryInput.value = task.category || "umum";

        if (task.deadline) {
          const deadlineDate = new Date(task.deadline);
          editDateInput.value = deadlineDate.toISOString().split("T")[0];

          const hasTimeComponent =
            (deadlineDate.getUTCHours() !== 0 ||
              deadlineDate.getUTCMinutes() !== 0 ||
              deadlineDate.getUTCSeconds() > 0) &&
            (deadlineDate.getUTCHours() !== 23 ||
              deadlineDate.getUTCMinutes() !== 59);

          if (hasTimeComponent) {
            editTimeInput.value = deadlineDate
              .toTimeString()
              .split(" ")[0]
              .substring(0, 5);
          } else {
            editTimeInput.value = "";
          }
        } else {
          editDateInput.value = "";
          editTimeInput.value = "";
        }

        taskDisplay.classList.add("hidden");
        taskEdit.classList.remove("hidden");
      });
    }

    cancelEditBtn.addEventListener("click", () => {
      taskDisplay.classList.remove("hidden");
      taskEdit.classList.add("hidden");
    });

    saveEditBtn.addEventListener("click", () => {
      const newName = editNameInput.value.trim();
      if (!newName) {
        console.log("Nama tugas tidak boleh kosong!");
        return;
      }

      const newDescription = editDescInput.value.trim();
      const newCategory = editCategoryInput.value;
      const newDate = editDateInput.value;
      const newTime = editTimeInput.value;

      let newDeadline = null;
      if (newDate && newTime) {
        newDeadline = `${newDate}T${newTime}`;
      } else if (newDate) {
        newDeadline = newDate;
      }

      updateTask(task.id, {
        name: newName,
        description: newDescription,
        category: newCategory,
        deadline: newDeadline,
      });

      taskDisplay.classList.remove("hidden");
      taskEdit.classList.add("hidden");
    });

    return li;
  }

  function renderTasks() {
    pendingList.innerHTML = "";
    completedList.innerHTML = "";

    const pending = tasks.filter((t) => {
      return (
        !t.completed &&
        (currentFilter === "all" ||
          t.category === currentFilter ||
          (currentFilter === "umum" && (!t.category || t.category === "umum")))
      );
    });

    const completed = tasks.filter((t) => t.completed);

    pending.sort((a, b) => {
      const aDeadline = a.deadline ? new Date(a.deadline) : null;
      const bDeadline = b.deadline ? new Date(b.deadline) : null;

      if (aDeadline && !bDeadline) return -1;
      if (!aDeadline && bDeadline) return 1;
      if (aDeadline && bDeadline) {
        const diff = aDeadline - bDeadline;
        if (diff !== 0) return diff;
      }

      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aCreated - bCreated;
    });

    completed.sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });

    pendingEmpty.classList.toggle("hidden", pending.length > 0);
    completedEmpty.classList.toggle("hidden", completed.length > 0);

    pending.forEach((task) => {
      pendingList.appendChild(createTaskElement(task));
    });

    completed.forEach((task) => {
      completedList.appendChild(createTaskElement(task));
    });
  }

  // --- Event Listener: Filter & Form Submit ---
  taskForm.addEventListener("submit", addTask);

  filterButtons.addEventListener("click", (e) => {
    if (e.target.classList.contains("filter-btn")) {
      filterButtons.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.classList.remove("active-filter", "bg-blue-600", "text-white");
        btn.classList.add(
          "bg-gray-200",
          "dark:bg-gray-700",
          "text-gray-700",
          "dark:text-gray-300"
        );
      });

      const btn = e.target;
      btn.classList.add("active-filter", "bg-blue-600", "text-white");
      btn.classList.remove(
        "bg-gray-200",
        "dark:bg-gray-700",
        "text-gray-700",
        "dark:text-gray-300"
      );

      currentFilter = btn.dataset.filter;
      renderTasks();
    }
  });

  // --- Inisialisasi Firebase ---
  function initializeFirebase() {
    try {
      if (!firebaseConfig || firebaseConfig.apiKey.startsWith("PASTE_")) {
        throw new Error(
          "Variabel firebaseConfig tidak lengkap. Harap paste dari dasbor Firebase."
        );
      }

      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      auth = getAuth(app);
      setLogLevel("debug");

      handleAuthentication();
    } catch (e) {
      console.error("Gagal menginisialisasi Firebase:", e);
      submitBtn.textContent = "Error: Gagal koneksi";
      submitBtn.classList.add("bg-red-600");
    }
  }

  // --- Autentikasi Firebase ---
  function handleAuthentication() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        userId = user.uid;
        console.log("Pengguna terautentikasi dengan UID:", userId);

        tasksCollectionRef = collection(db, `users/${userId}/tasks`);

        loadTasks();
        submitBtn.disabled = false;
        submitBtn.textContent = "Tambah";
      } else {
        console.log("Pengguna tidak terautentikasi, mencoba login...");
        userId = null;
        if (unsubscribeFromTasks) {
          unsubscribeFromTasks();
        }
        tasks = [];
        renderTasks();

        submitBtn.disabled = true;
        submitBtn.textContent = "Menghubungkan...";

        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Error saat login:", error);
          submitBtn.textContent = "Error: Gagal login";
          submitBtn.classList.add("bg-red-600");
        }
      }
    });
  }

  // --- Mulai Aplikasi ---
  initializeFirebase();
});
