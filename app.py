# app.py
from flask import Flask, render_template, jsonify, request, send_from_directory, make_response
import os
import shutil
import time
import hashlib
import json
import asyncio
from telegram import Bot
from telegram.error import TelegramError, NetworkError, TimedOut, RetryAfter

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Эта папка используется для ЧТЕНИЯ профилей, которые ты добавляешь вручную
app.config['PROFILE_STORAGE_FOLDER'] = os.path.join(BASE_DIR, 'static', 'profiles')

# Эта папка для ВРЕМЕННОГО хранения фото перед отправкой в Telegram
app.config['TEMP_UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'static', 'temp_for_telegram')

# !!! ЗАМЕНИТЕ НА СВОИ ДАННЫЕ !!!
TELEGRAM_BOT_TOKEN = "8024438089:AAE4PLkoFsDsytu-IT33PCka0kW55aabLaI"
TELEGRAM_CHAT_ID = "-1002254618108" # Убедитесь, что это ID супергруппы или канала (начинается с -100)
# !!! КОНЕЦ БЛОКА ДЛЯ ЗАМЕНЫ !!!

telegram_bot = None
if TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_TOKEN != "YOUR_TELEGRAM_BOT_TOKEN":
    try:
        telegram_bot = Bot(token=TELEGRAM_BOT_TOKEN)
        print("Telegram Bot initialized successfully.")
    except Exception as e:
        print(f"Error initializing Telegram Bot: {e}. Check your TELEGRAM_BOT_TOKEN.")
else:
    print("Warning: TELEGRAM_BOT_TOKEN is not set or is still the placeholder. Bot notifications will be disabled.")

# Убеждаемся, что папки существуют
if not os.path.exists(app.config['PROFILE_STORAGE_FOLDER']):
    os.makedirs(app.config['PROFILE_STORAGE_FOLDER'])
    print(f"Created profile storage folder: {app.config['PROFILE_STORAGE_FOLDER']}")

if not os.path.exists(app.config['TEMP_UPLOAD_FOLDER']):
    os.makedirs(app.config['TEMP_UPLOAD_FOLDER'])
    print(f"Created temporary upload folder: {app.config['TEMP_UPLOAD_FOLDER']}")

# --- Функции для работы с данными профилей (ЧТЕНИЕ И ОБНОВЛЕНИЕ ГОЛОСОВ) ---

def generate_unique_id(data_string=""):
    """Генерирует уникальный ID на основе строки и времени."""
    return hashlib.sha1(f"{data_string}{time.time()}{os.urandom(16)}".encode()).hexdigest()[:10]

def load_profiles_from_files():
    """Загружает данные профилей из файлов в PROFILE_STORAGE_FOLDER."""
    profiles = []
    upload_folder = app.config['PROFILE_STORAGE_FOLDER'] # Используем папку для хранения
    if not os.path.exists(upload_folder) or not os.path.isdir(upload_folder):
        print(f"PROFILE_STORAGE_FOLDER not found or is not a directory: {upload_folder}")
        return profiles

    # Перебираем только элементы внутри папки PROFILE_STORAGE_FOLDER
    for folder_name in os.listdir(upload_folder):
        profile_dir = os.path.join(upload_folder, folder_name)
        # Проверяем, что это директория и имя директории не пустое
        if os.path.isdir(profile_dir) and folder_name:
            profile_id = folder_name
            info_file_path = os.path.join(profile_dir, 'info.txt')
            image_file_url, name, contact, image_filename = None, "", "", None
            votes = 0

            # Находим файл изображения (image.jpeg или image.jpg)
            # Ищем только среди файлов в директории профиля
            for fname in os.listdir(profile_dir):
                if os.path.isfile(os.path.join(profile_dir, fname)) and fname.lower() in ['image.jpeg', 'image.jpg']:
                    # Формируем URL для доступа с клиента
                    image_file_url = f'/static/profiles/{profile_id}/{fname}'
                    image_filename = fname
                    break # Нашли изображение, выходим из внутреннего цикла

            # Читаем info.txt
            if os.path.exists(info_file_path) and os.path.isfile(info_file_path):
                try:
                    with open(info_file_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                    name = lines[0].strip() if len(lines) > 0 else ""
                    contact = lines[1].strip() if len(lines) > 1 else ""
                    if len(lines) > 2:
                        try:
                            votes = int(lines[2].strip())
                        except ValueError:
                            votes = 0 # Если не число, считаем 0 голосов
                except Exception as e:
                    print(f"Error reading info.txt for folder '{folder_name}': {e}")
                    continue # Пропускаем этот профиль из-за ошибки чтения info.txt
            else:
                 print(f"Warning: info.txt not found or is not a file for folder '{folder_name}'")
                 continue # Пропускаем, если info.txt отсутствует или не является файлом

            # Добавляем профиль, только если есть ID (название папки), имя и URL изображения
            if profile_id and name and image_file_url:
                 profiles.append({'id': profile_id, 'name': name, 'contact': contact, 'image': image_file_url, 'votes': votes})
            else:
                # Убрано в последней версии, но полезно для отладки:
                # print(f"Warning: Skipping profile in '{profile_dir}' - missing image or name.")
                pass # Просто пропускаем, если данных недостаточно

    return profiles

def update_profile_votes(profile_id, increment=1):
    """Обновляет счетчик голосов для указанного профиля."""
    profile_dir = os.path.join(app.config['PROFILE_STORAGE_FOLDER'], profile_id) # Используем папку для хранения
    info_file_path = os.path.join(profile_dir, 'info.txt')
    # Проверяем, что это директория и файл info.txt существует
    if os.path.isdir(profile_dir) and os.path.exists(info_file_path) and os.path.isfile(info_file_path):
        try:
            # Читаем текущие данные
            lines = []
            try:
                with open(info_file_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            except FileNotFoundError:
                 print(f"Error: info.txt not found for ID '{profile_id}' during read.")
                 return load_profiles_from_files() # Возвращаем текущие данные, если файл пропал внезапно

            name = lines[0].strip() if len(lines) > 0 else ""
            contact = lines[1].strip() if len(lines) > 1 else ""
            current_votes = int(lines[2].strip()) if len(lines) > 2 and lines[2].strip().isdigit() else 0

            new_votes = max(0, current_votes + increment) # Голоса не могут быть меньше 0

            # Перезаписываем info.txt с новым количеством голосов
            with open(info_file_path, 'w', encoding='utf-8') as f:
                f.write(f"{name}\n{contact}\n{new_votes}\n")

            print(f"Updated votes for ID '{profile_id}' to {new_votes}")
        except Exception as e:
            print(f"Error updating info.txt for ID '{profile_id}': {e}")
            # В случае ошибки обновления, логика может быть более сложной,
            # но для простоты возвращаем текущие данные из файлов.

    else:
        print(f"Error: Directory or info.txt not found or is not a file for ID '{profile_id}' at '{profile_dir}'")
        # Если профиль не найден, то он не может быть обновлен.

    # Всегда перезагружаем профили, чтобы вернуть клиенту актуальный список после попытки обновления
    return load_profiles_from_files()


def reset_all_profiles_votes():
    """Сбрасывает счетчик голосов для всех профилей до 0."""
    upload_folder = app.config['PROFILE_STORAGE_FOLDER'] # Используем папку для хранения
    if not os.path.exists(upload_folder) or not os.path.isdir(upload_folder):
        print(f"PROFILE_STORAGE_FOLDER not found or is not a directory for reset: {upload_folder}")
        return [] # Возвращаем пустой список, если папка не существует

    reset_count = 0
    # Перебираем только элементы внутри папки PROFILE_STORAGE_FOLDER
    for folder_name in os.listdir(upload_folder):
        profile_dir = os.path.join(upload_folder, folder_name)
        info_file_path = os.path.join(profile_dir, 'info.txt')
        # Проверяем, что это директория и файл info.txt существует
        if os.path.isdir(profile_dir) and os.path.exists(info_file_path) and os.path.isfile(info_file_path):
            try:
                # Читаем текущие данные (имя и контакт, чтобы не потерять их)
                lines = []
                try:
                    with open(info_file_path, 'r', encoding='utf-8') as f:
                         lines = f.readlines()
                except FileNotFoundError:
                    print(f"Warning: info.txt not found for folder '{folder_name}' during reset - skipping.")
                    continue # Пропускаем этот профиль, если файл пропал

                name = lines[0].strip() if len(lines) > 0 else ""
                contact = lines[1].strip() if len(lines) > 1 else ""
                # Перезаписываем info.txt, устанавливая голоса в 0
                with open(info_file_path, 'w', encoding='utf-8') as f:
                    f.write(f"{name}\n{contact}\n0\n")
                print(f"Reset votes for folder '{folder_name}' to 0")
                reset_count += 1
            except Exception as e:
                print(f"Error resetting votes for folder '{folder_name}': {e}")
                # Продолжаем сброс других профилей даже при ошибке

    print(f"Finished resetting votes for {reset_count} profiles.")
    # Возвращаем обновленный список после сброса
    return load_profiles_from_files()

# --- Async wrapper for Telegram sending ---
async def send_telegram_notification_async(chat_id, photo_path, caption):
    """Асинхронно отправляет фото с подписью в Telegram."""
    if not telegram_bot:
        print("Telegram bot not initialized, cannot send notification.")
        return

    if not chat_id or chat_id == "YOUR_TELEGRAM_CHAT_ID":
        print("TELEGRAM_CHAT_ID not set or placeholder, cannot send notification.")
        return

    if not os.path.exists(photo_path) or not os.path.isfile(photo_path):
        print(f"Photo file not found or is not a file for Telegram: {photo_path}")
        return

    try:
        with open(photo_path, 'rb') as photo_to_send:
            print(f"Attempting to send photo '{photo_path}' to chat ID '{chat_id}'...")
            # Using telegram.Bot methods directly which are blocking,
            # but calling this from an async function allows asyncio.run later.
            sent_message_info = await telegram_bot.send_photo(chat_id=chat_id, photo=photo_to_send, caption=caption)
            print(f"Telegram send_photo response: Message ID = {getattr(sent_message_info, 'message_id', 'N/A')}")
            if sent_message_info and getattr(sent_message_info, 'message_id', None):
                print("Telegram notification sent successfully.")
            else:
                 print("Telegram notification sent, but did not receive a valid message ID.")

    except (NetworkError, TimedOut) as e:
         print(f"Telegram Network/Timeout Error: {e}. Retrying might be needed.")
    except RetryAfter as e:
        print(f"Telegram Rate Limited: {e}. Need to wait {e.retry_after} seconds.")
    except TelegramError as e:
        error_message = str(e).lower()
        if "unauthorized" in error_message or "forbidden" in error_message:
            print(f"Telegram API Error (Authorization/Permission): {e}. Check bot token and chat ID permissions.")
        elif "bad request" in error_message or "chat not found" in error_message:
             print(f"Telegram API Error (Bad Request/Chat Not Found): {e}. Check chat ID format and existence.")
        else:
            print(f"General Telegram API Error: {e}")
    except Exception as e:
        print(f"Unexpected error during Telegram notification: {e}")


# --- Flask Маршруты (API и Страницы) ---

@app.route('/')
def index():
    """Главная страница."""
    return render_template('index.html')

# УДАЛЕН МАРШРУТ ДЛЯ СТРАНИЦЫ ИНСТРУКЦИИ /instructions


@app.route('/api/profiles', methods=['GET'])
def get_profiles_route():
    """Возвращает список профилей и данные кулдаунов."""
    profiles_data = load_profiles_from_files() # Читаем из PROFILE_STORAGE_FOLDER

    # Читаем куки кулдаунов для передачи клиенту
    last_vote_time = int(request.cookies.get('lastVoteTime_simulated', '0'))
    # Читаем куку с массивом времен отправки
    submission_times_str = request.cookies.get('submissionTimes_simulated', '[]')
    try:
        # Убеждаемся, что парсим список чисел
        submission_times = json.loads(submission_times_str)
        if not isinstance(submission_times, list):
             raise TypeError("Cookie value is not a list") # Используем TypeError для не-списков

        # Фильтруем старые метки времени (старше 12 часов) при загрузке
        twelve_hours_ago = int((time.time() - 12*60*60) * 1000)
        # Фильтруем только числа, которые не старше 12 часов назад
        valid_submission_times = [t for t in submission_times if isinstance(t, (int, float)) and t >= twelve_hours_ago]
        # На всякий случай, если в куке оказалось слишком много записей (защита от переполнения куки)
        if len(valid_submission_times) > 100: # Ограничение на количество записей, чтобы не раздувать куку
             valid_submission_times = valid_submission_times[-100:] # Берем последние 100

    except (json.JSONDecodeError, TypeError) as e:
        print(f"Warning: Could not decode or process submissionTimes_simulated cookie: {submission_times_str}. Error: {e}")
        valid_submission_times = [] # Сбрасываем, если кука повреждена или не в ожидаемом формате

    response_data = {
        'profiles': profiles_data,
        'lastVoteTime': last_vote_time,
        'submissionTimes': valid_submission_times # Передаем клиенту актуальный массив времен
    }
    response = make_response(jsonify(response_data))
    response.headers['Access-Control-Allow-Origin'] = '*'
    # Устанавливаем куку с отфильтрованными метками времени обратно клиенту
    # Срок жизни куки 24 часа, чтобы она не исчезла слишком быстро, но логика 12 часов на клиенте
    # samesite='Lax' рекомендуется для безопасности. secure=True требуется для HTTPS. httponly=True делает куку недоступной для JS.
    # Так как JS читает submissionTimes_simulated и lastVoteTime_simulated, httponly=True нельзя ставить для них.
    # response.set_cookie('submissionTimes_simulated', json.dumps(valid_submission_times), max_age=24*60*60, secure=True, samesite='Lax') # Используйте эту строку для HTTPS
    response.set_cookie('submissionTimes_simulated', json.dumps(valid_submission_times), max_age=24*60*60, samesite='Lax')

    # Кука lastVoteTime_simulated тоже должна быть доступна JS
    # Сервер устанавливает эту куку только при успешном голосовании (/api/vote), не здесь.


    return response

@app.route('/api/vote', methods=['POST'])
def vote():
    """Обрабатывает запрос на голосование за профиль."""
    data = request.get_json()
    profile_id = data.get('winnerId')

    if not profile_id:
        return jsonify({'success': False, 'message': 'Winner ID is required'}), 400

    try:
        # Обновляем голоса в PROFILE_STORAGE_FOLDER
        updated_profiles = update_profile_votes(profile_id, increment=1)

        response_data = {'success': True, 'message': 'Vote recorded', 'profiles': updated_profiles}
        response = make_response(jsonify(response_data))

        # Устанавливаем куку времени последнего голосования (используется на клиенте для кулдауна)
        # max_age=12*60*60 + 30*60 (12 часов + 30 минут буфер)
        # samesite='Lax' рекомендуется для безопасности. secure=True требуется для HTTPS.
        # response.set_cookie('lastVoteTime_simulated', str(int(time.time() * 1000)), max_age=12*60*60 + 30*60, secure=True, samesite='Lax') # Используйте эту строку для HTTPS
        response.set_cookie('lastVoteTime_simulated', str(int(time.time() * 1000)), max_age=12*60*60 + 30*60, samesite='Lax')

        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 200

    except Exception as e:
        print(f"API Error during vote for ID {profile_id}: {e}")
        # В случае ошибки, возможно, стоит попытаться загрузить профили еще раз, чтобы вернуть клиенту хоть что-то
        profiles_data_on_error = load_profiles_from_files()
        response = make_response(jsonify({'success': False, 'message': f'An error occurred: {e}', 'profiles': profiles_data_on_error}), 500)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response


@app.route('/api/submit', methods=['POST'])
def submit_profile():
    """Обрабатывает отправку новой анкеты."""
    name = request.form.get('name')
    contact = request.form.get('contact')
    image_file = request.files.get('image')

    if not name or not contact or not image_file:
        response = make_response(jsonify({'success': False, 'message': 'Name, contact, and image are required'}), 400)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    # Проверяем, что image_file - это FileStorage объект и у него есть filename
    if not image_file or not hasattr(image_file, 'filename') or not image_file.filename:
         response = make_response(jsonify({'success': False, 'message': 'Invalid image file provided.'}), 400)
         response.headers['Access-Control-Allow-Origin'] = '*'
         return response


    file_ext = os.path.splitext(image_file.filename)[1].lower()
    if file_ext not in ['.jpg', '.jpeg']:
        response = make_response(jsonify({'success': False, 'message': 'Only JPG or JPEG images are allowed.'}), 400)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    # Генерируем уникальное имя для временной папки
    temp_id = generate_unique_id(f"{name}{contact}")
    temp_dir_path = os.path.join(app.config['TEMP_UPLOAD_FOLDER'], temp_id) # Используем TEMP_UPLOAD_FOLDER
    # Путь к временному файлу изображения (имя image.ext)
    temp_image_filename = 'image' + file_ext
    temp_image_path = os.path.join(temp_dir_path, temp_image_filename)

    try:
        # 1. Создаем временную папку
        os.makedirs(temp_dir_path, exist_ok=True)

        # 2. Сохраняем изображение временно
        image_file.save(temp_image_path)
        print(f"Temporary image saved to: {temp_image_path}")

        # 3. Отправляем в Telegram (используем асинхронный вызов)
        if telegram_bot and TELEGRAM_CHAT_ID and TELEGRAM_CHAT_ID != "YOUR_TELEGRAM_CHAT_ID":
             # Проверяем, существует ли файл после сохранения
             if os.path.exists(temp_image_path) and os.path.isfile(temp_image_path):
                message_text = f"🎉 Новая анкета!\n\n👤 Имя: {name}\n📞 Контакт: {contact}"
                try:
                     # Use asyncio.run for a quick blocking call in a sync Flask app
                     asyncio.run(send_telegram_notification_async(TELEGRAM_CHAT_ID, temp_image_path, message_text))
                except Exception as e:
                     print(f"Error running asyncio task for Telegram: {e}")
             else:
                 print(f"Skipping Telegram: temp image path invalid or file not found after save: {temp_image_path}")
        elif not telegram_bot:
            print("Telegram bot not initialized, skipping notification.")
        else:
            print("TELEGRAM_CHAT_ID not set or placeholder, skipping.")


        # 4. НЕ СОХРАНЯЕМ анкету в PROFILE_STORAGE_FOLDER автоматически.
        #    Ты будешь делать это вручную после проверки.

        # 5. Клиенту не нужно передавать `newProfile` или обновлять список здесь.
        #    Клиент сам обновит куку с временем отправки и покажет сообщение об успехе.

        response_data = {'success': True, 'message': 'Profile data sent to Telegram. It will be reviewed.'}
        response = make_response(jsonify(response_data))
        response.headers['Access-Control-Allow-Origin'] = '*'

        return response, 201 # Status 201 Created

    except Exception as e:
        print(f"API Error during profile submission: {e}")
        # В случае ошибки, можно вернуть информацию об ошибке клиенту
        response = make_response(jsonify({'success': False, 'message': f'Internal error: {e}'}), 500)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    finally:
        # 6. Удаляем временную папку с изображением после обработки
        if os.path.exists(temp_dir_path):
            try:
                # Добавляем небольшую задержку перед удалением, чтобы Telegram успел прочитать файл
                time.sleep(0.5) # Пауза 500ms
                shutil.rmtree(temp_dir_path)
                print(f"Cleaned up temporary directory '{temp_dir_path}'.")
            except Exception as cleanup_e:
                print(f"Error during cleanup of temporary directory '{temp_dir_path}': {cleanup_e}")


@app.route('/api/admin/reset_votes', methods=['POST'])
def admin_reset_votes():
    """Сбрасывает все голоса (адmin функция)."""
    print("Admin API: Request to reset all votes.")
    # !!! В реальном приложении здесь ДОЛЖНА быть надежная серверная проверка аутентификации админа!
    # Клиентская проверка в JS легко обходится.
    try:
        # Сбрасываем голоса в PROFILE_STORAGE_FOLDER
        updated_profiles = reset_all_profiles_votes()
        response = make_response(jsonify({'success': True, 'message': 'All votes reset', 'profiles': updated_profiles}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 200
    except Exception as e:
        print(f"API Error during admin reset votes: {e}")
        # В случае ошибки, можно вернуть информацию об ошибке клиенту
        response = make_response(jsonify({'success': False, 'message': f'Error: {e}'}), 500)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

# Маршрут для обслуживания статических файлов
# Flask по умолчанию обслуживает файлы из папки 'static',
# этот маршрут может быть избыточным, но оставлен для явного контроля.
@app.route('/static/<path:filename>')
def static_files(filename):
    """Обслуживает статические файлы из папки static/."""
    # filename может быть 'style.css', 'script.js', 'profiles/profile_id/image.jpg'
    # send_from_directory корректно обрабатывает подпапки
    # Важно: 'static' - это корневая папка для статики
    return send_from_directory('static', filename)

if __name__ == '__main__':
    print(f"Starting Flask server...")
    print(f"Reading profiles from: {app.config['PROFILE_STORAGE_FOLDER']}")
    print(f"Temporary image storage for Telegram: {app.config['TEMP_UPLOAD_FOLDER']}")
    if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN == "YOUR_TELEGRAM_BOT_TOKEN":
        print("Warning: TELEGRAM_BOT_TOKEN not set or placeholder.")
    if not TELEGRAM_CHAT_ID or TELEGRAM_CHAT_ID == "YOUR_TELEGRAM_CHAT_ID":
        print("Warning: TELEGRAM_CHAT_ID not set or placeholder.")
    if telegram_bot and TELEGRAM_CHAT_ID and TELEGRAM_CHAT_ID != "YOUR_TELEGRAM_CHAT_ID":
        print(f"Telegram notifications enabled to CHAT_ID: {TELEGRAM_CHAT_ID}")
    else:
        print("Telegram notifications are NOT enabled.")

    # debug=True полезен для разработки (автоперезагрузка), но опасен в продакшене
    # host='0.0.0.0' делает сервер доступным по локальной сети (и из Telegram Web App)
    # port=4321 - выбранный порт
    app.run(debug=True, host='0.0.0.0', port=4321)
    