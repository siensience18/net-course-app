# Курс по сетям — сайт

Статический сайт для прохождения курса. Содержимое курса лежит в `docs/data.bin`
в зашифрованном виде (AES-GCM, ключ из логина и пароля через PBKDF2) и расшифровывается в браузере после входа.

## Пересборка после изменений в курсе

```powershell
npm install
node build.mjs ..\net-course
git add -A; git commit -m "Обновил курс"; git push
```

GitHub Pages раздаёт папку `docs/` из ветки `main`.
