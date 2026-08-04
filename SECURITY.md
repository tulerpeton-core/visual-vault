# Security Policy

## Supported versions

Исправления безопасности выпускаются для последней версии Visual Vault.

## Reporting a vulnerability

Не публикуйте уязвимость в обычном Issue. Используйте **Security → Advisories → Report a vulnerability** в GitHub-репозитории. Укажите версию, Windows build, шаги воспроизведения и ожидаемый ущерб.

## Security model

Visual Vault — local-first приложение без сетевого API. Renderer изолирован через Electron sandbox/context isolation; доступ к файловой системе идёт через ограниченный IPC bridge. Библиотека по умолчанию хранится в `%USERPROFILE%\Pictures\Visual Vault`.

Windows EXE 0.5.6 пока не подписан. Проверяйте SHA-256 из GitHub Release и скачивайте файл только из официального репозитория.
