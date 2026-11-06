# План перехода на FSD, TypeScript и esbuild

Статус: выполняется. Исходная версия: `1.13.3`, коммит `1d97afe`.
Ветка: `codex/fsd-typescript-refactor`. Все этапы выполняются последовательно
в этой ветке. Публикация и push — только по отдельному указанию владельца.
В коммиты не добавляются подписи Codex, отметки об ИИ или Co-authored-by.

## Цель и ограничения

Сохранить пользовательские сценарии, настройки, авторизацию через существующие
GitLab/Jira-сессии, совместимость API и локализации. Разделить код по FSD,
типизировать контракты, собирать воспроизводимый артефакт и сократить объём кода,
который выполняется на посторонних страницах. Изменения поведения и оптимизации
проверять отдельно от механического переноса.

Начальная проверка: 813 тестов проходят. Runtime JavaScript — 13 379 строк.
На все HTTPS-страницы manifest назначает 473 121 байт JavaScript (462,0 КиБ);
на современные страницы MR дополнительно 77 511 байт (75,7 КиБ).
Это размеры исходных файлов, а не измерение CPU, задержки или памяти браузера.

## Структура

```text
src/
  app/
    entrypoints/          # background, content, popup, welcome
    content/              # обнаружение GitLab, маршрутизация, lifecycle
    background/           # регистрация обработчиков и восстановление задач
  pages/
    settings/             # ui, model: глобальные и проектные настройки
    welcome/              # ui
    gitlab/               # композиция расширения на страницах GitLab
  widgets/
    mr-toolbar/           # панель MR и связанные представления
    mr-list/              # дополнения списка MR
    review-dialog/        # picker и preview AI review
    review-import/        # редактирование и подтверждение публикации
    jira-panel/           # sidebar и вложения
    task-tracker/         # отображение фоновых задач
    command-palette/
    pipeline-actions/
    commit-actions/
  features/
    mr-actions/           # пользовательские сценарии MR, включая Ship
    cherry-pick/           # перенос изменений и восстановление конфликтов
    review-export/        # подготовка контекста AI
    review-import/        # проверка ответа AI и публикация
    job-chains/           # выполнение последовательностей CI jobs
    jira-actions/
    standup/
    settings-transfer/
  entities/
    merge-request/        # api, model
    pipeline/             # api, model
    discussion/           # api, model
    jira-issue/           # api, model
    settings/             # model: defaults, profiles, validation
    review/               # model: scope, instructions, response contracts
  shared/
    api/                  # HTTP и Chrome messaging transport
    lib/                  # небольшие библиотеки: version, diff, DOM, lifecycle
    config/               # среда выполнения и настройки приложения
    i18n/
    ui/                   # базовые элементы, toast, modal, общие стили
public/                   # manifest, icons, locales, HTML/CSS-ресурсы
scripts/                  # build, watch, package, архитектурные проверки
tests/                    # регрессии, браузерные fixtures, performance checks
dist/                     # только результат сборки, не хранится в Git
```

Дерево задаёт границы ответственности; пустые каталоги и сегменты заранее не
создаются. Большие слайсы делятся по реальным зависимостям, а не по числу строк.

## Правила архитектуры

- Зависимости направлены `app → pages → widgets → features → entities → shared`.
  Слайсы одного слоя изолированы; композиция располагается выше.
- Внешние потребители используют явный public API слайса. Внутри слайса —
  относительные импорты. Нет общего barrel-файла всех фич или всего shared.
- `app` и `shared` делятся на сегменты, остальные слои — на слайсы и сегменты.
- DOM, privileged Chrome APIs и чистая логика имеют отдельные точки подключения.
  Background не импортирует DOM UI; контракты не инициализируют UI при импорте.
- Обработчики service worker регистрируются синхронно. Постоянное состояние
  задач хранится отдельно от живых Promise, таймеров и DOM.
- TypeScript strict для новых и перенесённых модулей; отсутствие blanket
  `@ts-nocheck`, `@ts-ignore` и массового `any` как способа скрыть миграцию.
  Временный JS разрешён только пока отмеченные ниже этапы ещё не завершены.
- Runtime validation остаётся на границах: сообщения, импорт настроек/ревью,
  ответы API. Типы не заменяют эти проверки.
- Команды между UI-модулями передаются напрямую через контракты; обмен с
  background использует Chrome messaging. Страница не получает канал запуска
  привилегированных действий расширения.
- Изменение маршрута отменяет устаревшие запросы, отключает observers и listeners.
  Нельзя сбрасывать редактируемый preview в обход существующего подтверждения.

## Последовательность коммитов

| № | Коммит | Результат и проверка |
| --- | --- | --- |
| 01 | `docs: define FSD migration and acceptance plan` | Этот план, исходная точка, ограничения и порядок работ |
| 02 | `build: add TypeScript and esbuild toolchain` | npm lockfile, build/watch/typecheck, dist, единая упаковка и CI; старые сценарии проходят |
| 03 | `test: verify built extension and migration baseline` | Тестовый доступ к модулям вместо зависимости от корневых JS; браузерные smoke-сценарии и размеры артефакта |
| 04 | `refactor: extract shared libraries and domain contracts` | Типы, pure helpers, настройки, i18n и review contracts; проверки импортов FSD |
| 05 | `refactor: migrate AI review to typed FSD slices` | Export/import/workflow и соответствующие widgets; сохранены pinned revisions, drafts, validation, cancellation |
| 06 | `refactor: migrate merge request workflows and toolbar` | MR operations, Ship, version bump, trackers; сохранены порядок действий и защита от повторных записей |
| 07 | `refactor: split GitLab enhancements into feature slices` | MR list, Jira, cherry-pick, pipelines, commits, palette, standup; сохранены legacy selectors и routes |
| 08 | `refactor: migrate settings UI and transfer workflows` | Popup, profiles, import/export, autosave и welcome; старые настройки читаются без потерь |
| 09 | `fix: restore background tasks across worker restarts` | Typed handlers и сохраняемые состояния; перезапуск/отмена/неопределённый ответ не повторяют мутации |
| 10 | `perf: scope content loading and clean up feature lifecycle` | Лёгкий bootstrap, отложенные packaged modules, scoped CSS, отмена и очистка при навигации |
| 11 | `test: enforce extension release and architecture checks` | Полная проверка build/type/lint/FSD/regression/browser/package; документация установки и разработки |

Каждый коммит должен быть самостоятельным и проверяемым. Если выделение модуля
требует переноса его тестового адаптера, эти изменения включаются в один коммит.
Отклонения и фактические проверки записываются ниже. Полный перенос не считается
завершённым, пока остаются временные legacy-модули или не проверенные критерии.

## Проверки сохранности

- Все существующие 813 сценариев сохраняются по смыслу; изменения тестового
  harness не ослабляют assertions и не подменяют production-реализацию.
- MR actions, Ship/Force Ship, version bump, pipelines/jobs, cherry-pick,
  Jira, AI review, palette, standup, профили, настройки и семь языков сохранены.
- Проверяются modern/legacy URL, Work Items, relative URL root, forks,
  изменившийся SHA, pagination, partial failures и старые GitLab API contracts.
- Записывающие запросы не повторяются после неоднозначной потери ответа.
- Обновление расширения сохраняет настройки, формат экспорта и привычные defaults.
- Готовый ZIP содержит только ресурсы расширения, без tests, исходных TS,
  node_modules, development loader и sourcemaps production-сборки.
- Браузерные проверки работают на тестовых fixtures без записей в настоящие
  GitLab/Jira. Реальные серверы не считаются проверенными по результатам mocks.

## Производительность и разрешения

Сравниваются поставляемые JS/CSS, загрузка вне GitLab, запуск на GitLab, первое
открытие тяжёлой фичи, повторная навигация, количество запросов и активных
таймеров/observers. Скорость первой загрузки нельзя улучшать ценой незамеченной
задержки первого открытия окна. Численные CPU/heap budgets устанавливаются по
воспроизводимому baseline, а не выдумываются заранее.

Сохраняется автоматическая поддержка произвольных HTTPS self-hosted GitLab.
`document_idle` и isolated world остаются основой. Ленивая загрузка проверяется
на реальном установленном артефакте: CSP, packaged chunks и необходимые
web-accessible resources. Дополнительные разрешения вводятся только если
обоснованы конкретной функцией; изменения manifest явно проверяются.

## Источники решений

- [FSD: layers](https://feature-sliced.design/docs/reference/layers)
- [FSD: public API и разные среды выполнения](https://feature-sliced.design/docs/reference/public-api)
- [Chrome: service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome: content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [esbuild: TypeScript](https://esbuild.github.io/content-types/#typescript)
- [Playwright: extensions](https://playwright.dev/docs/chrome-extensions)

## Журнал выполнения

- 01: создан план; рабочая директория была чистой, исходная ветка `main`.
