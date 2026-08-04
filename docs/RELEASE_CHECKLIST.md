# Release checklist

## Один раз для репозитория

- [x] Выбрана лицензия MIT; добавлен корневой `LICENSE`.
- [ ] Включить GitHub **Private vulnerability reporting**.
- [ ] Настроить branch protection для `main`.
- [ ] Приобрести Windows code-signing certificate; добавить signing secrets в GitHub Actions.

## Каждый релиз

- [ ] Обновить `package.json`, `package-lock.json`, `CHANGELOG.md`.
- [ ] Выполнить `npm ci` и `npm run check`.
- [ ] Выполнить `npm audit --omit=dev`.
- [ ] Проверить light/dark, RU/EN, 760×560 и 1200×820.
- [ ] Проверить splash не менее 2 секунд, titlebar, capture area/window/full/clipboard.
- [ ] Проверить import, duplicate, tags, rename, favorite, trash, restore, backup.
- [ ] Проверить Settings → Database integrity.
- [ ] Собрать `npm run dist:portable` и `npm run dist`.
- [ ] Проверить `Get-AuthenticodeSignature` для обоих EXE.
- [ ] Создать SHA-256: `Get-FileHash <exe> -Algorithm SHA256`.
- [ ] Установить installer на чистой Windows VM; запустить portable без установки.
- [ ] Проверить Windows scale 100%, 125%, 150% и multi-monitor capture.
- [ ] Создать tag `vX.Y.Z`; GitHub Actions соберёт и приложит portable artifact.
- [ ] Опубликовать release notes и известные ограничения.

## Rollback

- Не удалять `%USERPROFILE%\Pictures\Visual Vault` при uninstall/rollback.
- Перед миграцией схемы создавать `.vvbackup`.
- Хранить предыдущий подписанный EXE и SHA-256 в GitHub Release.
