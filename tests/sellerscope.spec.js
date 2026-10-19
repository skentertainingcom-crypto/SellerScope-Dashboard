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
  await expect(page).toHaveTitle('EtsyScope — Keyword Research');
  await expect(page.locator('.brand')).toHaveText('EtsyScope');
  await expect(page.locator('.foot')).toContainText('EtsyScope is an independent project');
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
  expect(csv).toContain('"research_priority_score"');
  const firstPhrase = await page.locator('#results .kw').first().textContent();
  const firstScore = (await page.locator('#results .priority strong').first().textContent()).split('/')[0];
  expect(csv).toContain(`"${firstPhrase}","${await page.locator('#results .type').first().textContent()}","${firstScore}"`);
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

  page.once('dialog', dialog => dialog.accept());
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
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('Gift-ready product angle');

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
  expect(Object.values(backup.shortlist)[0]).toEqual({ selected: true, note: 'Gift-ready product angle' });
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
    checks: {
      'ceramic mug': { searches: '0', listings: '18', source: 'Manual test', date: '2026-10-18' },
      'empty source': { searches: '12', listings: '18', source: '   ', date: '2026-10-18' },
      'invalid count': { searches: 'many', listings: '18', source: 'Manual test', date: '2026-10-18' },
      'invalid date': { searches: '12', listings: '18', source: 'Manual test', date: '2026-02-31' },
      'missing count': { listings: '18', source: 'Manual test', date: '2026-10-18' },
      '': { searches: '12', listings: '18', source: 'Manual test', date: '2026-10-18' }
    },
    shortlist: { 'ceramic mug': { selected: true, note: 'Gift-ready product angle' } }
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Import backup?'); return dialog.accept(); });
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toContainText('Backup imported');
  await expect(page.locator('#toast')).toContainText('5 invalid records');
  const importedChecks = await page.evaluate(() => JSON.parse(localStorage.getItem('sellerscope.keywordChecks.v1') || '{}'));
  expect(importedChecks).toEqual({ 'ceramic mug': { searches: '0', listings: '18', source: 'Manual test', date: '2026-10-18' } });
  await expect(page.locator('#savedProjects option')).toHaveCount(2);
  await page.locator('#savedProjects').selectOption({ label: 'Imported mugs · ceramic mug' });
  await page.locator('#loadProject').click();
  await expect(page.locator('#seed')).toHaveValue('ceramic mug');
  await expect(page.locator('#market')).toHaveValue('home');
  await expect(page.locator('#results .searches').first()).toHaveText('0');
  await expect(page.locator('#results [data-shortlist]').first()).toBeChecked();
  await expect(page.locator('#results [data-note]').first()).toHaveValue('Gift-ready product angle');

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
  expect(scores.every((score) => /^([0-5])\/5 · (Strong|Review|Explore)$/.test(score))).toBe(true);
  await expect(page.locator('.hint').filter({ hasText: 'not search volume' })).toBeVisible();

  await page.locator('#prioritySort').selectOption('priority');
  const sortedScores = (await page.locator('#results .priority strong').allTextContents())
    .map((score) => Number(score.split('/')[0]));
  expect(sortedScores).toEqual([...sortedScores].sort((a, b) => b - a));
});


test('shortlist CSV includes research priority and seller notes', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();
  const phrase = await page.locator('#results .kw').first().textContent();
  const score = (await page.locator('#results .priority strong').first().textContent()).split('/')[0];
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('Test a gift-focused listing');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportShortlist').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-keyword-shortlist.csv');
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain('"research_priority_score"');
  expect(csv).toContain('"buyer_intent"');
  expect(csv).toContain(`"${phrase}","Short-tail","${score}","Personalization","Test a gift-focused listing"`);
  fs.unlinkSync(filePath);
});


test('explains research priority scores with transparent heuristic signals', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();
  const priority = page.locator('#results .priority').first();
  await expect(priority).toHaveAttribute('title', /Heuristic score:/);
  await expect(priority).toHaveAttribute('aria-label', /Heuristic only/);
  const explanation = await priority.getAttribute('title');
  expect(explanation).toContain('matches seed terms');
  expect(explanation).toContain('not Etsy search volume');
});

test('adds niche-aware suggestions for craft, bath, art, and digital products', async ({ page }) => {
  const cases = [
    { seed: 'crochet pattern', expected: 'crochet pattern for beginners' },
    { seed: 'handmade soap', expected: 'soap gift set' },
    { seed: 'botanical art print', expected: 'botanical art print gallery wall' },
    { seed: 'digital planner', expected: 'digital planner download' },
  ];

  for (const { seed, expected } of cases) {
    await page.locator('#seed').fill(seed);
    await page.locator('#market').selectOption('general');
    await page.locator('#generate').click();

    const phrases = await page.locator('#results .kw').allTextContents();
    expect(phrases, `missing niche suggestion for ${seed}`).toContain(expected);
    expect(
      new Set(phrases.map((phrase) => phrase.toLowerCase())).size,
      `duplicate phrases for ${seed}`,
    ).toBe(phrases.length);
  }
});

test('classifies buyer intent, filters by intent, and compares research coverage', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();

  await expect(page.locator('#researchSummary')).toContainText('Visible:');
  await expect(page.locator('#researchSummary')).toContainText('Manually checked: 0');

  const allIntents = await page.locator('#results .intent').allTextContents();
  expect(allIntents).toContain('Personalization');
  expect(allIntents).toContain('Gift-led');

  await page.locator('#intentFilter').selectOption('Gift-led');
  const visibleIntents = await page.locator('#results .intent').allTextContents();
  expect(visibleIntents.length).toBeGreaterThan(0);
  expect(visibleIntents.every((intent) => intent === 'Gift-led')).toBe(true);
  await expect(page.locator('#researchSummary')).toContainText('Intent: Gift-led');

  await page.locator('#intentFilter').selectOption('Personalization');
  const personalIntents = await page.locator('#results .intent').allTextContents();
  expect(personalIntents.length).toBeGreaterThan(0);
  expect(personalIntents.every((intent) => intent === 'Personalization')).toBe(true);
  await expect(page.locator('#researchSummary')).toContainText('Intent: Personalization');
});


test('shows shortlist research gaps and exports an actionable listing test plan', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();
  const phrases = await page.locator('#results .kw').allTextContents();
  expect(phrases.length).toBeGreaterThan(1);

  await page.locator('#results [data-shortlist="0"]').check();
  await page.locator('#results [data-shortlist="1"]').check();
  await expect(page.locator('#researchGaps')).toContainText('2 shortlisted phrases without a recorded source/date');
  await expect(page.locator('#researchGaps')).toContainText('2 shortlisted phrases missing manual search or listing counts');

  const answers = ['10', '', 'Automated browser test'];
  page.on('dialog', async (dialog) => dialog.accept(answers.shift() ?? ''));
  await page.locator('#results [data-check]').first().click();
  await expect(page.locator('#researchGaps')).toContainText('1 shortlisted phrase without a recorded source/date');
  await expect(page.locator('#researchGaps')).toContainText('2 shortlisted phrases missing manual search or listing counts');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportTestPlan').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-listing-test-plan.csv');
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain('"recommended_next_step"');
  expect(csv).toContain('"research_priority_score_heuristic"');
  expect(csv).toContain('"Check this phrase in a permitted source and record source/date"');
  expect(csv).toContain('"Fill in the missing manually observed search or listing count"');
  expect(csv).toContain('not Etsy search volume, competition, or a sales forecast');
  expect(csv).toContain(phrases[0]);
  expect(csv).toContain(phrases[1]);
  fs.unlinkSync(filePath);
});

test('neutralizes spreadsheet formulas in user-controlled CSV fields', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('=HYPERLINK("https://example.com","open")');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportShortlist').click();
  const download = await downloadPromise;
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.com\"\",\"\"open\"\")\"");
  fs.unlinkSync(filePath);
});

test('neutralizes formula-like seller notes in listing test plan exports', async ({ page }) => {
  await page.locator('#seed').fill('personalized necklace');
  await page.locator('#generate').click();
  await page.locator('#results [data-shortlist]').first().check();
  await page.locator('#results [data-note]').first().fill('  =HYPERLINK("https://example.com","open")');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportTestPlan').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sellerscope-listing-test-plan.csv');
  const filePath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  expect(csv).toContain('"\'=HYPERLINK(""https://example.com"",""open"")"');
  fs.unlinkSync(filePath);
});


test('searches generated phrases and seller notes without changing saved ideas', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  const originalCount = await page.locator('#results tr').count();
  expect(originalCount).toBeGreaterThan(1);

  await page.locator('#results [data-note]').first().fill('gift for a new home');
  await page.locator('#results [data-note]').first().dispatchEvent('change');
  await page.locator('#keywordSearch').fill('new home');
  await expect(page.locator('#results tr')).toHaveCount(1);
  await expect(page.locator('#results .kw').first()).toBeVisible();

  await page.locator('#keywordSearch').fill('ceramic');
  expect(await page.locator('#results tr').count()).toBeGreaterThan(1);
  await page.locator('#keywordSearch').fill('phrase-that-does-not-exist');
  await expect(page.locator('#results .empty')).toContainText('No keywords in this category');
  await page.locator('#keywordSearch').fill('');
  await expect(page.locator('#results tr')).toHaveCount(originalCount);
});


test('copies only the currently visible keyword ideas when filters or search are active', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#keywordSearch').fill('housewarming');
  const visible = await page.locator('#results .kw').allTextContents();
  expect(visible.length).toBeGreaterThan(0);
  await page.locator('#copyVisible').click();
  await expect(page.locator('#toast')).toContainText('Copied.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\\n')).toEqual(visible);
  expect(copied.split('\\n').length).toBeLessThan(await page.locator('#results .kw').count() + 1);

  await page.locator('#keywordSearch').fill('no-match-at-all');
  await page.locator('#copyVisible').click();
  await expect(page.locator('#toast')).toContainText('No visible keyword ideas to copy');
});


test('renames saved research and requires confirmation before deleting it', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('Vase shortlist');
  await page.locator('#saveProject').click();

  await expect(page.locator('#savedCount')).toContainText('1 saved set');
  await expect(page.locator('#savedProjects')).toContainText('Vase shortlist · ceramic vase');
  await page.locator('#projectName').fill('Ceramic vase research');
  await page.locator('#renameProject').click();
  await expect(page.locator('#savedProjects')).toContainText('Ceramic vase research · ceramic vase');
  await expect(page.locator('#toast')).toContainText('renamed');

  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#deleteProject').click();
  await expect(page.locator('#savedCount')).toContainText('1 saved set');
  await expect(page.locator('#savedProjects')).toContainText('Ceramic vase research · ceramic vase');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#deleteProject').click();
  await expect(page.locator('#savedCount')).toContainText('0 saved sets');
  await expect(page.locator('#savedProjects option')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('deleted from this device');
});


test('does not keep an unsaved research set in memory when browser storage fails', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('Storage failure test');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sellerscope.savedResearch.v1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#saveProject').click();
  await expect(page.locator('#toast')).toContainText('Could not save research');
  await expect(page.locator('#savedCount')).toContainText('0 saved sets');
  await page.evaluate(() => { delete Storage.prototype.setItem; });
  await page.reload();
  await expect(page.locator('#savedCount')).toContainText('0 saved sets');
  await expect(page.locator('#savedProjects')).not.toContainText('Storage failure test');
});

test('warns before saving a 51st research set would discard the oldest', async ({ page }) => {
  const saved = Array.from({ length: 50 }, (_, i) => ({
    id: 'saved-' + i, name: 'Saved set ' + i, seed: 'seed ' + i, mode: 'general',
    ideas: [{ phrase: 'seed ' + i, type: 'Short-tail' }], savedAt: new Date(2026, 0, i + 1).toISOString()
  }));
  await page.evaluate((items) => localStorage.setItem('sellerscope.savedResearch.v1', JSON.stringify(items)), saved);
  await page.reload();
  await page.locator('#seed').fill('new ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('New research set');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#saveProject').click();
  await expect(page.locator('#toast')).toHaveText('Save canceled. Your existing saved research was kept.');
  await expect(page.locator('#savedCount')).toContainText('50 saved sets');
  await expect(page.locator('#savedProjects')).toContainText('Saved set 49 · seed 49');
  await expect(page.locator('#savedProjects')).toContainText('Saved set 0 · seed 0');
  await expect(page.locator('#savedProjects')).not.toContainText('New research set');
});

test('warns when backup import would evict the oldest saved sets at the 50-set limit', async ({ page }) => {
  const saved = Array.from({ length: 50 }, (_, i) => ({
    id: 'saved-' + i, name: 'Saved set ' + i, seed: 'seed ' + i, mode: 'general',
    ideas: [{ phrase: 'seed ' + i, type: 'Short-tail' }], savedAt: new Date(2026, 0, i + 1).toISOString()
  }));
  await page.evaluate((items) => localStorage.setItem('sellerscope.savedResearch.v1', JSON.stringify(items)), saved);
  await page.reload();
  const filePath = path.join(os.tmpdir(), 'sellerscope-overflow-backup.json');
  const backup = {
    format: 'sellerscope-research-backup', version: 1,
    projects: [{ id: 'incoming-overflow', name: 'Incoming set', seed: 'new mug', mode: 'home', ideas: [{ phrase: 'new mug', type: 'Short-tail' }] }],
    checks: {}, shortlist: {}
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('1 oldest saved set will be removed');
    expect(dialog.message()).toContain('Export a backup first');
    await dialog.dismiss();
  });
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toHaveText('Backup import canceled. Your existing research was not changed.');
  await expect(page.locator('#savedCount')).toContainText('50 saved sets');
  await expect(page.locator('#savedProjects')).toContainText('Saved set 0 · seed 0');
  await expect(page.locator('#savedProjects')).not.toContainText('Incoming set');
  fs.unlinkSync(filePath);
});

test('reports invalid backup records and duplicate saved sets before importing', async ({ page }) => {
  await page.locator('#seed').fill('ceramic mug');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('Existing set');
  await page.locator('#saveProject').click();
  const existingId = await page.evaluate(() => JSON.parse(localStorage.getItem('sellerscope.savedResearch.v1'))[0].id);

  const filePath = path.join(os.tmpdir(), 'sellerscope-partial-backup.json');
  const backup = {
    format: 'sellerscope-research-backup', version: 1,
    projects: [
      { id: existingId, name: 'Duplicate ID', seed: 'other mug', mode: 'home', ideas: [{ phrase: 'other mug', type: 'Short-tail' }] },
      { id: 'invalid-set', name: 'Broken', seed: 'broken', mode: 'unknown', ideas: [] }
    ],
    checks: { 'ceramic mug': { searches: '10', listings: '25', source: 'Manual', date: '2026-10-18' }, broken: { searches: 7 } },
    shortlist: { 'ceramic mug': { selected: true, note: 'Valid note' }, broken: { selected: 'yes' } }
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('add 0 new saved sets (1 invalid sets will be skipped)');
    expect(dialog.message()).toContain('1 invalid checks will be skipped');
    expect(dialog.message()).toContain('1 invalid entries will be skipped');
    await dialog.accept();
  });
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toContainText('Skipped invalid records: 3');
  await expect(page.locator('#savedProjects option')).toHaveCount(2);
  await expect(page.locator('#savedProjects')).not.toContainText('Duplicate ID');
  fs.unlinkSync(filePath);
});

test('cancels backup import without changing saved research', async ({ page }) => {
  await page.locator('#seed').fill('ceramic vase');
  await page.locator('#generate').click();
  await page.locator('#projectName').fill('Existing research');
  await page.locator('#saveProject').click();

  const filePath = path.join(os.tmpdir(), 'sellerscope-cancel-import.json');
  const backup = {
    format: 'sellerscope-research-backup', version: 1,
    projects: [{ id: 'incoming-set', name: 'Incoming set', seed: 'ceramic mug', mode: 'home', ideas: [{ phrase: 'ceramic mug', type: 'Short-tail' }] }],
    checks: { 'ceramic mug': { searches: '12', listings: '30', source: 'Imported source', date: '2026-10-18' } },
    shortlist: { 'ceramic mug': { selected: true, note: 'Incoming note' } }
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('matching phrases');
    await dialog.dismiss();
  });
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#toast')).toHaveText('Backup import canceled. Your existing research was not changed.');
  await expect(page.locator('#savedProjects option')).toHaveCount(2);
  await expect(page.locator('#savedProjects')).toContainText('Existing research · ceramic vase');
  await expect(page.locator('#savedProjects')).not.toContainText('Incoming set');
  fs.unlinkSync(filePath);
});

test('recovers safely from valid JSON with the wrong stored data shape', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(() => {
    localStorage.setItem('sellerscope.keywordChecks.v1', 'null');
    localStorage.setItem('sellerscope.shortlist.v1', '[]');
    localStorage.setItem('sellerscope.savedResearch.v1', '{"unexpected":"shape"}');
  });
  await page.reload();
  await page.locator('#seed').fill('handmade ceramic mug');
  await page.locator('#generate').click();
  await expect(page.locator('#results .kw').first()).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Etsy search was not performed');
  expect(pageErrors).toEqual([]);
});


test('ignores malformed nested saved-research records while retaining valid sets', async ({ page }) => {
  const valid = { id: 'valid-set', name: 'Valid mugs', seed: 'ceramic mug', mode: 'home', ideas: [{ phrase: 'ceramic mug', type: 'Short-tail' }] };
  const malformed = [
    { id: 'bad-mode', name: 'Bad mode', seed: 'mug', mode: 'unknown', ideas: [{ phrase: 'mug', type: 'Short-tail' }] },
    { id: 'bad-idea', name: 'Bad idea', seed: 'mug', mode: 'general', ideas: [{ phrase: 'mug', type: 'Unexpected' }] },
    { id: 'null-idea', name: 'Null idea', seed: 'mug', mode: 'general', ideas: [null] },
    { id: 'too-many-ideas', name: 'Too many ideas', seed: 'mug', mode: 'general', ideas: Array.from({ length: 501 }, () => ({ phrase: 'mug', type: 'Short-tail' })) },
  ];
  await page.evaluate(({ valid, malformed }) => localStorage.setItem('sellerscope.savedResearch.v1', JSON.stringify([valid, ...malformed])), { valid, malformed });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.reload();
  await expect(page.locator('#savedCount')).toContainText('1 saved set');
  await expect(page.locator('#savedProjects')).toContainText('Valid mugs · ceramic mug');
  for (const name of ['Bad mode', 'Bad idea', 'Null idea', 'Too many ideas']) {
    await expect(page.locator('#savedProjects')).not.toContainText(name);
  }
  await page.locator('#savedProjects').selectOption('valid-set');
  await page.locator('#loadProject').click();
  await expect(page.locator('#results .kw').first()).toHaveText('ceramic mug');
  expect(pageErrors).toEqual([]);
});


test('imports only one saved research set for duplicate IDs inside a backup', async ({ page }) => {
  const filePath = path.join(os.tmpdir(), 'sellerscope-duplicate-import-ids.json');
  const backup = {
    format: 'sellerscope-research-backup', version: 1,
    projects: [
      { id: 'duplicate-incoming', name: 'First version', seed: 'ceramic mug', mode: 'home', ideas: [{ phrase: 'ceramic mug', type: 'Short-tail' }] },
      { id: 'duplicate-incoming', name: 'Second version', seed: 'glass mug', mode: 'home', ideas: [{ phrase: 'glass mug', type: 'Short-tail' }] },
      { id: 'unique-incoming', name: 'Unique set', seed: 'linen tote', mode: 'general', ideas: [{ phrase: 'linen tote', type: 'Short-tail' }] }
    ],
    checks: {}, shortlist: {}
  };
  fs.writeFileSync(filePath, JSON.stringify(backup));
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('add 2 new saved sets');
    await dialog.accept();
  });
  await page.locator('#importBackup').setInputFiles(filePath);
  await expect(page.locator('#savedCount')).toContainText('2 saved sets');
  await expect(page.locator('#savedProjects')).toContainText('First version · ceramic mug');
  await expect(page.locator('#savedProjects')).toContainText('Unique set · linen tote');
  await expect(page.locator('#savedProjects')).not.toContainText('Second version');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sellerscope.savedResearch.v1')));
  expect(stored.map(item => item.id)).toEqual(['duplicate-incoming', 'unique-incoming']);
  fs.unlinkSync(filePath);
});
