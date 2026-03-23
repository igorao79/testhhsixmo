#!/usr/bin/env node
/**
 * Sixmo.ru Adaptive Form Automation v2
 *
 * Проходит многошаговую форму на https://sixmo.ru/ от начала до конца.
 *
 * Ключевые отличия от v1:
 * - Обход Playwright-детекции (удаление __playwright__ bindings)
 * - Имитация реальных взаимодействий (mouse, keyboard timing, focus sequence)
 * - Семантическая привязка к label/question текстам, не к порядку полей
 * - Поддержка загрузки файлов
 *
 * Usage:
 *   node sixmo-form.js [--data='{"key":"value"}']
 *
 * Data fields (all optional — defaults to placeholder/first option):
 *   answers   - объект { "текст вопроса (часть)": "ответ" }
 *   file_path - путь к файлу для загрузки
 *   headless  - true/false (default: false)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SITE_URL = 'https://sixmo.ru/';
const TIMEOUT = 30000;

// ─── Human-like delays ───
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => delay(min + Math.random() * (max - min));

/**
 * Main entry: fill the form end-to-end.
 * @param {Object} options
 * @param {Object} options.answers - { "partial question text": "answer" }
 * @param {string} options.file_path - path to file for upload
 * @param {boolean} options.headless - run headless (default false)
 * @returns {Object} { success, identifier, flowId, url, screenshot }
 */
async function fillForm(options = {}) {
  const { answers = {}, file_path, headless = false } = options;

  // Prepare upload file
  let tempFile = null;
  let uploadFilePath = file_path;
  if (!uploadFilePath) {
    tempFile = path.join(os.tmpdir(), 'sixmo_upload.txt');
    fs.writeFileSync(tempFile, 'Expelliarmus', 'utf-8');
    uploadFilePath = tempFile;
  }
  uploadFilePath = path.resolve(uploadFilePath);

  const browser = await chromium.launch({
    headless: Boolean(headless),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // ─── Anti-detection: remove Playwright bindings BEFORE any page loads ───
  await page.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Remove Playwright-specific globals that the site checks
    delete window.__playwright__binding__;
    delete window.__pwInitScripts;

    // Prevent future assignment
    Object.defineProperty(window, '__playwright__binding__', {
      get: () => undefined,
      set: () => {},
      configurable: false,
    });
    Object.defineProperty(window, '__pwInitScripts', {
      get: () => undefined,
      set: () => {},
      configurable: false,
    });

    // Ensure Chrome object exists (expected in real Chrome)
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }
  });

  try {
    console.log('[1/5] Открываю сайт...');
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    await randomDelay(500, 1000);

    // Generate some mouse movement on the landing page
    await simulateHumanPresence(page);

    // ─── Click "Начать задание" ───
    console.log('[2/5] Нажимаю "Начать задание"...');
    const startBtn = page.locator('button', { hasText: /Начать/i });
    await startBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
    await humanClick(page, startBtn);

    await page.waitForURL(/\/flow\/.*\/step\/1/, { timeout: TIMEOUT });
    await randomDelay(1000, 2000);

    // ─── STEP 1 ───
    console.log('[3/5] Заполняю Этап 1...');
    await waitForFields(page);
    await fillStepSemantic(page, answers, null);
    await randomDelay(300, 700);

    const submitBtn1 = page.locator('button[type="submit"]');
    await humanClick(page, submitBtn1);
    await page.waitForURL(/\/step\/2/, { timeout: TIMEOUT });
    await randomDelay(1000, 2000);

    // ─── STEP 2 ───
    console.log('[4/5] Заполняю Этап 2 и загружаю файл...');
    await waitForStepNumber(page, '2');
    await waitForFields(page);
    await fillStepSemantic(page, answers, uploadFilePath);
    await randomDelay(300, 700);

    const submitBtn2 = page.locator('button[type="submit"]');
    await humanClick(page, submitBtn2);

    // ─── RESULT ───
    console.log('[5/5] Ожидаю результат...');
    await page.waitForURL(/\/result/, { timeout: TIMEOUT });
    await randomDelay(1500, 2500);

    const finalUrl = page.url();

    // Extract identifier
    const identifier = await page.evaluate(() => {
      const text = document.querySelector('main')?.textContent || '';
      // Try multiple patterns
      const m1 = text.match(/(?:Идентификатор|идентификатор|ID|Код)[:\s]*([A-Z0-9]{6,})/i);
      if (m1) return m1[1];
      // Look for a standalone hex-like code
      const m2 = text.match(/\b([A-F0-9]{8,})\b/);
      if (m2) return m2[1];
      return null;
    });

    const flowMatch = finalUrl.match(/\/flow\/([^/]+)/);
    const flowId = flowMatch ? flowMatch[1] : null;

    const screenshotPath = path.join(path.dirname(__filename), 'sixmo_result.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = {
      success: true,
      identifier,
      flowId,
      url: finalUrl,
      screenshot: screenshotPath,
    };

    console.log('\n✓ Форма успешно пройдена!');
    console.log('Идентификатор:', identifier);
    console.log('Поток:', flowId);
    console.log('URL:', finalUrl);
    console.log('Скриншот:', screenshotPath);

    return result;
  } catch (error) {
    const errShot = path.join(os.tmpdir(), 'sixmo_error.png');
    await page.screenshot({ path: errShot, fullPage: true }).catch(() => {});
    console.error('✗ Ошибка:', error.message);
    console.error('Скриншот ошибки:', errShot);
    return { success: false, error: error.message, screenshot: errShot };
  } finally {
    await browser.close();
    if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

// ═══════════════════════════════════════════════════════════
// Field discovery & semantic filling
// ═══════════════════════════════════════════════════════════

/**
 * Wait for the form fields to fully load (handles delayed rendering).
 */
async function waitForFields(page) {
  await page.locator('form').waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.locator('.field-shell').first().waitFor({ state: 'visible', timeout: TIMEOUT });
  // Wait for at least 2 field-shells
  await page.waitForFunction(
    () => document.querySelectorAll('.field-shell').length >= 2,
    { timeout: TIMEOUT }
  ).catch(() => {});
  await randomDelay(800, 1500);
}

/**
 * Wait for step transition by checking the step number indicator.
 */
async function waitForStepNumber(page, num) {
  await page.waitForFunction(
    (n) => {
      const el = document.querySelector('.eyebrow');
      return el && el.textContent.includes(n);
    },
    num,
    { timeout: TIMEOUT }
  );
}

/**
 * Semantically fill all fields in the current step.
 * Identifies each field by its label text and input type.
 *
 * @param {Page} page
 * @param {Object} answers - { "partial question text": "answer value" }
 * @param {string|null} filePath - file to upload (only on steps with file input)
 */
async function fillStepSemantic(page, answers, filePath) {
  // Discover all field-shells and their metadata
  const fields = await page.evaluate(() => {
    const shells = document.querySelectorAll('.field-shell');
    return Array.from(shells).map((shell, idx) => {
      const label = shell.querySelector('.field-label')?.textContent?.trim() || '';
      const helper = shell.querySelector('.field-helper')?.textContent?.trim() || '';
      const fieldKey = shell.dataset.fieldKey || '';
      const input = shell.querySelector('input[type="text"]');
      const select = shell.querySelector('select');
      const fileInput = shell.querySelector('input[type="file"]');

      let type = 'unknown';
      let placeholder = '';
      let options = [];

      if (fileInput) {
        type = 'file';
      } else if (input) {
        type = 'text';
        placeholder = input.placeholder || '';
      } else if (select) {
        type = 'select';
        options = Array.from(select.querySelectorAll('option'))
          .filter(o => o.value)
          .map(o => ({ text: o.textContent.trim(), value: o.value }));
      }

      return { idx, label, helper, fieldKey, type, placeholder, options };
    });
  });

  console.log(`  Найдено ${fields.length} полей:`);

  for (const field of fields) {
    const shell = page.locator('.field-shell').nth(field.idx);

    if (field.type === 'file' && filePath) {
      // ── File upload ──
      const fileInput = shell.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);
      console.log(`  ✓ [file] "${field.label.substring(0, 50)}..." → ${path.basename(filePath)}`);
      await randomDelay(300, 600);
      continue;
    }

    if (field.type === 'text') {
      // ── Text input: find answer by matching label ──
      const answer = findAnswer(answers, field.label) || field.placeholder || 'ответ';
      const input = shell.locator('input[type="text"]');

      // Focus the field first (for interaction tracking)
      await input.click();
      await randomDelay(100, 300);

      // Type character-by-character for realistic keyboard timing
      await humanType(page, input, answer);

      console.log(`  ✓ [text] "${field.label.substring(0, 50)}..." → "${answer}"`);
      await randomDelay(200, 500);
      continue;
    }

    if (field.type === 'select') {
      // ── Select: find answer by matching label, then match option text ──
      const desiredAnswer = findAnswer(answers, field.label);
      const select = shell.locator('select');

      // Focus
      await select.click();
      await randomDelay(200, 400);

      let valueToSelect = null;

      if (desiredAnswer) {
        // Match by partial text
        const match = field.options.find(
          o => o.text.toLowerCase().includes(desiredAnswer.toLowerCase())
        );
        if (match) valueToSelect = match.value;
      }

      // Fallback: pick first non-empty option
      if (!valueToSelect && field.options.length > 0) {
        valueToSelect = field.options[0].value;
      }

      if (valueToSelect) {
        await select.selectOption(valueToSelect);
        const selectedText = field.options.find(o => o.value === valueToSelect)?.text || valueToSelect;
        console.log(`  ✓ [select] "${field.label.substring(0, 50)}..." → "${selectedText}"`);
      }
      await randomDelay(200, 500);
      continue;
    }
  }
}

/**
 * Find an answer in the answers map by matching partial question text.
 * Keys in the answers object are partial question strings.
 */
function findAnswer(answers, labelText) {
  if (!answers || !labelText) return null;
  const lower = labelText.toLowerCase();
  for (const [key, value] of Object.entries(answers)) {
    if (lower.includes(key.toLowerCase())) return value;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Human-like interaction helpers
// ═══════════════════════════════════════════════════════════

/**
 * Simulate natural mouse movements and scrolling on the page.
 */
async function simulateHumanPresence(page) {
  const vp = page.viewportSize();
  // Move mouse to a few random positions
  for (let i = 0; i < 3; i++) {
    const x = 100 + Math.random() * (vp.width - 200);
    const y = 100 + Math.random() * (vp.height - 200);
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
    await randomDelay(100, 300);
  }
  // Small scroll
  await page.mouse.wheel(0, 100 + Math.random() * 200);
  await randomDelay(200, 500);
}

/**
 * Click a button with realistic mouse movement and timing.
 */
async function humanClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await randomDelay(100, 300);

  const box = await locator.boundingBox();
  if (box) {
    // Move to the button with some jitter
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 5) });
    await randomDelay(50, 150);
    await page.mouse.click(x, y);
  } else {
    await locator.click();
  }
  await randomDelay(200, 400);
}

/**
 * Type text character by character with variable keystroke timing.
 * Uses page.keyboard.type() which supports Cyrillic and all Unicode.
 * This produces realistic keyIntervals for the interaction tracker.
 */
async function humanType(page, locator, text) {
  // Clear existing content
  await locator.fill('');
  await randomDelay(50, 150);

  // Use keyboard.type with delay — works with Cyrillic unlike locator.press()
  await page.keyboard.type(text, { delay: 50 + Math.random() * 80 });
}

// ═══════════════════════════════════════════════════════════
// CLI entry point
// ═══════════════════════════════════════════════════════════

if (require.main === module) {
  let data = {};

  const dataArg = process.argv.find((a) => a.startsWith('--data='));
  if (dataArg) {
    try {
      data = JSON.parse(dataArg.split('=').slice(1).join('='));
    } catch (e) {
      console.error('Invalid --data JSON:', e.message);
      process.exit(1);
    }
  }

  if (process.env.SIXMO_DATA) {
    try {
      data = { ...JSON.parse(process.env.SIXMO_DATA), ...data };
    } catch (e) {
      console.error('Invalid SIXMO_DATA env JSON:', e.message);
    }
  }

  if (process.argv.includes('--headless')) data.headless = true;
  if (process.argv.includes('--no-headless')) data.headless = false;

  fillForm(data).then((result) => {
    if (result.success) {
      console.log('\n--- RESULT_JSON ---');
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { fillForm };
