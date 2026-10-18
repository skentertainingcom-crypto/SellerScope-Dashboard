const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('generates unique ideas and updates the count', async ({ page }) => {
  await page.locator('#seed').fill('moissanite engagement ring');
  await page.locator('#generate').click();

  const phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases.length).toBeGreaterThan(0);
  expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
  expect(phrases).not.toContain('moissanite engagement');
  expect(phrases).not.toContain('engagement');
  await expect(page.locator('#count')).toHaveText(`${phrases.length} ideas`);
  await expect(page.locator('#toast')).toContainText('Etsy search was not performed');
});

test('market modes generate ideas without duplicate phrases', async ({ page }) => {
  const seeds = [
    ['personalized necklace', 'personalized'],
    ['birthday gift', 'gift'],
    ['ceramic vase', 'home'],
    ['engagement ring', 'wedding'],
    ['gift', 'gift'],
  ];

  for (const [seed, mode] of seeds) {
    await page.locator('#seed').fill(seed);
    await page.locator('#market').selectOption(mode);
    await page.locator('#generate').click();
    const phrases = await page.locator('#results .kw').allTextContents();
    expect(phrases.length, `expected ideas for ${seed} / ${mode}`).toBeGreaterThan(0);
    expect(
      new Set(phrases.map((phrase) => phrase.toLowerCase())).size,
      `duplicate phrases for ${seed} / ${mode}`,
    ).toBe(phrases.length);
    if (seed === 'engagement ring' && mode === 'wedding') {
      expect(phrases).not.toContain('wedding engagement ring');
      expect(phrases).not.toContain('classic engagement ring engagement gift');
    }
  }
});


test('does not create unnatural fragments when a seed contains connector words', async ({ page }) => {
  await page.locator('#seed').fill('ring for her');
  await page.locator('#market').selectOption('personalized');
  await page.locator('#generate').click();

  const phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases).not.toContain('ring her');
  expect(phrases).not.toContain('personalized her');
  expect(phrases).not.toContain('ring for');
  expect(phrases).not.toContain('for her');
  expect(phrases).toContain('personalized ring');
  expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
});


test('preserves product intent and avoids repeated connector phrases', async ({ page }) => {
  await page.locator('#seed').fill('engagement ring');
  await page.locator('#market').selectOption('general');
  await page.locator('#generate').click();
  let phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases).toContain('engagement ring');
  expect(phrases).toContain('minimalist engagement ring');

  await page.locator('#seed').fill('ring for her');
  await page.locator('#generate').click();
  phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases).not.toContain('ring for her for everyday use');
  expect(phrases).not.toContain('best ring for her gift');
  expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
});

test('filters ideas by tail length', async ({ page }) => {
  await page.locator('#seed').fill('moissanite engagement ring');
  await page.locator('#generate').click();
  await page.locator('.filter[data-filter="Long-tail"]').click();

  const types = await page.locator('#results .type').allTextContents();
  expect(types.length).toBeGreaterThan(0);
  expect(types.every((type) => type === 'Long-tail')).toBe(true);
});

test('records zero counts and exports the manual verification in CSV', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();

  const answers = ['0', '0', 'Automated browser test'];
  page.on('dialog', async (dialog) => {
    await dialog.accept(answers.shift() ?? '');
  });

  await page.locator('#results [data-check]').first().click();
  await expect(page.locator('#results .searches').first()).toHaveText('0');
  await expect(page.locator('#results .listings').first()).toHaveText('0');
  await expect(page.locator('#results .verify-state').first()).toContainText('Automated browser test');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-keyword-ideas.csv');

  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain('"search_count_manual"');
  expect(csv).toContain('"listing_count_manual"');
  expect(csv).toContain('"verification_status"');
  expect(csv).toContain('"source"');
  expect(csv).toContain('"0","0","manually_recorded","Automated browser test"');
  fs.unlinkSync(filePath);
});

test('wedding mode adapts phrases to wedding-specific product seeds', async ({ page }) => {
  await page.locator('#seed').fill('wedding guest book');
  await page.locator('#market').selectOption('wedding');
  await page.locator('#generate').click();

  const phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases).toContain('wedding guest book');
  expect(phrases).toContain('guest book for bride and groom');
  expect(phrases).toContain('personalized guest book gift');
  expect(phrases).not.toContain('wedding guest book for bride');
  expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
});

test('generic gift seeds do not produce redundant gift phrases', async ({ page }) => {
  for (const seed of ['gift', 'birthday gift', 'custom gift']) {
    await page.locator('#seed').fill(seed);
    await page.locator('#market').selectOption('general');
    await page.locator('#generate').click();
    const phrases = await page.locator('#results .kw').allTextContents();
    expect(phrases, seed).not.toContain('gift gift');
    expect(phrases, seed).not.toContain('birthday gift gift');
    expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
  }
});

test('empty seed shows a helpful message instead of generating rows', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#toast')).toHaveText('Enter a seed keyword first.');
  await expect(page.locator('#count')).toHaveText('0 ideas');
});
