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

test('saves, restores, and deletes a keyword research set', async ({ page }) => {
  await page.locator('#seed').fill('linen table runner');
  await page.locator('#market').selectOption('home');
  await page.locator('#generate').click();
  const original = await page.locator('#results .kw').allTextContents();

  await page.locator('#projectName').fill('Spring table linens');
  await page.locator('#saveProject').click();
  await expect(page.locator('#toast')).toContainText('Research set saved');
  await expect(page.locator('#savedProjects option')).toHaveCount(2);

  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#market').selectOption('general');
  await page.locator('#generate').click();
  await page.locator('#loadProject').click();
  await expect(page.locator('#seed')).toHaveValue('linen table runner');
  await expect(page.locator('#market')).toHaveValue('home');
  await expect(page.locator('#results .kw')).toHaveText(original);

  await page.locator('#deleteProject').click();
  await expect(page.locator('#savedProjects option')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('deleted');
});

test('requires a name and generated ideas before saving research', async ({ page }) => {
  await page.locator('#saveProject').click();
  await expect(page.locator('#toast')).toHaveText('Generate keyword ideas before saving a set.');
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#saveProject').click();
  await expect(page.locator('#toast')).toHaveText('Give this research set a name first.');
  await expect(page.locator('#savedProjects option')).toHaveCount(1);
});

test('empty seed shows a helpful message instead of generating rows', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#toast')).toHaveText('Enter a seed keyword first.');
  await expect(page.locator('#count')).toHaveText('0 ideas');
});


test('exports a JSON backup containing saved research and manual checks', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('Ceramic launch');
  await page.locator('#saveProject').click();
  const answers = ['12', '240', 'Etsy Marketplace Insights'];
  page.on('dialog', async (dialog) => dialog.accept(answers.shift() ?? ''));
  await page.locator('#results [data-check]').first().click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportBackup').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-research-backup.json');
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  expect(backup.format).toBe('sellerscope-research-backup');
  expect(backup.version).toBe(1);
  expect(backup.projects[0].name).toBe('Ceramic launch');
  expect(Object.values(backup.checks)[0].source).toBe('Etsy Marketplace Insights');
  fs.unlinkSync(filePath);
});

test('imports a valid backup and rejects an unsupported backup', async ({ page }) => {
  const filePath = path.join(os.tmpdir(), 'sellerscope-test-backup.json');
  const backup = {
    format: 'sellerscope-research-backup',
    version: 1,
    exportedAt: '2026-10-18T00:00:00.000Z',
    projects: [{
      id: 'imported-set-1',
      name: 'Imported mugs',
      seed: 'ceramic mug',
      mode: 'home',
      ideas: [{ phrase: 'ceramic mug', type: 'Short-tail' }],
      savedAt: '2026-10-18T00:00:00.000Z'
    }],
    checks: { 'ceramic mug': { searches: '0', listings: '18', source: 'Manual test', date: '2026-10-18' } }
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toContainText('Backup imported');
  await expect(page.locator('#savedProjects option')).toHaveCount(2);
  await page.locator('#savedProjects').selectOption({ label: 'Imported mugs · ceramic mug' });
  await page.locator('#loadProject').click();
  await expect(page.locator('#seed')).toHaveValue('ceramic mug');
  await expect(page.locator('#market')).toHaveValue('home');
  await expect(page.locator('#results .searches').first()).toHaveText('0');

  fs.writeFileSync(filePath, JSON.stringify({ format: 'wrong-format', version: 99, projects: [], checks: {} }));
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toHaveText('This is not a supported SellerScope backup.');
  await expect(page.locator('#savedProjects option')).toHaveCount(2);
  fs.unlinkSync(filePath);
});

test('adds relevant variants for common Etsy product categories', async ({ page }) => {
  const cases = [
    ['personalized necklace', 'personalized', ['personalized necklace', 'necklace gift for her']],
    ['daily planner', 'general', ['daily planner gift for students', 'personalized daily planner cover']],
    ['dog collar', 'general', ['dog collar accessory', 'dog collar gift for pet lovers']],
    ['ceramic vase', 'home', ['ceramic vase shelf styling', 'ceramic vase housewarming gift']],
  ];

  for (const [seed, mode, expected] of cases) {
    await page.locator('#seed').fill(seed);
    await page.locator('#market').selectOption(mode);
    await page.locator('#generate').click();
    const phrases = await page.locator('#results .kw').allTextContents();
    for (const phrase of expected) {
      expect(phrases, `missing "${phrase}" for seed "${seed}"`).toContain(phrase);
    }
    expect(new Set(phrases.map((phrase) => phrase.toLowerCase())).size).toBe(phrases.length);
  }
});


test('shortlists keyword ideas, saves seller notes, and exports only selected phrases', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#market').selectOption('home');
  await page.locator('#generate').click();

  const firstPhrase = await page.locator('#results .kw').first().textContent();
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('Strong fit for the autumn home collection');
  await page.locator('#results [data-note]').first().press('Tab');
  await expect(page.locator('#shortlistSummary')).toContainText('1 shortlisted');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportShortlist').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-keyword-shortlist.csv');
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain('"seller_note"');
  expect(csv).toContain('Strong fit for the autumn home collection');
  expect(csv).toContain(firstPhrase);
  expect(csv).not.toContain('minimalist ceramic vase');
  fs.unlinkSync(filePath);
});

test('saved research restores shortlist selections and notes', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('Test for gift shoppers');
  await page.locator('#results [data-note]').first().press('Tab');
  const phrase = await page.locator('#results .kw').first().textContent();

  await page.locator('#projectName').fill('Vase shortlist');
  await page.locator('#saveProject').click();
  await page.locator('#seed').fill('linen table runner');
  await page.locator('#generate').click();
  await page.locator('#savedProjects').selectOption({ label: 'Vase shortlist · ceramic vase' });
  await page.locator('#loadProject').click();

  await expect(page.locator('#results .kw').first()).toHaveText(phrase);
  await expect(page.locator('#results [data-shortlist]').first()).toBeChecked();
  await expect(page.locator('#results [data-note]').first()).toHaveValue('Test for gift shoppers');
  await expect(page.locator('#shortlistSummary')).toContainText('1 shortlisted');
});


test('shortlist-only filter shows selected phrases and composes with tail filters', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  const phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases.length).toBeGreaterThan(1);

  await page.locator('#results [data-shortlist="0"]').check();
  const selectedPhrase = phrases[0];
  await page.locator('#shortlistOnly').click();
  await expect(page.locator('#shortlistOnly')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#results .kw')).toHaveText([selectedPhrase]);

  await page.locator('.filter[data-filter="Long-tail"]').click();
  const visibleTypes = await page.locator('#results .type').allTextContents();
  expect(visibleTypes.every((type) => type === 'Long-tail')).toBe(true);
  await expect(page.locator('#results .kw')).toHaveCount(0);

  await page.locator('#shortlistOnly').click();
  await expect(page.locator('#shortlistOnly')).toHaveAttribute('aria-pressed', 'false');
  const unfilteredLongTailTypes = await page.locator('#results .type').allTextContents();
  expect(unfilteredLongTailTypes.length).toBeGreaterThan(0);
  expect(unfilteredLongTailTypes.every((type) => type === 'Long-tail')).toBe(true);
});

test('shows transparent research priority and sorts by heuristic score', async ({ page }) => {
  await page.locator('#seed').fill('personalized ceramic vase');
  await page.locator('#market').selectOption('home');
  await page.locator('#generate').click();

  const scores = await page.locator('#results .priority strong').allTextContents();
  expect(scores.length).toBeGreaterThan(0);
  expect(scores.every((score) => /^([0-5])\\/5 · (Strong|Review|Explore)$/.test(score))).toBe(true);
  await expect(page.locator('.hint').filter({ hasText: 'not search volume' })).toBeVisible();

  await page.locator('#prioritySort').selectOption('priority');
  const sortedScores = (await page.locator('#results .priority strong').allTextContents())
    .map((score) => Number(score.match(/^([0-5])\\/)[1]));
  expect(sortedScores).toEqual([...sortedScores].sort((a, b) => b - a));
});
