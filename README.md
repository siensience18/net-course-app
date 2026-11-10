# Курс по сетям — сайт

Статический сайт для прохождения курса. Содержимое курса лежит в `docs/data.bin`
в зашифрованном виде (AES-GCM, ключ из логина и пароля через PBKDF2) и расшифровывается в браузере после входа.

## Запуск на своём компьютере

Дважды щёлкни `start.bat` (нужен Node.js или Python). Откроется http://localhost:8765/.
Окно с сервером не закрывай, пока занимаешься. Перед запуском `start.bat` подтягивает обновления с GitHub.

Без `start.bat`: `node serve.mjs` или `python -m http.server 8765 --directory docs`.
Открывать `docs/index.html` двойным щелчком нельзя: браузер не даст загрузить курс с `file://`.

## Пересборка после изменений в курсе

```powershell
npm install
node build.mjs ..\net-course
git add -A; git commit -m "Обновил курс"; git push
```

GitHub Pages раздаёт папку `docs/` из ветки `main`.
