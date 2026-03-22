# Sixmo.ru Form Automation

Автоматическое прохождение тестовой многошаговой формы на [sixmo.ru](https://sixmo.ru/).

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

# С пользовательскими данными
node sixmo-form.js --data='{"step1_text1":"Букля","step2_select":"Снитч","file_path":"./myfile.txt"}'
```

### Как модуль (программно)

```javascript
const { fillForm } = require('./sixmo-form');

const result = await fillForm({
  step1_text1: 'Букля',
  step1_select: 'Хогвартс',
  step1_text2: 'Гриффиндор',
  step2_text: 'Платформа 9 3/4',
  step2_select: 'Снитч',
  file_path: './upload.txt',
});

console.log(result.identifier); // "24E0AF1831CB"
```

### Как Claude Code skill

```
/sixmo
```

## Параметры

| Параметр | Описание | По умолчанию |
|----------|----------|-------------|
| `step1_text1` | Ответ на 1-й текстовый вопрос этапа 1 | Из placeholder |
| `step1_select` | Текст варианта для select этапа 1 | Первый вариант |
| `step1_text2` | Ответ на 2-й текстовый вопрос этапа 1 | Из placeholder |
| `step2_text` | Ответ на текстовый вопрос этапа 2 | Из placeholder |
| `step2_select` | Текст варианта для select этапа 2 | Первый вариант |
| `file_path` | Путь к файлу для загрузки (.txt/.md/.json, до 50КБ) | Временный "Expelliarmus" |
| `headless` | Режим без UI | `false` |

## Как это работает

1. Открывает Chromium через Playwright
2. Переходит на sixmo.ru и нажимает "Начать задание"
3. **Этап 1**: Заполняет 2 текстовых поля и 1 select (порядок случайный)
4. **Этап 2**: Заполняет 1 текстовое поле, 1 select и загружает файл (порядок случайный)
5. Отправляет форму и возвращает идентификатор

### Особенности формы, которые обрабатываются:

- **Случайный порядок полей** — скрипт определяет тип каждого поля динамически
- **Плавающая DOM-структура** — ID и классы элементов меняются каждый раз
- **Задержки загрузки шагов** — скрипт ждёт полной загрузки контента
- **Детекция headless** — используется реальный режим браузера

## Результат

```json
{
  "success": true,
  "identifier": "7DF7BCBE45C2",
  "flowId": "b3c6553c04c091cfd2baab09",
  "url": "https://sixmo.ru/#/flow/b3c6553c04c091cfd2baab09/result",
  "screenshot": "sixmo_result.png"
}
```

## Технологии

- **Node.js** + **Playwright** (Chromium)
- **Claude Code Skill** для интеграции с AI-агентом
