#!/usr/bin/env node
/**
 * Sixmo.ru adaptive form automation
 *
 * Автоматически проходит многошаговую форму на https://sixmo.ru/
 * Поддерживает: случайный порядок полей, плавающую DOM-структуру,
 * задержки загрузки, загрузку файлов.
 *
 * Usage:
 *   node sixmo-form.js [options]
 *
 * Options (JSON via --data or env SIXMO_DATA):
 *   step1_text1  - ответ на первый текстовый вопрос этапа 1 (по умолчанию: из placeholder)
 *   step1_select - текст варианта select на этапе 1 (по умолчанию: первый вариант)
 *   step1_text2  - ответ на второй текстовый вопрос этапа 1 (по умолчанию: из placeholder)
 *   step2_text   - ответ на текстовый вопрос этапа 2 (по умолчанию: из placeholder)
 *   step2_select - текст варианта select на этапе 2 (по умолчанию: первый вариант)
 *   file_path    - путь к файлу для загрузки (по умолчанию: создаётся временный .txt)
 *   headless     - запуск без UI (по умолчанию: false — сайт блокирует headless)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SITE_URL = 'https://sixmo.ru/';
const DEFAULT_TIMEOUT = 30000;
const STEP_LOAD_TIMEOUT = 30000;

async function fillForm(options = {}) {
  const {
    step1_text1,
    step1_select,
    step1_text2,
    step2_text,
    step2_select,
    file_path,
    headless = false,
  } = options;

  // Create a temp file if none provided
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
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('[1/5] Открываю сайт...');
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });

    // Click "Начать задание"
    console.log('[2/5] Нажимаю "Начать задание"...');
    const startBtn = page.locator('button.primary-button', { hasText: /Начать/i });
    await startBtn.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await startBtn.scrollIntoViewIfNeeded();
    await startBtn.click();
    await page.waitForURL(/\/flow\/.*\/step\/1/, { timeout: DEFAULT_TIMEOUT });

    // ─── STEP 1 ───
    console.log('[3/5] Заполняю Этап 1...');
    await waitForStep(page);
    await fillStep(page, {
      textAnswers: [step1_text1, step1_text2],
      selectAnswer: step1_select,
      filePath: null,
    });

    const submitBtn1 = page.locator('button[type="submit"]');
    await submitBtn1.waitFor({ state: 'visible' });
    await submitBtn1.click();
    await page.waitForURL(/\/step\/2/, { timeout: DEFAULT_TIMEOUT });

    // ─── STEP 2 ───
    console.log('[4/5] Заполняю Этап 2 и загружаю файл...');
    await waitForStepTransition(page, '2');
    await waitForStep(page);

    await fillStep(page, {
      textAnswers: [step2_text],
      selectAnswer: step2_select,
      filePath: uploadFilePath,
    });

    const submitBtn2 = page.locator('button[type="submit"]');
    await submitBtn2.waitFor({ state: 'visible' });
    await submitBtn2.click();

    // ─── RESULT ───
    console.log('[5/5] Ожидаю результат...');
    await page.waitForURL(/\/result/, { timeout: DEFAULT_TIMEOUT });
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const resultText = await page.locator('main').textContent({ timeout: 10000 }).catch(() => '');

    // Extract identifier from result page
    const identifier = await page.evaluate(() => {
      // Look for the identifier text — it's typically a large code displayed prominently
      const allText = document.querySelector('main')?.textContent || '';
      const match = allText.match(/Идентификатор\s*([A-Z0-9]+)/);
      return match ? match[1] : null;
    });

    // Extract flow ID from URL
    const flowMatch = finalUrl.match(/\/flow\/([^/]+)/);
    const flowId = flowMatch ? flowMatch[1] : null;

    const screenshotPath = path.join(path.dirname(__filename), 'sixmo_result.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = {
      success: true,
      identifier: identifier,
      flowId: flowId,
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
    const errScreenshot = path.join(os.tmpdir(), 'sixmo_error.png');
    await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});
    console.error('✗ Ошибка:', error.message);
    console.error('Скриншот ошибки:', errScreenshot);
    return { success: false, error: error.message, screenshot: errScreenshot };
  } finally {
    await browser.close();
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * Wait for a step's form to load (handles loading delays & floating DOM).
 */
/**
 * Wait for a step transition — ensures the new step's content has loaded
 * (not the old step's stale DOM).
 */
async function waitForStepTransition(page, stepNumber) {
  await page.waitForFunction(
    (num) => {
      const eyebrow = document.querySelector('.eyebrow');
      return eyebrow && eyebrow.textContent.includes(num);
    },
    stepNumber,
    { timeout: STEP_LOAD_TIMEOUT }
  );
}

async function waitForStep(page) {
  await page.locator('form.step-card').waitFor({ state: 'visible', timeout: STEP_LOAD_TIMEOUT });
  // Wait for field-shells to appear (they may load with delay)
  await page.locator('.field-shell').first().waitFor({ state: 'visible', timeout: STEP_LOAD_TIMEOUT });
  // Wait until we have all expected fields (at least 3)
  await page.waitForFunction(
    () => document.querySelectorAll('.field-shell').length >= 3,
    { timeout: STEP_LOAD_TIMEOUT }
  ).catch(() => {});
  // Let floating DOM stabilize
  await page.waitForTimeout(1500);
}

/**
 * Fill a step's fields dynamically.
 * Fields can appear in ANY order — we identify each by its input type.
 */
async function fillStep(page, { textAnswers = [], selectAnswer, filePath }) {
  const fieldShells = page.locator('.field-shell');
  const count = await fieldShells.count();
  let textIndex = 0;

  for (let i = 0; i < count; i++) {
    const shell = fieldShells.nth(i);
    await shell.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    const textInputCount = await shell.locator('input[type="text"]').count();
    const selectCount = await shell.locator('select').count();
    const fileInputCount = await shell.locator('input[type="file"]').count();

    // ── File input (check first — can be in any position) ──
    if (fileInputCount > 0 && filePath) {
      await shell.locator('input[type="file"]').setInputFiles(filePath);
      console.log(`  → Файл: "${path.basename(filePath)}"`);
      continue;
    }

    // ── Text input ──
    if (textInputCount > 0) {
      const textInput = shell.locator('input[type="text"]');
      const placeholder = await textInput.getAttribute('placeholder') || '';
      const value = (textAnswers && textAnswers[textIndex]) || placeholder || 'ответ';
      await textInput.fill(value);
      console.log(`  → Текстовое поле: "${value}"`);
      textIndex++;
      continue;
    }

    // ── Select ──
    if (selectCount > 0) {
      const select = shell.locator('select');
      const options = await select.locator('option').all();
      let selectedValue = null;

      if (selectAnswer) {
        for (const opt of options) {
          const text = await opt.textContent();
          if (text && text.toLowerCase().includes(selectAnswer.toLowerCase())) {
            selectedValue = await opt.getAttribute('value');
            break;
          }
        }
      }

      if (!selectedValue) {
        for (const opt of options) {
          const val = await opt.getAttribute('value');
          const text = (await opt.textContent()) || '';
          if (val && !text.toLowerCase().includes('выберите')) {
            selectedValue = val;
            break;
          }
        }
      }

      if (selectedValue) {
        await select.selectOption(selectedValue);
        const selectedText = await select.locator('option:checked').textContent();
        console.log(`  → Select: "${selectedText}"`);
      }
      continue;
    }
  }
}

// ─── CLI entry point ───
if (require.main === module) {
  let data = {};

  const dataArg = process.argv.find(a => a.startsWith('--data='));
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

  if (process.argv.includes('--no-headless')) data.headless = false;
  if (process.argv.includes('--headless')) data.headless = true;

  fillForm(data).then(result => {
    if (result.success) {
      // Output result as JSON for tool/skill consumption
      console.log('\n--- RESULT_JSON ---');
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { fillForm };
