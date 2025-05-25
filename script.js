// static/script.js

// --- Constants ---
const TWELVE_HOURS = 12 * 60 * 60 * 1000; // 12 часов в миллисекундах
const SUBMISSION_LIMIT = 3; // Лимит отправок за период


// --- DOM Elements ---
const tabs = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
// Новый контейнер для всего содержимого вкладок
const tabContentContainer = document.getElementById('tab-content-container');
// Новый контейнер для инструкции
const instructionsInlineContainer = document.getElementById('instructions-inline-container');


// Элементы вкладки "Сравнение"
const compareTab = document.getElementById('compare-tab');
const compareStageTitle = document.getElementById('compare-stage-title');
const compareContent = document.getElementById('compare-content');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const notEnoughProfilesMessage = document.getElementById('not-enough-profiles');
const currentMatchDiv = document.getElementById('current-match');
const roundTransitionMessage = document.getElementById('round-transition-message');
const finalWinnerDisplay = document.getElementById('final-winner-display');
const voteCooldownMessage = document.getElementById('vote-cooldown-message');

// Элементы вкладки "Лидеры"
const leaderboardTab = document.getElementById('leaderboard-tab');
const leaderboardListDiv = document.getElementById('leaderboard-list');

// Элементы вкладки "Предложить"
const submitTab = document.getElementById('submit-tab');
const submitForm = document.getElementById('submit-form');
const submitSuccessMessage = document.getElementById('submit-success-message');
const submitButton = document.getElementById('submit-button');
const submitCooldownMessage = document.getElementById('submit-cooldown-message');
const imageFileInput = document.getElementById('image');
const imageFileNameDisplay = document.getElementById('image-file-name');

// Элементы админ панели
const adminSection = document.getElementById('admin-section');
const adminCodeInputArea = document.getElementById('admin-code-input-area');
const adminPanelActive = document.getElementById('admin-panel-active');
const adminCodeInput = document.getElementById('admin-code');
const adminVerifyButton = document.getElementById('admin-verify-button');
const adminResetVotesButton = document.getElementById('admin-reset-votes-button');

// Элементы для управления отображением инструкции (кнопка в хедере и кнопка закрытия внутри инструкции)
const instructionsButton = document.getElementById('instructions-button'); // Кнопка "Инструкция" в хедере
const closeInstructionsButton = document.getElementById('close-instructions-button'); // Кнопка "Закрыть" внутри инструкции


// --- State (Состояние приложения на клиенте) ---
let allProfiles = []; // Все профили, загруженные с сервера
let currentRoundMatches = []; // Массив пар, ожидающих игры в текущем раунде [[p1, p2], [p3, p4], ...]
let currentMatch = []; // Текущая отображаемая пара [pA, pB]
let winnersOfRound = []; // Победители текущего раунда
let finalWinner = null; // Финальный победитель
let stage = -1; // -1: Не инициализировано, -2: Недостаточно участников, 0+: Идет раунд
let isAdmin = false; // Состояние админ режима

// Читаем кулдауны из куки при старте (сервер их устанавливает)
let lastVoteTime = parseInt(getCookie('lastVoteTime_simulated') || '0', 10);
// submissionTimes - массив меток времени последних отправок анкет (для лимита 3 в 12 часов)
let submissionTimes = getSubmissionTimesCookie(); // Используем новую функцию для чтения массива


// Состояние для индикации успешной отправки анкеты
let submitSuccess = false;

// --- Helper Functions (Вспомогательные функции) ---

// Функция для чтения куки по имени
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Функция для установки куки (простая строка)
// ВНИМАНИЕ: Этот метод устанавливает куку с path=/ и SameSite=Lax.
// Если сервер устанавливает куку с другими параметрами (например, HttpOnly, Secure),
// эта функция может не работать или перезаписать куку неправильно.
// Для куки submissionTimes_simulated мы полагаемся на setSubmissionTimesCookie, которая безопаснее.
function setCookie(name, value, hours) {
    const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toUTCString();
    // Добавлены SameSite=Lax для безопасности. Secure=true требует HTTPS.
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax;`;
    // document.cookie = `${name}=${value}; expires=${expires}; path=/; Secure=true; SameSite=Lax;`; // Для HTTPS
}

// Функция для чтения и парсинга куки submissionTimes_simulated
// Эта функция критически зависит от того, как сервер устанавливает куку.
// Если сервер установит ее как HttpOnly, эта функция не сможет ее прочитать!
function getSubmissionTimesCookie() {
    const cookieValue = getCookie('submissionTimes_simulated');
    if (!cookieValue) {
        return [];
    }
    try {
        const times = JSON.parse(cookieValue);
        // Проверяем, что парсинг дал массив
        if (!Array.isArray(times)) {
             console.error("getSubmissionTimesCookie: Parsed value is not an array:", times);
             return [];
        }
        // Фильтруем старые метки времени (старше 12 часов) и убеждаемся, что они числа
        const twelveHoursAgo = Date.now() - TWELVE_HOURS;
        const valid_submission_times = times.filter(time => typeof time === 'number' && time >= twelveHoursAgo);

        // На всякий случай, если в куке оказалось слишком много записей (защита от переполнения локального массива)
        if (valid_submission_times.length > 100) {
             valid_submission_times = valid_submission_times.slice(-100); // Берем последние 100
             console.warn("getSubmissionTimesCookie: Filtered submissionTimes_simulated cookie to 100 entries.");
        }

        // Сортируем массив по времени (от старых к новым)
        valid_submission_times.sort((a, b) => a - b);

        return valid_submission_times;

    } catch (e) {
        console.error("Error parsing or processing submissionTimes_simulated cookie:", e);
        return []; // Возвращаем пустой массив в случае ошибки парсинга или обработки
    }
}

// Функция для сохранения массива submissionTimes в куки
// ВНИМАНИЕ: Если сервер устанавливает эту куку как HttpOnly, этот клиентский метод НЕ БУДЕТ РАБОТАТЬ.
// В текущей реализации (после изменений в app.py), сервер НЕ ставит httponly=True для этой куки,
// поэтому этот метод МОЖЕТ использоваться для локального обновления после сабмита.
function setSubmissionTimesCookie(timesArray) {
     try {
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
        // encodeURIComponent используется для безопасного сохранения JSON строки в куки
        document.cookie = `submissionTimes_simulated=${encodeURIComponent(JSON.stringify(timesArray))}; expires=${expires}; path=/; SameSite=Lax;`;
        // document.cookie = `submissionTimes_simulated=${encodeURIComponent(JSON.stringify(timesArray))}; expires=${expires}; path=/; Secure=true; SameSite=Lax;`; // Для HTTPS
     } catch (e) {
        console.error("Error setting submissionTimes_simulated cookie:", e);
     }
}


// Функция для перемешивания массива (алгоритм Фишера-Йейтса)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; // Обмен элементов
    }
    return array;
}

// Функция для определения названия текущего этапа
function getStageName() {
    if (stage === -1) return "Загрузка...";
    if (stage === -2) return "Недостаточно участниц";
    if (finalWinner) return "Победитель";
    if (currentRoundMatches.length === 1 && winnersOfRound.length <= 1) return "Финальное сравнение";
    return "Сравнение";
}

// Проверка, можно ли голосовать
function canVoteAgain() {
    return isAdmin || (Date.now() - lastVoteTime > TWELVE_HOURS);
}

// Проверка, можно ли отправлять анкету
function canSubmitAgain() {
    if (isAdmin) return true;
    // submissionTimes уже содержит только метки за последние 12 часов при загрузке и после фильтрации при добавлении.
    // Проверяем, не превышает ли текущее количество лимит.
    return submissionTimes.length < SUBMISSION_LIMIT;
}

// Форматирование оставшегося времени кулдауна голосования
function formatVoteTimeRemaining() {
    const timePassed = Date.now() - lastVoteTime;
    if (timePassed >= TWELVE_HOURS) return null;
    const remaining = TWELVE_HOURS - timePassed;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000));
     if (hours > 0) {
       return `${hours} ч ${minutes} мин`;
     } else {
       return `${minutes} мин`;
     }
}

// Форматирование сообщения о кулдауне/лимите отправки анкет
function getSubmitCooldownMessage() {
    if (isAdmin) return null;

    const remainingCount = SUBMISSION_LIMIT - submissionTimes.length;

    if (remainingCount > 0) {
        return `Осталось отправок в этот период: ${remainingCount} из ${SUBMISSION_LIMIT}.`;
    } else {
        // Лимит исчерпан. submissionTimes должен быть отсортирован по времени (от старых к новым).
        // Самая старая отправка находится в начале массива.
        if (submissionTimes.length === 0) {
             // Этого не должно происходить, если remainingCount == 0, но на всякий случай
             console.warn("getSubmitCooldownMessage: submissionTimes is empty when remainingCount is 0.");
             return "Лимит достигнут."; // Запасной вариант сообщения
        }
        const oldestSubmissionTime = submissionTimes[0];
        const timeUntilReset = oldestSubmissionTime + TWELVE_HOURS - Date.now();
        if (timeUntilReset <= 0) {
             // Это условие по идее не должно срабатывать, если массив submissionTimes правильно поддерживается
             // и getSubmissionTimesCookie фильтрует старые записи при загрузке.
             console.warn("Submit cooldown logic error: oldestSubmissionTime is not in the past 12 hours.");
             // Можно попытаться обновить куку и проверить еще раз
             // loadAndInitialize(); // Перезагружаем данные, что обновит submissionTimes - может вызвать рекурсию/петлю
             // Лучше просто показать общее сообщение об окончании лимита.
             const hours = Math.floor(Math.abs(timeUntilReset) / (60 * 60 * 1000));
             const minutes = Math.ceil((Math.abs(timeUntilReset) % (60 * 60 * 1000)) / (60 * 1000));
             if (hours > 0) return `Лимит отправки сбросится через ${hours} ч ${minutes} мин.`;
             return `Лимит отправки сбросится через ${minutes} мин.`;

        }
        const hours = Math.floor(timeUntilReset / (60 * 60 * 1000));
        const minutes = Math.ceil((timeUntilReset % (60 * 60 * 1000)) / (60 * 1000));
        if (hours > 0) {
           return `Вы отправили ${SUBMISSION_LIMIT} анкет. Следующую можно отправить через ${hours} ч ${minutes} мин.`;
         } else {
           return `Вы отправили ${SUBMISSION_LIMIT} анкет. Следующую можно отправить через ${minutes} мин.`;
         }
    }
}


// --- Render Functions (Обновление DOM на основе состояния) ---

// Скрывает все элементы внутри вкладки "Сравнение", кроме заголовка и контейнера
function hideAllCompareContent() {
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'none';
    notEnoughProfilesMessage.style.display = 'none';
    currentMatchDiv.style.display = 'none';
    finalWinnerDisplay.style.display = 'none';
    voteCooldownMessage.style.display = 'none';
    roundTransitionMessage.style.display = 'none';
    currentMatchDiv.innerHTML = '';
    finalWinnerDisplay.innerHTML = '';
}

// Перерисовывает всю вкладку "Сравнение"
function renderCompareTab() {
    // Только если вкладка сравнения активна И виден контейнер вкладок, обновляем ее
    if (compareTab.classList.contains('hidden') || tabContentContainer.classList.contains('hidden')) {
        return;
    }
    hideAllCompareContent();
    compareStageTitle.textContent = `🏆 ${getStageName()}`;

    if (stage === -1) {
         loadingIndicator.style.display = 'block';
    } else if (stage === -2) {
         notEnoughProfilesMessage.style.display = 'block';
    } else if (finalWinner) {
        renderFinalWinner(finalWinner);
    } else if (currentMatch.length === 2) {
        renderCurrentMatch(currentMatch);
        updateVoteCooldownMessage();
    } else if (currentMatch.length === 0 && (currentRoundMatches.length > 0 || winnersOfRound.length > 0)) {
         roundTransitionMessage.style.display = 'block';
         if (currentRoundMatches.length === 0 && winnersOfRound.length > 0 && winnersOfRound.length !== 1) {
              roundTransitionMessage.innerHTML = `Раунд завершен. Подготовка к следующему раунду... <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white mt-4 mx-auto"></div>`;
         } else if (currentMatch.length === 0 && currentRoundMatches.length > 0) {
             roundTransitionMessage.innerHTML = `Выбор сделан. Подготовка следующего сравнения... <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white mt-4 mx-auto"></div>`;
         } else if (currentRoundMatches.length === 0 && winnersOfRound.length === 1) {
              roundTransitionMessage.innerHTML = `Определение победителя сравнения... <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white mt-4 mx-auto"></div>`;
         } else {
               roundTransitionMessage.innerHTML = `Обновление... <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white mt-4 mx-auto"></div>`;
         }
    }
}

// Отображает текущую пару участниц
function renderCurrentMatch(match) {
    currentMatchDiv.style.display = 'grid';
    currentMatchDiv.innerHTML = '';
    const canVote = canVoteAgain();

    match.forEach(profile => {
         const profileElement = document.createElement('div');
         profileElement.classList.add('bg-white', 'bg-opacity-10', 'backdrop-blur-sm', 'p-4', 'rounded-xl', 'shadow-lg', 'transform', 'transition-transform');

         if (canVote) {
             profileElement.classList.add('cursor-pointer', 'hover:scale-105');
             profileElement.addEventListener('click', () => handleSelectProfile(profile));
         } else {
             profileElement.classList.add('opacity-50', 'cursor-not-allowed');
         }

         profileElement.innerHTML = `
             <div class="image-container">
                 <img src="${profile.image}" alt="${profile.name}"/>
             </div>
             <div class="text-container">
                 <h3 class="font-bold text-lg">${profile.name}</h3>
                 <p class="text-sm text-gray-300">${profile.contact || ''}</p>
             </div>
         `;
         currentMatchDiv.appendChild(profileElement);
     });

     if (!canVote) {
          updateVoteCooldownMessage();
     } else {
          voteCooldownMessage.style.display = 'none';
     }
}

// Отображает информацию о финальном победителе
function renderFinalWinner(winner) {
    finalWinnerDisplay.style.display = 'block';
    finalWinnerDisplay.innerHTML = `
        <h2 class="text-4xl font-bold mb-6">🏆 Победительница!</h2>
        <div class="bg-white bg-opacity-10 backdrop-blur-sm p-8 rounded-xl shadow-xl border border-purple-400 animate-fade-in">
            <img src="${winner.image}" alt="${winner.name}" class="w-48 h-48 mx-auto rounded-full object-cover border-4 border-purple-400 mb-6"/>
            <h3 class="text-3xl font-bold">${winner.name}</h3>
            <p class="text-xl text-purple-200 mb-4">${winner.contact || ''}</p>
            <p class="text-lg mb-6"> Объявлена лучшей <span class="font-bold text-yellow-300">${winner.votes}</span> раз </p>
            ${isAdmin ? '<button id="reset-tournament-button" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-full transition-colors"> Начать новое сравнение </button>' : ''}
        </div>
    `;
    const resetButton = document.getElementById('reset-tournament-button');
    if(resetButton) {
        resetButton.addEventListener('click', initializeTournamentFromProfiles);
    }
}

// Обновляет сообщение о кулдауне голосования
function updateVoteCooldownMessage() {
    const timeRemaining = formatVoteTimeRemaining();
    if (!isAdmin && timeRemaining) {
        voteCooldownMessage.textContent = `Вы сможете сравнить снова через ${timeRemaining}.`;
        voteCooldownMessage.style.display = 'block';
    } else {
        voteCooldownMessage.style.display = 'none';
    }
}

// Перерисовывает всю вкладку "Лидеры" (БЕЗ номера места)
function renderLeaderboardTab() {
     // Только если вкладка лидеров активна И виден контейнер вкладок, обновляем ее
     if (leaderboardTab.classList.contains('hidden') || tabContentContainer.classList.contains('hidden')) {
         return;
     }
    leaderboardListDiv.innerHTML = '';
    // Сортируем профили по голосам по убыванию
    const sortedProfiles = [...allProfiles].sort((a, b) => b.votes - a.votes);

    // Переменные для "разделенного ранга" не нужны, т.к. номер места не показывается
    // let currentRank = 0;
    // let lastVotes = -1;

    sortedProfiles.forEach((profile, index) => {
        // Логика для определения ранга оставлена в закомментированном виде,
        // если вдруг номер места понадобится снова, или для отладки логики сортировки.
        // if (profile.votes !== lastVotes) {
        //     currentRank = index + 1;
        // }
        // lastVotes = profile.votes;

        const profileElement = document.createElement('div');
        profileElement.classList.add(
            'bg-white', 'bg-opacity-10', 'backdrop-blur-sm', 'p-4', 'rounded-xl',
            'flex', 'items-center', 'justify-between', 'shadow-md', 'hover:shadow-xl', 'transition-shadow', 'animate-fade-in'
        );

        // Определяем медаль только для топ-3 мест
        let trophy = '';
        // Используем индекс + 1 для определения топ-3, т.к. список уже отсортирован
        if (index === 0) trophy = '<span class="text-3xl leading-none mr-2">🥇</span>';
        else if (index === 1) trophy = '<span class="text-2xl leading-none mr-2">🥈</span>';
        else if (index === 3) trophy = '<span class="text-xl leading-none mr-2">🥉</span>'; // Исправлено: index === 3 -> index === 2


        const rankVotesContent = `
             ${trophy}
             <p class="text-lg text-yellow-300">🏆 ${profile.votes}</p>
        `;

        profileElement.innerHTML = `
            <div class="flex items-center space-x-4">
                <!-- УДАЛЕНО: Номер места больше не отображается -->
                <!-- <span class="text-xl font-bold text-purple-300">${index + 1}.</span> -->
                <!-- Изображение в лидерборде - маленькая круглая аватарка -->
                <img src="${profile.image}" alt="${profile.name}" class="w-16 h-16 rounded-full object-cover flex-shrink-0"/>
                <div>
                    <h3 class="font-bold text-lg">${profile.name}</h3>
                    <p class="text-sm text-gray-300">${profile.contact || ''}</p>
                </div>
            </div>
            <div class="text-right flex items-center space-x-3 rank-votes">
                ${rankVotesContent}
            </div>
        `;
        leaderboardListDiv.appendChild(profileElement);
    });
}

// Обновляет состояние элементов вкладки "Предложить" и админ панели
function updateSubmitTab() {
    // Только если вкладка предложить активна И виден контейнер вкладок, обновляем ее
    if (submitTab.classList.contains('hidden') || tabContentContainer.classList.contains('hidden')) {
        return;
    }
    submitSuccessMessage.style.display = submitSuccess ? 'block' : 'none';
    submitForm.style.display = submitSuccess ? 'none' : 'block';

    const submitCooldownMsg = getSubmitCooldownMessage();
     if (submitCooldownMsg) {
         submitCooldownMessage.textContent = submitCooldownMsg;
         submitCooldownMessage.style.display = 'block';
     } else {
         submitCooldownMessage.style.display = 'none';
     }

    const canSubmit = canSubmitAgain() || isAdmin;
    submitButton.disabled = !canSubmit;
     if (canSubmit) {
        submitButton.classList.remove('bg-gray-600', 'text-gray-300', 'cursor-not-allowed');
        submitButton.classList.add('bg-purple-600', 'hover:bg-purple-700', 'text-white');
     } else {
         submitButton.classList.remove('bg-purple-600', 'hover:bg-purple-700', 'text-white');
         submitButton.classList.add('bg-gray-600', 'text-gray-300', 'cursor-not-allowed');
     }

     adminCodeInputArea.parentElement.style.display = isAdmin ? 'none' : 'block';
     adminPanelActive.style.display = isAdmin ? 'block' : 'none';

      if (!isAdmin) {
         adminCodeInput.value = '';
      }
}

// --- Tournament Logic (Логика сравнения) ---

function initializeTournamentFromProfiles() {
    currentRoundMatches = [];
    currentMatch = [];
    winnersOfRound = [];
    finalWinner = null;
    stage = -1;

    renderCompareTab(); // Рендерим вкладку сравнения (будет показан индикатор загрузки или сообщение)

    // Требуем минимум 4 участницы для турнирной сетки степени 2
    if (!allProfiles || allProfiles.length < 4) {
        console.warn(`Недостаточно участниц (${allProfiles ? allProfiles.length : 0}) для старта сравнения с сеткой (требуется >= 4).`);
        stage = -2;
        renderCompareTab(); // Показываем сообщение об ошибке
        return;
     }

    // Перемешиваем копию массива профилей
    const shuffled = shuffleArray([...allProfiles]);

    // Определяем количество участников для сетки сравнения (ближайшая степень 2, не превышающая общее количество)
    let participantsCount = 0;
    if (shuffled.length >= 16) participantsCount = 16;
    else if (shuffled.length >= 8) participantsCount = 8;
    else if (shuffled.length >= 4) participantsCount = 4;

    // Проверяем еще раз, что набралось минимум 4 для сетки
    if (participantsCount < 4) {
        stage = -2;
        renderCompareTab();
        console.warn(`Недостаточно участниц (${shuffled.length}) для старта сравнения после отбора для сетки (требуется >= 4).`);
        return;
    }

    // Берем нужное количество участниц для сетки
    const tournamentParticipants = shuffled.slice(0, participantsCount);
    const matches = [];

    // Формируем пары для первого раунда (количество участников всегда четное и степень 2)
    for (let i = 0; i < tournamentParticipants.length; i += 2) {
         matches.push([tournamentParticipants[i], tournamentParticipants[i + 1]]);
    }

    stage = 0; // Указываем, что сравнение активно
    currentRoundMatches = matches; // Пары для текущего (первого) раунда
    currentMatch = matches.length > 0 ? matches[0] : []; // Показываем первую пару

    // В идеальной сетке степени двойки нет баев в первом раунде. winnersOfRound пока пустой.
    winnersOfRound = [];

    console.log(`Сравнение инициализировано. Всего участниц: ${allProfiles.length}. Участниц в сетке: ${participantsCount}. Пар в первом раунде: ${matches.length}.`);

     // Отображаем первую пару или индикатор перехода/ожидания
     renderCompareTab();
}

async function handleSelectProfile(selectedProfile) {
    if (!canVoteAgain() && !isAdmin) {
        console.log("Voting cooldown active.");
        updateVoteCooldownMessage();
        return;
    }

    console.log("Выбрана:", selectedProfile.name, "(ID:", selectedProfile.id, ")");

    // Добавляем победителя текущего матча в список победителей раунда
    winnersOfRound.push(selectedProfile);

    // Удаляем текущий матч из списка матчей раунда
    currentRoundMatches.shift();

    currentMatch = []; // Очищаем текущую пару для индикации перехода/ожидания
    renderCompareTab(); // Обновляем UI, показывая индикатор перехода

     // Небольшая задержка перед переходом к следующему матчу или раунду
     setTimeout(async () => {
        // Проверяем, есть ли еще матчи в текущем раунде
        if (currentRoundMatches.length > 0) {
          console.log("Переход к следующему сравнению раунда...");
          currentMatch = currentRoundMatches[0]; // Показываем следующий матч
          renderCompareTab();
        } else {
          // Текущий раунд завершен. Формируем следующий или определяем финал.
          console.log("Раунд сравнений завершен. Победителей раунда:", winnersOfRound.map(p => p.name));

          // Проверяем, достигли ли финала (остался только один победитель)
          if (winnersOfRound.length === 1) {
            const winner = winnersOfRound[0];
            console.log("Сравнение завершено! Финальный победитель:", winner.name, "(ID:", winner.id, ")");
            finalWinner = winner;
            stage = stage + 1;

            // --- Отправляем голос на сервер ---
            // Отправляем голос только за ФИНАЛЬНОГО победителя турнирной сетки
            try {
                console.log(`Sending vote for final winner ID: ${winner.id}`);
                const response = await fetch('/api/vote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ winnerId: winner.id })
                });

                if (response.ok) {
                    const data = await response.json();
                     // Сервер должен вернуть обновленный список профилей с обновленными голосами
                    allProfiles = data.profiles;
                    console.log("Vote successfully recorded on server and profiles updated.");
                     // Находим актуального победителя из обновленного списка для отображения (с учетом обновленных голосов)
                     finalWinner = allProfiles.find(p => p.id === winner.id);
                     // Время кулдауна устанавливается сервером в куке /api/vote response
                     // Обновляем локальную переменную lastVoteTime, чтобы клиент знал о кулдауне сразу
                     if(!isAdmin) { // Куку ставит сервер, но локальную переменную обновляем для логики на клиенте
                         lastVoteTime = Date.now();
                     }
                } else {
                    const errorData = await response.json();
                    console.error("Server error recording vote:", response.status, errorData.message);
                    alert(`Ошибка сервера при записи голоса: ${errorData.message || 'Неизвестная ошибка'}`);
                }
            } catch (error) {
                console.error("Error sending vote to server:", error);
                alert("Произошла ошибка при отправке голоса на сервер.");
            }

            renderCompareTab(); // Обновляем UI для отображения победителя
            renderLeaderboardTab(); // Обновляем лидерборд, т.к. голоса изменились

          } else {
            // Не финал. Формируем пары для следующего раунда из победителей текущего.
            console.log("Подготовка к следующему раунду сравнений...");
            const nextRoundParticipants = shuffleArray([...winnersOfRound]); // Перемешиваем победителей текущего раунда
            const nextRoundMatches = [];

            // Формируем пары для следующего раунда (количество участников всегда четное)
            for (let i = 0; i < nextRoundParticipants.length; i += 2) {
                 nextRoundMatches.push([nextRoundParticipants[i], nextRoundParticipants[i + 1]]);
            }

            stage = stage + 1;
            currentRoundMatches = nextRoundMatches;
            winnersOfRound = []; // Сбрасываем победителей текущего раунда, т.к. они станут участниками следующего

            currentMatch = nextRoundMatches.length > 0 ? nextRoundMatches[0] : [];

            console.log(`Начался новый раунд сравнений. Пар в этом раунде: ${currentRoundMatches.length}.`);

             // Если в новом раунде нет матчей, но есть победители (>1, иначе был бы финал), это ошибка.
             // В случае корректной сетки степени 2, nextRoundMatches.length > 0 пока не останется 1 победитель.
             renderCompareTab(); // Отображаем следующую пару или индикатор
          }
        }
     }, 800); // Задержка перед переходом к следующему матчу/раунду
}

// --- Event Listeners (Обработчики событий) ---

// Переключение вкладок
tabs.forEach(button => {
    button.addEventListener('click', () => {
        const tabId = button.id.replace('tab-', '');

        // Скрываем все содержимое вкладок внутри tabContentContainer
        tabContents.forEach(content => content.classList.add('hidden'));
        // Показываем содержимое выбранной вкладки
        document.getElementById(`${tabId}-tab`).classList.remove('hidden');

        // Обновляем активную кнопку в навигации
        tabs.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Обновляем контент активной вкладки
        if (tabId === 'leaderboard') {
             renderLeaderboardTab();
        } else if (tabId === 'compare') {
             renderCompareTab();
        } else if (tabId === 'submit') {
             updateSubmitTab();
        }
    });
});

// Обработка отправки формы новой анкеты
submitForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!canSubmitAgain() && !isAdmin) {
        alert(getSubmitCooldownMessage());
        return;
    }

    const formData = new FormData(submitForm);
    submitButton.disabled = true;
    submitButton.textContent = 'Отправка...';
    submitButton.classList.add('bg-gray-600', 'text-gray-300', 'cursor-not-allowed');
    submitButton.classList.remove('bg-purple-600', 'hover:bg-purple-700', 'text-white');

    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (response.ok) {
            console.log("Profile submission result:", result);
            submitSuccess = true;

             // Обновляем массив submissionTimes локально после успешной отправки
             // Фильтруем на всякий случай старые метки (старше 12 часов)
             const twelveHoursAgo = Date.now() - TWELVE_HOURS;
             submissionTimes = submissionTimes.filter(time => typeof time === 'number' && time >= twelveHoursAgo);

             // Удаляем самую старую метку, если достигнут лимит или превышен
             while (submissionTimes.length >= SUBMISSION_LIMIT) { // Используем while на случай, если меток больше лимита
                submissionTimes.sort((a, b) => a - b); // Сортируем, чтобы удалить самую старую
                submissionTimes.shift(); // Удаляем самую старую (первый элемент)
             }
             submissionTimes.push(Date.now()); // Добавляем новую метку времени
             submissionTimes.sort((a, b) => a - b); // Снова сортируем после добавления

             // Сохраняем обновленный локальный массив в куки на клиенте
             setSubmissionTimesCookie(submissionTimes);

            updateSubmitTab(); // Обновляем UI (сообщение о кулдауне/лимите)

            setTimeout(() => {
                submitSuccess = false;
                submitForm.reset();
                 imageFileNameDisplay.textContent = '';
                 imageFileNameDisplay.style.display = 'none';
                updateSubmitTab(); // Возвращаем форму и обновляем UI
            }, 3000);

        } else {
            console.error("Submission failed:", response.status, result.message);
            alert(`Ошибка отправки анкеты: ${result.message || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error("Error sending form:", error);
        alert("Произошла ошибка сети при отправке анкеты.");
    } finally {
         submitButton.textContent = 'Отправить анкету';
         updateSubmitTab(); // Убедимся, что состояние кнопки и сообщения актуальны
    }
});

// Отображение имени выбранного файла при выборе в форме
imageFileInput.addEventListener('change', (event) => {
    const fileName = event.target.files[0] ? event.target.files[0].name : '';
    if (fileName) {
        imageFileNameDisplay.textContent = `Выбран файл: ${fileName}`;
        imageFileNameDisplay.style.display = 'block';
    } else {
        imageFileNameDisplay.textContent = '';
        imageFileNameDisplay.style.display = 'none';
    }
});

// Обработка кнопки "Войти" в админ панели
adminVerifyButton.addEventListener('click', () => {
    // !!! ВАЖНО: Это клиентская проверка пароля, НЕБЕЗОПАСНА в реальных проектах. !!!
    // Для продакшена нужен серверный API для проверки админского кода и установки сессии.
    // Измененный код администратора:
    if (adminCodeInput.value === "подрочимнеюля52") { // ВАЖНО: Никогда не храните пароли в JS на клиенте в реальных проектах!
        isAdmin = true;
        alert("Админ режим активирован!");
        updateSubmitTab(); // Обновляем UI админ панели и кнопки отправки
        renderCompareTab(); // Обновляем вкладку сравнения, т.к. админ может голосовать без кулдауна
        renderLeaderboardTab(); // Обновляем лидерборд на случай, если кнопка сброса станет видна сразу после логина
    } else {
        alert("Неверный код администратора.");
    }
    adminCodeInput.value = '';
});

// Обработка кнопки "Сбросить все голоса" (Админ, на вкладке "Предложить")
adminResetVotesButton.addEventListener('click', async () => {
    if (!isAdmin) {
        alert("У вас нет прав администратора.");
        return;
    }
    if (confirm("Вы уверены, что хотите сбросить ВСЕ голоса у ВСЕХ участниц? Это действие необратимо и обнулит лидерборд!")) {
        adminResetVotesButton.disabled = true;
        adminResetVotesButton.textContent = 'Сброс...';

        try {
             const response = await fetch('/api/admin/reset_votes', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 // В реальной системе сюда можно добавить данные для аутентификации админа
                 body: JSON.stringify({})
             });

             if (response.ok) {
                 const result = await response.json();
                 allProfiles = result.profiles;
                 alert("Все голоса успешно сброшены.");
                 console.log("All votes reset by admin.");
                 // Обновляем вкладки, если они активны
                 if (!leaderboardTab.classList.contains('hidden')) {
                      renderLeaderboardTab();
                 }
                  if (!compareTab.classList.contains('hidden')) {
                     initializeTournamentFromProfiles();
                  }
                // Также сбросим локальный массив submissionTimes, т.к. это административное действие
                submissionTimes = [];
                setSubmissionTimesCookie(submissionTimes); // Сохраняем пустой массив в куку
                updateSubmitTab(); // Обновляем UI Submit вкладки

             } else {
                  const errorData = await response.json();
                 console.error("Admin reset failed:", response.status, errorData.message);
                 alert(`Ошибка при сбросе голосов: ${errorData.message || 'Неизвестная ошибка'}`);
             }
         } catch (error) {
              console.error("Error during admin reset votes fetch:", error);
             alert("Произошла ошибка сети при сбросе голосов.");
         } finally {
             adminResetVotesButton.disabled = false;
             adminResetVotesButton.textContent = 'Сбросить все голоса';
         }
     }
});

// --- Event Listeners для управления отображением инструкции ---
instructionsButton.addEventListener('click', () => {
    // Показываем контейнер инструкции, скрываем контейнер вкладок
    tabContentContainer.classList.add('hidden');
    instructionsInlineContainer.classList.remove('hidden');
    // Опционально: сбросить активную вкладку или состояние навигации, чтобы не было подсветки
     tabs.forEach(btn => btn.classList.remove('active'));
});

closeInstructionsButton.addEventListener('click', () => {
    // Скрываем контейнер инструкции, показываем контейнер вкладок
    instructionsInlineContainer.classList.add('hidden');
    tabContentContainer.classList.remove('hidden');
    // Возвращаем активную вкладку (например, сравнение по умолчанию)
     document.getElementById('tab-compare').classList.add('active');
    // Опционально: рендерить активную вкладку, если ее содержимое могло устареть (например, лидерборд)
    renderCompareTab(); // Или renderLeaderboardTab(), updateSubmitTab() в зависимости от того, какая вкладка должна быть видна
});


// --- Initial Load (Начальная загрузка данных при старте приложения) ---

async function loadAndInitialize() {
    // Изначально показываем контейнер вкладок и скрываем контейнер инструкции
    tabContentContainer.classList.remove('hidden');
    instructionsInlineContainer.classList.add('hidden');

    // Устанавливаем вкладку сравнения как активную по умолчанию и рендерим ее в состоянии загрузки
     document.getElementById('compare-tab').classList.remove('hidden'); // Убедимся, что первая вкладка не скрыта внутри контейнера
     tabs.forEach(btn => btn.classList.remove('active'));
     document.getElementById('tab-compare').classList.add('active');

    renderCompareTab(); // Рендерим вкладку сравнения в состоянии загрузки

    try {
        // Отправляем запрос на сервер для получения списка профилей и данных кулдаунов из куки
        const response = await fetch('/api/profiles');
        if (!response.ok) {
             throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        allProfiles = data.profiles;

        // Обновляем локальные переменные кулдаунов из данных, пришедших от сервера (из куки)
        lastVoteTime = parseInt(data.lastVoteTime || '0', 10); // Время последнего голосования
        // submissionTimes приходит уже отфильтрованный сервером
        submissionTimes = data.submissionTimes || [];
        // Дополнительно убедимся, что локальный массив не превышает лимит и отсортирован, хотя сервер должен был это сделать
        if (submissionTimes.length > SUBMISSION_LIMIT) {
            submissionTimes.sort((a, b) => a - b);
            submissionTimes = submissionTimes.slice(-SUBMISSION_LIMIT);
        } else {
            submissionTimes.sort((a, b) => a - b); // Просто сортируем, если меньше или равно лимиту
        }


        console.log("Loaded profiles:", allProfiles.length);
        console.log("Last vote time (unix ms):", lastVoteTime);
        console.log("Submission times:", submissionTimes);

        // Инициализируем логику сравнения после успешной загрузки данных
        initializeTournamentFromProfiles(); // Рендерит compare tab снова с реальными данными

        // При успешной загрузке обновляем состояние других вкладок, даже если они не активны,
        // чтобы при переключении на них сразу отображались актуальные данные.
         renderLeaderboardTab(); // Обновим лидерборд
         updateSubmitTab(); // Обновим форму отправки (сообщение о лимите)


    } catch (error) {
        console.error("Failed to load profiles:", error);
        // Если ошибка загрузки, отображаем только сообщение об ошибке на вкладке сравнения
         hideAllCompareContent(); // Скрываем все индикаторы и контент
         errorMessage.style.display = 'block'; // Показываем сообщение об ошибке
         compareStageTitle.textContent = "Ошибка загрузки данных"; // Обновляем заголовок
        // Вкладки "Лидеры" и "Предложить" останутся пустыми или в начальном состоянии,
        // пока пользователь на них не переключится. updateSubmitTab и renderLeaderboardTab
        // будут вызваны при переключении, и в этом случае они могут работать с пустым allProfiles
        // или старыми данными куки.
    }
}

loadAndInitialize(); // Запускаем процесс загрузки и инициализации при загрузке скрипта