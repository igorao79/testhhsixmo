# Sixmo.ru Form Automation v2

Автоматическое прохождение тестовой многошаговой формы на [sixmo.ru](https://sixmo.ru/).

## Что изменилось в v2

- **Обход Playwright-детекции**: сайт проверяет `window.__playwright__binding__` и `window.__pwInitScripts` — скрипт удаляет их через `addInitScript` до загрузки страницы
- **Семантическая привязка полей**: поля определяются по тексту label (вопроса), а не по порядку в DOM
- **Имитация реальных взаимодействий**: mouse movement с промежуточными шагами, scroll, keyboard typing посимвольно с вариативными задержками, focus sequence — для прохождения interaction tracking сайта
- **Кириллица**: используется `page.keyboard.type()` вместо `locator.press()`, который не поддерживает Unicode

## Установка

```bash
npm install
```

Playwright автоматически установит Chromium при `npm install` (через `postinstall`).

## Использование

### Как CLI-скрипт

```bash
# Запуск с дефолтными значениями (из placeholder'ов формы)
node sixmo-form.js

# С ответами, привязанными к тексту вопросов
node sixmo-form.js --data='{"answers":{"сову":"Букля","факультет":"Гриффиндор","школа":"Хогвартс","платформ":"Платформа 9 3/4","квиддич":"Снитч"}}'

# С кастомным файлом для загрузки
node sixmo-form.js --data='{"answers":{"сову":"Хедвиг"},"file_path":"./my_file.txt"}'
```

### Как модуль (программно)

```javascript
const { fillForm } = require('./sixmo-form');

const result = await fillForm({
  answers: {
    'сову': 'Букля',
    'факультет': 'Гриффиндор',
    'школа': 'Хогвартс',
    'платформ': 'Платформа 9 3/4',
    'квиддич': 'Снитч',
  },
  file_path: './upload.txt',
});

console.log(result.identifier); // "E1E53CA1A5B4"
```

### Как Claude Code skill

```
/sixmo
```

## Параметры

| Параметр | Описание | По умолчанию |
|----------|----------|-------------|
| `answers` | Объект `{"подстрока вопроса": "ответ"}` — ключ матчится к label | Из placeholder / первый вариант |
| `file_path` | Путь к файлу для загрузки (.txt/.md/.json, до 50 КБ) | Временный файл "Expelliarmus" |
| `headless` | Режим без UI | `false` |

### Как работают `answers`

Ключи — это **подстроки из текста вопроса** (label). Например:

- `"сову"` → матчит "Как звали **сову** Гарри Поттера?"
- `"факультет"` → матчит "На какой **факультет** распределили..."
- `"квиддич"` → матчит "Какой из этих предметов связан с **квиддич**ем?"

Это работает независимо от порядка полей в DOM.

## Как это работает

1. Запускает Chromium через Playwright с anti-detection патчами
2. Генерирует mouse movement и scroll на лендинге
3. Нажимает "Начать задание"
4. **Этап 1**: Находит каждое поле по label-тексту, заполняет text посимвольно, выбирает select
5. **Этап 2**: Загружает файл + заполняет text + select (порядок адаптивный)
6. Отправляет форму и возвращает идентификатор

### Anti-detection меры

- Удаление `window.__playwright__binding__` и `window.__pwInitScripts`
- Скрытие `navigator.webdriver`
- Human-like mouse movement (с промежуточными шагами и jitter)
- Keyboard typing посимвольно с рандомными интервалами (50-130ms)
- Scroll и click события для interaction tracker сайта
- Реалистичный User-Agent

### Особенности формы, которые обрабатываются

- **Случайный порядок полей** — семантическая привязка по label
- **Плавающая DOM-структура** — рандомные classNames и data-fieldKey
- **Задержки загрузки шагов** — ожидание `.field-shell` элементов
- **Interaction tracking** — сайт считает mousemove/scroll/click/keypress

## Результат

```json
{
  "success": true,
  "identifier": "E1E53CA1A5B4",
  "flowId": "08ff17a456076e642543f363",
  "url": "https://sixmo.ru/#/flow/08ff17a456076e642543f363/result",
  "screenshot": "sixmo_result.png"
}
```

## Технологии

- **Node.js** + **Playwright** (Chromium)
- **Claude Code Skill** для интеграции с AI-агентом
