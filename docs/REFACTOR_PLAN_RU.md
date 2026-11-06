# План перехода на FSD, TypeScript и esbuild

Статус: этапы 01–11 реализованы и проверены локально. Исходная версия: `1.13.3`,
коммит `1d97afe`. Перед публикацией остаётся ручная проверка на реальных GitLab/Jira.
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
  widgets/
    mr-toolbar/           # панель MR и связанные представления
    mr-list/              # дополнения списка MR
    review-dialog/        # picker и preview AI review
    review-import-dialog/ # редактирование и подтверждение публикации
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
    manage-settings/
  entities/
    merge-request/        # api, model
    pipeline/             # api, model
    discussion/           # api, model
    jira-issue/           # api, model
    settings/             # model: MR defaults, profiles, contracts
    review/               # model: scope, instructions, response contracts
  shared/
    api/                  # HTTP и Chrome messaging transport
    lib/                  # небольшие библиотеки: version, diff, DOM, lifecycle
    config/               # среда выполнения и настройки приложения
    i18n/
    ui/                   # базовые элементы, toast, modal, общие стили
manifest.json             # версия, permissions, content entrypoint
content.css, popup.html, welcome.html, icons/, _locales/  # статические ресурсы
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
- 11: удалены временные исключения архитектурной проверки; runtime JS внутри
  src и импорты за его пределы запрещены. Форматирование включено в общий check.
  Release-тесты проверяют локальные зависимости chunks, lazy loading тяжёлых
  фич и бюджеты начальной загрузки. Итог: TypeScript strict, ESLint, Prettier,
  FSD checks и 827 Node-тестов проходят; 7 browser-сценариев проходят на
  production-сборке. Сформированы dist и локальный ZIP
  `.reports/gitlab-mr-actions-v1.13.3-refactor.zip`.
  README и документация тестов обновлены; privacy policy описывает хранение
  CI-задач и разрешение alarms. Статические ресурсы оставлены в корне для
  совместимости существующих инструментов версионирования и выпуска.
  CSS сохранён declarative ради строгой CSP; его размер вырос с 66 443 до
  80 498 байт из-за ограничения селекторов страницами GitLab. Сравнение JS
  относится к размерам графов загрузки, а не CPU, памяти или задержкам.
  Браузерные проверки используют fixtures и перехватывают HTTP(S); реальные
  GitLab/Jira остаются в ручной матрице проверки перед выпуском (tests/README.md).
  Все изменения локальные: push и публикация не выполнялись.

## Ревью относительно main — 2026-11-06

База сравнения: `main` на `1d97afe`, версия расширения 1.13.3.
Проверены перенос runtime-функций, настройки и storage keys, сообщения и UI,
manifest, загрузка модулей, CSS, MR/Jira workflows и восстановление CI-задач.
Одинаковые 659 поведенческих проверок запущены на экспортированных JS из main
и на текущих TypeScript-модулях: обе версии проходят 659/659 без пропусков.
Это сравнение наблюдаемого поведения на фикстурах, не доказательство отсутствия
ошибок во всех возможных настройках и версиях серверов.

Найдены и исправлены проблемы:

- При SPA-переходе оставались Git commands и failed-job panel предыдущего MR,
  а также отдельные loaders. Исправлены selectors очистки. Изменённые нативные
  approval badges восстанавливаются; добавленные расширением удаляются.
- Поздние ответы trace/sensitive-files и pipeline jobs могли дорисовывать UI
  после смены страницы. Добавлены проверки lifecycle/маршрута и отмена trace GET.
- Открытая палитра сохраняла команды предыдущего MR. Она привязана к lifecycle
  маршрута; исполнение после смены pathname блокируется ещё до следующего polling.
- Старый toolbar observer мог изменить MR-контекст незавершённой операции при
  замене DOM. Контекст закреплён за исходным MR, устаревшие клики блокируются.
- Сохранённый при отказе от закрытия review draft оставался busy после отмены
  export/load. После возвращения действия доступны, необходимые чтения повторяются.
  Проверены переходы как в другой MR, так и на страницу без review-контекста:
  пустой ключ такого маршрута теперь отличим от отсутствия сохранённого draft.
- Запоздавший ответ import мог принудительно закрыть сохранённый draft. Отказ
  теперь соблюдается, старые операции отменяются, текст остаётся. После прерванной
  отправки требуется новая валидация с delivery journal перед возможным повтором.

Регрессии воспроизведены до исправлений для SPA-очистки, поздних ответов,
палитры и зависшего review export. Добавлены проверки сохранения import draft,
закрепления MR во время операции, cleanup badges и восстановления активной цепочки
после реальной остановки Chromium worker без повторного play-запроса.
Итоговая проверка: TypeScript strict, ESLint, Prettier, FSD и 831 Node-тест;
13 браузерных сценариев на production-сборке. HTTP(S) перехвачен фикстурами,
настоящие MR, CI jobs и Jira issues не изменялись.

Текущие размеры production JS: bootstrap 281 байт, общий GitLab startup
11 661 байт, начальный MR-граф 133 310 байт (main: 308 462 байта).
CSS: 80 498 байт (main: 66 443 байта). CPU, память и задержки на настоящем
GitLab не измерялись; живая матрица из `tests/README.md` остаётся проверкой
перед выпуском. Локальный ZIP пересобран с исправлениями. Push не выполнялся.

## Повторный архитектурный проход — 2026-11-06

После функционального ревью проверены владельцы настроек, зависимости модулей,
размер ответственности файлов и значения, управляющие поведением runtime.
Изменения выполнены в той же ветке, без новых runtime-зависимостей.

1. Общие defaults кнопок, MR, версионирования и reviewers находятся в
   `entities/settings/model/defaults.ts`. Popup, MR actions и commit widgets
   используют эти значения. Review entity владеет ограничениями длины промптов
   и файловых фильтров; эти ограничения используют и валидация, и UI.
2. Префиксы GitLab/Jira API, размер полной страницы GitLab, polling маршрута,
   пути страниц расширения и внешние ссылки имеют именованную конфигурацию.
   Политики CI polling, ожиданий rebase/merge, retention завершённых задач,
   debounce, feedback и сетевых таймаутов названы в соответствующих модулях.
   Существующие значения и storage keys сохранены.
3. Крупные функции разделены по ответственности внутри FSD-слайсов:
   review export — feedback/context/fresh/repeat; import — prompts/plan/journal
   и отправка; review UI — окно/потоки/действия/route lifecycle; настройки —
   формы/default/profile, persistence и button order; Jira — comments,
   transitions, field editors и форматирование; MR list — Jira/reviewers,
   metadata и badges; toolbar — failed jobs, sensitive warning и Git commands.
   Зависимости между частями передаются явно, mutable state остаётся у владельца.
4. Обнаружен и устранён цикл `markdown → code-context → markdown`: независимые
   helpers позиций перенесены в `position.ts`. Public API настроек больше не
   использует wildcard exports.
5. Архитектурная проверка теперь запрещает циклы runtime, обход public API
   Shared, неконтролируемые динамические импорты, wildcard exports и числовые
   задержки непосредственно в timer-вызовах. Type-only импорты проверяют границы,
   но не образуют runtime-циклов. Bootstrap имеет узкое исключение только для
   `chrome.runtime.getURL("modules/content.js")`.
6. TypeScript дополнительно проверяет неиспользуемые locals/parameters,
   switch fallthrough и override. Test adapter обновлён под состояние страницы
   настроек; прежние assertions сохранены, production не содержит test hooks.

| Основной файл | Строк до | Строк после |
| --- | ---: | ---: |
| Review export | 1467 | 61 |
| Review import | 1470 | 638 |
| Settings controller | 1886 | 604 |
| Jira panel | 1601 | 601 |
| MR list | 1353 | 368 |
| Review controls | 2031 | 761 |
| Review import dialog | 1256 | 876 |
| MR toolbar | 1212 | 825 |
| Command palette | 770 | 474 |

Это разделение ответственности, а не удаление функциональности или сокращение
общего количества строк: появились отдельные модули и типизированные контракты.
Константы находятся рядом с владельцем; в Shared попадают общие протоколы и
конфигурация. Идентификаторы протокола, i18n keys, markup, селекторы конкретного
компонента и очевидные арифметические значения не заменяются бессодержательными
переменными. Размер файла сам по себе не является основанием для нового слайса.

Проверки: TypeScript, ESLint, Prettier, FSD, 839 Node-тестов и 14 Chromium
сценариев проходят. Среди новых проверок — восемь архитектурных графов и
сохранение edits при переключении профиля и языка в настоящем popup.
Начальный MR-граф: 136 192 байта (до этого прохода 133 310; main 308 462).
Bootstrap остаётся 281 байт, CSS — 80 498 байт. Прирост MR JS около 2,2% связан
с явными контрактами модулей; бюджеты загрузки проходят, тяжёлые фичи остаются
lazy. Это измерение размера JS, не CPU/памяти/latency на настоящем сервере.

Основания: [FSD public API](https://feature-sliced.design/docs/reference/public-api),
[FSD slices and segments](https://feature-sliced.design/docs/concepts/low-coupling),
[Chrome service worker events](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events),
[esbuild TypeScript caveats](https://esbuild.github.io/content-types/#typescript-caveats).
Проверка типов остаётся отдельным обязательным шагом; сборщик её не заменяет.

## Аудит жизненного цикла, связности и памяти — 2026-11-06

База этого прохода — `339c658` в текущей ветке. Сравнение размера итоговой
сборки с `main` (`1d97afe`) по-прежнему выполняется существующими release-тестами.

Подтверждённые проблемы и исправления:

1. Очистка approval-бейджей удерживала удалённые строки MR до смены pathname.
   При фильтрации/пагинации на том же маршруте память росла. Исходные значения
   нативных бейджей теперь хранятся в `WeakMap`; один обработчик маршрута
   восстанавливает видимые бейджи и удаляет созданные расширением элементы.
2. Нативный `clearTimeout`/`clearInterval` не удалял отменённый handle из
   реестра lifecycle. Добавлены `cancelTimeout`/`cancelInterval`, переведены
   debounce и завершённые polling-задачи. Тест проверяет тысячу отмен.
3. При смене Jira-задачи панель повторно добавляла обработчики на тот же DOM.
   Запоздавшая отправка комментария могла отобразиться в другой задаче;
   отложенный callback настроек относился к предыдущей панели. Каждое открытие
   теперь получает дочерний lifecycle, который снимает обработчики и отменяет
   доставку UI-ответов. Ссылка повторно используемой панели берёт переданный
   Jira URL. Завершённые мутации продолжают инвалидировать данные даже после
   закрытия представления; тест покрывает этот случай отдельно.
4. Старый ответ standup мог заменить отчёт за новую дату. Аналогичная гонка
   была в поиске assignee. Добавлены номера запросов, в том числе для очистки
   строки поиска. Закрытие standup освобождает его собственный lifecycle.
5. Обычный `guard` прекращал вызовы после dispose, но ожидающий транспорт всё
   ещё удерживал callback вместе с DOM. Новый `once` освобождает callback при
   ответе или закрытии окна. Он применяется к одноразовым Jira/standup-ответам;
   многоразовые обработчики событий сохраняют свой контракт.

Проверка архитектуры и типов:

- Проверки FSD public API, направления импортов и циклов runtime проходят.
  Jira session controller отделён от сборки содержимого панели; построение
  окна импорта review отделено от контроллера подготовки/отправки.
- Удалены `Partial<ReviewDialogState> as ReviewDialogState` и
  `as ImportDialogState`. Обязательные DOM-ссылки создаются до активации;
  полные объекты проверяются компилятором. `editorInput`/`saveEdit` явно
  инициализированы, восстановление фокуса проверяет тип элемента.
- Окно review зависит от четырёх используемых членов exporter через `Pick`.
  Обработка Tab/Escape вынесена в общий модуль UI; сохранены прежние действия,
  тексты и порядок элементов. Большие блоки построения разметки остаются
  явными: сокращение числа строк само по себе не было целью.

Замеры: Chromium `158.0.8127.18`, отдельный временный профиль, установленная
production-сборка, полностью локальные API/HTML fixtures. 5 прогревочных и
60 измеряемых замен по 20 MR-строк, GC между блоками. Оба запуска выполнены
одним скриптом на той же машине, без параллельного браузерного тестирования.

| Метрика списка MR | До | После |
| --- | ---: | ---: |
| Дополнительные DOM-узлы после GC | 12 600 | 0 |
| Рост live JS heap | 361 412 байт | 36 024 байт |
| Дополнительные обработчики | 0 | 0 |
| Медиана обновления списка | 216,68 мс | 216,63 мс |
| p95 обновления списка | 218,54 мс | 218,55 мс |
| ScriptDuration за 60 замен | 96,97 мс | 90,45 мс |

Дополнительно выполнены 20 циклов открытия обоих review-диалогов и SPA-переходов
после трёх прогревочных циклов: итоговый рост DOM/обработчиков — 0/0.
JS heap вырос на 325 896 байт; это учитывается в отчёте, а не называется
«нулевой памятью». При 100 закрытиях standup с недоставленными ответами
исходная версия удерживала ещё 3 400 узлов, при переключениях Jira — 1 416;
новые проверки после исправлений проходят с допуском 10 узлов и 0 обработчиков.
Четыре проверки функциональных гонок и обе проверки памяти отдельно запущены
на исходных модулях из `339c658` и действительно падали.

Воспроизводимый запуск: `npm run test:performance`. Отчёты этого прохода:
`.reports/runtime-before.json` и `.reports/runtime-after.json`.
Методика GC и live heap соответствует
[Chrome DevTools Memory problems](https://developer.chrome.com/docs/devtools/memory-problems);
счётчики получены через
[CDP Memory](https://chromedevtools.github.io/devtools-protocol/tot/Memory/) и
[CDP Performance](https://chromedevtools.github.io/devtools-protocol/tot/Performance/).

Проверки: полный `npm run check` (842 Node-теста), 21 браузерный сценарий,
бюджеты runtime-профилирования. Начальный MR JS — 136 229 байт, всего +37 байт
к началу этого прохода; bootstrap — 281, CSS — 80 498 байт. Фичи не удалялись.
На проверенных сценариях замедления не обнаружено. Это не измерение RSS всего
Chrome, GPU-памяти или скорости реального GitLab/Jira; сетевые задержки и
различия серверных версий требуют проверки на живом окружении.

Все изменения остаются локальными, без push.

## Аудит CI, зависимостей и требований Chrome — 2026-11-06

База прохода — `256f968`. Исправлены следующие подтверждённые проблемы:

1. Workflow магазина использовал API v1, поддержку которого Google завершил
   15 октября 2026. Добавлен клиент API v2 с отдельной конфигурацией publisher ID,
   ожиданием завершения асинхронной загрузки, проверкой состояния submission,
   тайм-аутами и ограниченным polling. HTTP 200 с ошибкой или неизвестным
   состоянием не считается успехом. Запросы записи автоматически не повторяются.
   OAuth-параметры кодируются через `URLSearchParams`; секреты не подставляются
   в shell-код, access token и тела ответов не выводятся в лог.
2. Загрузка в магазин обходила браузерные проверки. Теперь push/PR и release
   используют один reusable workflow: `npm ci` → actionlint/audit/check → ZIP →
   Chromium и runtime-профилирование распакованного ZIP. Store job зависит от
   успешного завершения всей проверки и использует тот же artifact. Release
   по-прежнему только загружает пакет; submission выполняется при явном ручном
   выборе `publish`. Версии manifest, ZIP и release tag проверяются до OAuth.
3. CI не сохранял результат сборки и диагностику. Теперь сохраняются
   `extension-package`, `build-reports`, `browser-reports` на 14 дней. Actions
   закреплены полными проверенными SHA; права — `contents: read`, есть timeout
   и concurrency. Ubuntu зафиксирован на 24.04: согласно runner-images,
   `ubuntu-latest` меняется на 26.04 в ноябре 2026.
4. `engines.node >=22.12` противоречил требованию ESLint 10 — Node 22.13+.
   Исправлены engines, документация и проверка версии через `.npmrc`;
   CI читает Node из `.nvmrc`.
5. npm audit выявил один advisory minimatch, распространявшийся на десять
   dev-пакетов. Override на 11.0.1 устранил его; чистый `npm ci`, lint,
   архитектурные проверки и все тесты проходят. После обновления audit: 0
   известных уязвимостей. Runtime npm-зависимостей по-прежнему нет.
   TypeScript 7 не устанавливался: peer range текущего typescript-eslint —
   `>=4.8.4 <6.1.0`. Добавлены еженедельные проверки обновлений Dependabot.
6. Сборщик указывал Chrome 88, хотя runtime использует более новые Promise API,
   CSS `:has()` и поведение service worker. `minimum_chrome_version: 110`
   теперь явно задан в manifest и используется esbuild как единый target.
   Добавлен синхронный `runtime.onStartup` listener для восстановления alarm;
   повторные startup-события не создают второй исполнитель той же цепочки.

Сверка с рекомендациями Google:

| Область | Проверенный результат |
| --- | --- |
| Manifest V3 / worker | Локальный IIFE worker; события зарегистрированы синхронно; checkpoints сохраняются в storage, alarm восстанавливается при старте |
| CSP / удалённый код | `script-src 'self'; object-src 'none'`, нет dev server/eval/удалённых runtime imports; ESM-граф замкнут внутри пакета |
| Content scripts | Isolated world, GitLab detection, CSS scope, нет публичного page-message интерфейса для запуска мутаций |
| Permissions | storage — настройки/задачи; notifications — результаты; tabs — поиск вкладок GitLab; cookies — Jira session; alarms — пробуждение цепочек |
| Hosts / WAR | HTTPS; произвольные self-hosted домены сохранены. WAR содержит локали и локальные модули, необходимые динамическим загрузкам |
| ZIP | Manifest в корне, все модули/локали/icons/CSS/HTML присутствуют, source/test/docs/maps/node_modules отсутствуют |
| Версии / локализация | Manifest — источник версии; согласованность сайта и changelog, ключи локалей и лимит описания магазина проверяются тестами |

Результат локальной проверки: чистая отдельная копия проекта без node_modules,
успешный `npm ci`, полный `npm run check` — 857 тестов; 21 Chromium-сценарий
на пакете, который сначала был создан, затем распакован вместо исходного dist.
Actionlint 1.7.12 проверил workflow. Оба штатных пути упаковки проверены:
`bash pack.sh` → `gitlab-mr-actions-v1.13.3.zip`, CI → `extension.zip`.
Готовый локальный архив содержит 47 файлов, побайтово совпадающих с dist.

На распакованном CI ZIP runtime-проверка прошла: после 60 замен MR-списка
рост DOM/обработчиков 0/0, медиана 216,58 мс; после 20 циклов review/SPA — 0/0.
Начальный MR JS — 135 645 байт, bootstrap — 281, CSS — 80 498 байт.
Формат ZIP, названия локальных архивов и фичи расширения сохранены.

Границы проверки: GitHub-hosted Linux job не запускался (push запрещён),
Docker daemon локально не работал. Фактически выполнены проверки на macOS,
actionlint и чистая установка; Chromium/API tests используют локальные fixtures.
Реальная загрузка/публикация не выполнялась, OAuth-секреты не читались.
Перед первым запуском v2 необходимо задать repository variable
`CWS_PUBLISHER_ID` присланным пользователем ID. Сам ID не является credential;
реальные права определяются OAuth. Настройки GitHub в этом проходе не менялись.

Источники: [Google: API v1 sunset](https://developer.chrome.com/docs/webstore/api/v1/),
[API v2 upload](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload),
[API v2 publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish),
[подготовка ZIP](https://developer.chrome.com/docs/webstore/prepare),
[безопасность расширений](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure),
[жизненный цикл worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
[Manifest V3: локальный исполняемый код](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements),
[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[Ubuntu runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).

## Правила контрибьюторов и проверка типов (база `2d78b1e`)

Добавлены `AGENTS.md` и `CONTRIBUTING.md`: карта FSD, точки изменения настроек,
правила API/DOM/async/lifecycle, команды проверки и требования к описанию PR.
Обнаруженный локальный `CLAUDE.md` всё ещё требовал ES5, Node 18 и изменения
старых корневых JS-файлов. Он заменён короткой ссылкой на общие инструкции и
теперь отслеживается Git. Добавлен шаблон PR с результатами проверок и влиянием
на совместимость. Автоматические hooks/install-скрипты не добавлялись.

ESLint использует современный `defineConfig` и TypeScript Project Service.
Включены точечные type-aware правила: необработанные и некорректно используемые
Promise, await для непригодных значений, лишние утверждения типов, повторяющиеся
и избыточные union-типы, exhaustiveness switch и выбрасывание Error.
Оператор `void` не отключает проверку Promise. Неиспользуемые eslint-disable
считаются ошибкой; TS-подавления требуют объяснения, ts-ignore/nocheck запрещены.
Проверка расширена на Node-скрипты и конфигурации инструментов, warnings запрещены.
`globals` — новая dev-зависимость; runtime npm-зависимостей не появилось.

В TypeScript включены проверка библиотечных деклараций, side-effect imports,
запрет недостижимого кода и неиспользуемых labels. `strict` сохранён.
У Prettier появилась явная конфигурация; проверяются также корневые JSON,
конфигурации инструментов и workflow YAML. `.editorconfig` задаёт базовый стиль
редакторов. Старые CJS-fixtures и маркетинговые страницы не переформатировались.
Тестовый esbuild-адаптер теперь берёт target из manifest, как production-сборщик.

Исправлены 40 мест с необработанными Promise/завершениями цепочек и удалены
28 избыточных утверждений типов. Chrome callback API читают `runtime.lastError`
внутри callback; неожиданные Promise failures получают конечный обработчик.
Существующие пользовательские сообщения об ошибках сохранены. `alarms.create`
учитывает void на Chrome 110 и Promise начиная с Chrome 111.
Браузерный тест выявил отсутствие ответа у `open-options`: обработчик теперь
держит message port открытым до результата `tabs.create`, отвечает об успехе
или ошибке и не вызывает ложный `message port closed` у вызывающей стороны.

Проверки: чистый `npm ci` и полный check в отдельной копии прошли; итоговый
`npm run check` — 860 тестов. Добавлены регрессии отказа storage, результата
открытия настроек и отказа clipboard с успешной повторной попыткой. Отдельные
невалидные примеры подтвердили, что lint отклоняет floating Promise (включая
void), async predicate, await обычного числа, неполный switch и неизвестный
идентификатор Node-скрипта. Корректно обработанный Promise принимается.
Actionlint проходит, npm audit — 0 известных уязвимостей.

Runtime-профиль: после 60 замен списка рост DOM/обработчиков 0/0, медиана
216,66 мс; после 20 циклов review/SPA — 0/0. Лимиты роста памяти, DOM-узлов
и обработчиков не превышены. Итоговые 23 Chromium-сценария проходят.
Bootstrap остался 281 байт, CSS — 80 498; начальный MR JS вырос с 135 645 до
136 201 байта (+556 байт, примерно 0,41%) из-за обработки ошибок.

Дальнейшая миграция типов должна отдельно пересмотреть динамические словари
API, индексы массивов, nullable DOM-контракты и absent/undefined в настройках.
Глобальные `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` и запрет
всех narrowing assertions пока не включены: пробный прогон первых двух дал
423 диагностических ошибки. Маскировать их `!`, `as` или подавлениями нельзя.
`noImplicitReturns` также требует отдельного уточнения существующих контрактов.

Источники: [typed linting](https://typescript-eslint.io/getting-started/typed-linting/),
[floating promises и void](https://typescript-eslint.io/rules/no-floating-promises/),
[Prettier config](https://prettier.io/docs/configuration),
[Chrome alarms.create](https://developer.chrome.com/docs/extensions/reference/api/alarms#method-create),
[indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html),
[exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html).

## Общий процесс PR и релиза для агентов (база `67b65e2`)

Добавлена единая процедура `docs/DELIVERY.md` с матрицей изменений: changelog
EN/RU, README, сайт EN/RU, welcome и семь локалей, review guides, privacy,
инструкции контрибьюторов и версия. PR template требует назвать затронутые файлы
либо объяснить, почему поверхность не меняется, указать release intent и реальные
результаты проверок. Удалён дублирующий раздел Contributing из README.

Portable skills `prepare-pr` и `prepare-release` находятся в `.agents/skills/`;
описания соответствуют формату Agent Skills. В них нет внешних интеграций,
автоматического push или публикации. `CLAUDE.md` и `GEMINI.md` — относительные
symlink на `AGENTS.md`; Claude видит те же skills через symlink отдельных папок
в `.claude/skills/`. Copilot instructions ссылаются на общий источник. Для клиентов
без автоматического discovery документированы прямые пути к инструкциям.
Схема discovery сверена с официальными документами Codex, Cursor, Copilot, Gemini
и Claude; запуск каждого из этих клиентов в этом проходе не выполнялся.

Добавлены read-only команды:

- `npm run release:check`: формат версии, одинаковая EN/RU история, отсутствие
  дубликатов/нарушений порядка, актуальные changelog copies, JSON-LD и оба footer.
- `npm run release:check -- --ready`: дополнительно запрещает pending Unreleased.
- `npm run --silent release:notes`: текущие EN/RU разделы в Markdown, без чужих
  старых релизов и без публикации. Семантическую точность заметок проверяет автор.
- `npm run docs:build`: существующий генератор страниц и changelog copies.

Версия остаётся в manifest; `package.json` и lockfile не получают вторую версию.
Согласованность release metadata включена в `npm run check`. Для генератора
документации закреплён Mistune 3.4.0 с SHA256 в `docs/requirements.txt`; вывод
совпал побайтово с существующими страницами. CI теперь регенерирует сайт в venv
и отклоняет diff забытых generated files. Добавлен Dependabot для Python-пакета.

Исправлен тест сайта, требовавший, чтобы заметки 1.13.3 всегда были первыми:
теперь проверяется текущая версия и отдельно сохраняются проверки старой истории.
Усилена проверка ZIP: инструкции, skills и документация не должны попадать в пакет.

Проверки: validators skill-creator приняли оба skills; относительные ссылки и
symlink разрешаются внутри репозитория. `npm run check` — 874 теста, actionlint
проходит. В отдельной временной копии подготовлен условный 1.13.4: до регенерации
release check правильно отклонил устаревшие copies; после генерации прошли ready,
экспорт EN/RU notes, все 874 теста и `bash pack.sh`. ZIP содержит 48 runtime-файлов
и manifest 1.13.4 в корне, без инструкций/исходников. Эта копия не публиковалась.

В рабочем репозитории версия осталась 1.13.3. Runtime и вид сайта не менялись;
повторный Chromium/performance прогон не требовался. Реальный GitHub CI, PR,
release, Pages deployment и Chrome Web Store upload не запускались.

## Аудит настроек и скрытых ограничений

Добавлен общий контракт правил отображения в `entities/settings`, используемый
формой, импортом и runtime. Настраиваются пороги S/M/L по строкам/файлам, число
jobs и непустых строк логов, глубина поиска ревьюера, дополнительные шаблоны
чувствительных файлов, исключения и включение встроенных правил. Настройки
глобальные, прежние defaults сохранены; недопустимые значения в форме/импорте
отклоняются, повреждённые значения в storage заменяются defaults при чтении.
Поля включены в существующий формат экспорта без изменения его версии.

Исправлены конкретные скрытые зависимости и неточности:

- упоминание `@alice2` больше не считается назначением `@alice`;
- preview jobs показывает число загруженных карточек и ссылку на полный pipeline;
- загрузка логов ограничена пятью параллельными запросами при любом числе карточек;
- чувствительные файлы проверяются на последующих страницах diff (до 1000 файлов),
  включая старые пути переименований; ошибки и достижение лимита явно отмечаются;
- предупреждение работает при выключенных кнопках/таймере; скрытая пустая панель
  служит маркером монтирования и предотвращает повторную инициализацию MR;
- счётчик обсуждений обозначает неполную выборку или ошибку API;
- `changes_count: "1000+"` сохраняет признак нижней границы при своих порогах;
- standup предупреждает о пределах 50 MR на категорию и 500 событий.

`docs/CONFIGURATION.md` содержит карту настроек, область действия профилей,
приоритет exact/substring-сопоставления и оставшиеся фиксированные пределы
ожидания, API, AI-контекста и storage. Они не объявлены пользовательскими
настройками. UI явно объясняет, что выбор хвоста лога не сокращает скачивание
полного trace. Произвольные glob-шаблоны не интерпретируются как regex.

Документация: README, EN/RU Unreleased, сайт (обе локализации), семь locale-файлов
и существующие welcome-карточки через локализованные описания обновлены.
Сгенерированные changelog-копии синхронизированы. AI workflow, данные/permissions
и privacy policy не изменились; версия остаётся 1.13.3. Новых зависимостей нет.

Проверки финального кода: `npm run check` — 903 теста, typecheck, ESLint,
Prettier, FSD и release metadata; Chromium — 26 сценариев. Новый блок настроек
осмотрен EN/RU, сайт проверен при ширине 390/1280 px без горизонтального overflow.
`test:performance` прошёл: медиана обновления списка 216.63 мс, p95 218.82 мс;
рост DOM/listeners 0/0 как для списка, так и для навигации с диалогами. Рост heap
38 032 / 332 900 байт в этих сценариях, ниже существующих бюджетов. Это локальные
фикстуры, не проверка всех живых GitLab/Jira и не доказательство отсутствия
любой возможной утечки.

Локальный ZIP `.reports/gitlab-mr-actions-v1.13.3-refactor.zip`: 48 runtime-файлов,
308 033 байта, manifest 1.13.3 в корне, без исходников и инструкций. Workflow,
удалённый CI, push, Pages и Chrome Web Store не запускались.
