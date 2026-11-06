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
- 02: добавлены строгая TS-конфигурация, esbuild, lockfile, watch и production
  build; обе упаковки используют только dist. `npm run check`: TypeScript и
  ESLint проходят, все 813 регрессий проходят, production-сборка создана.
  Временные entrypoints импортируют существующий JS; это ещё не завершённая
  типизация runtime. Для разработки выбран доступный локально Node.js 22.
- 03: добавлены проверки production manifest/CSP/resources, общий адаптер
  тестовых модулей и исходные размеры bundles. Проходят 815 Node-тестов и
  3 Playwright-сценария с установленным расширением: autosave/reload настроек,
  посторонняя HTTPS-страница, повторное изменение DOM GitLab fixture.
  Chromium запускается в отдельном удаляемом профиле; HTTP(S) перехватывается.
- 04: review workflow перенесён из глобального JS в `entities/review`:
  инструкции, промпты, file scope, typed storage и cancellation. Добавлена
  библиотека version/TOML для дальнейшего подключения к MR/cherry-pick.
  Импорты FSD и отсутствие `any`/blanket suppressions проверяются автоматически.
  Общие настройки popup переносятся вместе с их потребителями на шаге 08,
  чтобы не создать зависимость между слайсами entities/settings и entities/review.
  Проходят typecheck, lint, architecture, 817 Node-тестов и 3 browser-сценария.
- 05: AI review перенесён в строгий TypeScript: `features/review-export`,
  `features/review-import`, `widgets/review-dialog`, `widgets/review-import-dialog`.
  Отдельные модули отвечают за HTTP/pagination, diff, ревизии, discussion state,
  Markdown и проверку входных данных. Контракты MR/discussion добавлены в entities.
  Content review собирается одним entrypoint без глобальных `window.GlReview*`.
  Для старого popup до шага 08 оставлен один явный bridge в app/settings-legacy.
  Проверка HTML scripts добавлена после обнаруженного browser-тестом старого
  подключения; итог: typecheck/lint/FSD, 817 Node-тестов и 3 browser-теста проходят.
  Права, CSP, форматы сохранённых настроек и журнал неопределённых отправок
  сохранены. Контроллеры UI имеют dispose для будущего общего lifecycle.
- 06: MR workflows вынесены в `features/mr-actions` (merge, pipeline, version),
  панель — в `widgets/mr-toolbar`, tracker — в отдельный widget. Добавлены
  typed session API, настройки проектных MR-профилей и pipeline contracts.
  Общая библиотека version подключена к реальным операциям вместо копии.
  Тесты действий вызывают public factory с test UI callbacks; assertions сохранены.
  Палитра вызывает extension-функцию в isolated world вместо принимающего
  команды страницы postMessage listener. Дополнительный browser-сценарий
  проверяет отсутствие мутаций API при сообщении веб-страницы.
  Проходят typecheck/lint/FSD, 817 Node-тестов и 4 browser-теста.
- 07: удалён монолит content_proxy.js. Jira state/контракты находятся в
  entities/jira-issue; список MR, Jira panel, commit actions, pipeline actions,
  palette и standup разделены на widgets. Cherry-pick workflow выделен в
  feature, строгий diff fallback — в shared. App связывает callbacks между
  widgets без импортов соседних слайсов. Сохранены batching, TTL, обработка
  auth errors, отложенное обновление списков и retry операций cherry-pick.
  Tracker и session API используются повторно. Проходят 817 Node-тестов,
  typecheck/lint/FSD и 4 browser-теста на production-сборке.
- 08: popup и welcome перенесены в pages; configuration и проверка/снимок
  настроек — в features/manage-settings, редакторы списков — в отдельный
  модуль UI. Удалены корневые popup.js/welcome.js и legacy bridge.
  AI defaults импортируются из entities/review, без копий и window globals.
  Соответствующие тесты используют реальные domain constants вместо подмены
  глобальных JS-объектов; проверки autosave, reset, квот и ошибок сохранены.
  Старые storage keys, profiles и formatVersion JSON не изменены.
  Проходят typecheck/lint/FSD, 817 Node-тестов и 4 browser-сценария.
- 09: весь runtime теперь TypeScript strict; allowJs и последний корневой
  background.js удалены. App синхронно регистрирует typed message dispatch,
  install и alarms handlers. Proxy transport, Jira API/actions, standup и
  job chains имеют отдельные модули. Задачи сохраняются в storage.local;
  перед play/retry записывается dispatch checkpoint, восстановление сначала
  сверяет job в закреплённом pipeline. Неопределённый результат требует
  проверки пользователем, повторной мутации нет. Отмена и счётчик ожиданий
  сохраняются; хранится до 50 завершённых задач. Разрешение alarms добавлено
  для пробуждения worker (1 минута); в живом worker сохранён polling 20 секунд.
  6 новых регрессий проверяют recovery, потерянный ответ, ошибку storage,
  отмену и повторный alarm. Проходят 823 Node-теста и 5 browser-сценариев,
  включая реальную остановку service worker через Chromium DevTools Protocol
  и восстановление состояния через новое runtime message.
- 10: manifest запускает один bootstrap (281 байт) на HTTPS; ESM chunks
  упакованы локально и доступны через web_accessible_resources. Маршрут
  загружает только нужные widgets; AI export/import, Jira panel, cherry-pick,
  palette и standup отложены. Начальный граф MR: 132 215 байт против 308 462
  байт baseline production; общий GitLab runtime: 11 270 байт. Это объём JS,
  не сравнительный замер CPU/памяти. CSS остаётся declarative для совместимости
  со строгой CSP, все обычные правила ограничены html.gl-actions-host.
  Lifecycle отключает route observers/listeners/timers, отменяет GET-запросы
  и блокирует поздний UI; tracker polling дедуплицирован. Палитра получает
  actions через app callbacks, глобальные window.__glMr* удалены.
  При отказе от закрытия dirty review после SPA-перехода draft сохраняется,
  повторного confirmation на том же маршруте нет. Проходят 825 Node-тестов
  и 7 browser-сценариев, включая SPA циклы и lazy UI при script/style-src none.
