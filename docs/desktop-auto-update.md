# Desktop Auto-Update (Tauri + GitHub Releases)

## Что реализовано
- Клиент использует официальный `tauri-plugin-updater`.
- Источник обновлений фиксирован через `plugins.updater.endpoints` в `tauri.conf.json`.
- Проверка подписи обязательна через `plugins.updater.pubkey`.
- В Settings есть ручная проверка, загрузка, установка и перезапуск для применения обновления.
- При старте выполняется фоновая проверка, при наличии версии показывается баннер.

## Важно по безопасности
- Никогда не публикуйте приватный ключ подписи в репозитории.
- В репо должен быть только **публичный** ключ (`pubkey` в tauri config).
- Подписи артефактов выполняются в CI через секреты:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (опционально)

## Формат update manifest (`latest.json`)

```json
{
  "version": "1.0.0",
  "notes": "Release notes",
  "pub_date": "2026-04-03T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.0/SecureMessenger_1.0.0_x64-setup.exe",
      "signature": "<base64 minisign signature>"
    }
  }
}
```

## Как выпустить новую версию
1. Обновить версию клиента в:
   - `apps/client-desktop/package.json`
   - `apps/client-desktop/src-tauri/tauri.conf.json`
2. Убедиться, что `plugins.updater.endpoints` указывает на ваш GitHub repo.
3. Создать тег и пушнуть его:

```bash
git tag v1.0.0
git push origin v1.0.0
```

4. Workflow `.github/workflows/desktop-release.yml`:
   - собирает NSIS installer,
   - генерирует `.sig`,
   - генерирует `latest.json`,
   - публикует артефакты в GitHub Release.

## Beta канал (минимум)
- Поддержан отдельный конфиг: `apps/client-desktop/src-tauri/tauri.beta.conf.json`.
- Для beta-сборок используйте этот config и отдельный manifest endpoint (`latest-beta.json`).
- В текущем v1 канал выбирается как release policy (через endpoint), а не через отдельный backend сервис.

## Быстрая локальная проверка
1. Собрать клиент:
```bash
npm run build:client
```
2. Запустить Tauri dev и проверить Settings -> Updates.
3. Нажать «Проверить обновления» и убедиться, что статус меняется корректно.
4. При доступном апдейте проверить:
   - progress бар,
   - переход в `downloaded`,
   - кнопку «Перезапустить и применить».
