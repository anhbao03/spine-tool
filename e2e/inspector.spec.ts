import { expect, test, type Page } from '@playwright/test'

const sb = (f: string) => `fixtures/spineboy-3.8/${f}`
const importFiles = (page: Page, files: string[]) => page.setInputFiles('input[type=file]', files)

test('P1-01/03/05/06/07: import, tree, inspector, playback, viewport', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await importFiles(page, [sb('spineboy-pro.json'), sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.locator('header')).toContainText('spineboy-pro · Spine 3.8.55')
  await expect(page.locator('#bone\\:root')).toBeVisible()

  // Tree selection drives the inspector.
  await page.locator('[id="slot:head"]').click()
  await expect(page.locator('.inspector h3').first()).toHaveText('Slot · head')
  await page.locator('[id="bone:hip"]').click()
  await expect(page.locator('.inspector')).toContainText('Setup pose · source data · local')

  // Canvas pick highlights a tree row.
  await page.locator('[id="slot:head"]').click()
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3)
  await expect(page.locator('.row.on')).toHaveCount(1)

  // Seeking updates the time display; pause holds it.
  await page.selectOption('select[aria-label=Animation]', 'run')
  const slider = page.locator('input[aria-label="Animation time"]')
  await slider.fill('0.4')
  await expect(page.locator('.time')).toContainText('0.400 /')
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(250) // UI polls runtime state at 10 Hz
  const paused = await page.locator('.time').textContent()
  await page.waitForTimeout(300)
  await expect(page.locator('.time')).toHaveText(paused!)

  await page.getByRole('button', { name: 'Fit' }).click()
  await page.screenshot({ path: 'test-results/inspector.png' })
  expect(errors).toEqual([])
})

test('P1-02: missing texture names the page', async ({ page }) => {
  await page.goto('/')
  await importFiles(page, [sb('spineboy-pro.json'), sb('spineboy.atlas')])
  await expect(page.getByRole('alert')).toContainText('"spineboy.png" was not provided')
  // UI stays usable: retry with the image works.
  await importFiles(page, [sb('spineboy-pro.json'), sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.locator('header')).toContainText('Spine 3.8.55')
})

test('P1-08: other versions are blocked with the detected version', async ({ page }) => {
  await page.goto('/')
  await importFiles(page, ['fixtures/version-mismatch/spineboy-4.0.json', sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.getByRole('alert')).toContainText('Spine 4.0.31 detected')
  await importFiles(page, ['fixtures/version-mismatch/spineboy-4.0.skel', sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.getByRole('alert').last()).toContainText('spineboy-4.0.skel: Spine 4.0.31 detected')
  await expect(page.locator('header')).not.toContainText('Spine 4')
})

test('binary .skel loads and plays', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await importFiles(page, [sb('spineboy-pro.skel'), sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.locator('header')).toContainText('spineboy-pro · Spine 3.8.55 binary')
  await expect(page.locator('[id="slot:head"]')).toBeVisible()
  await page.selectOption('select[aria-label=Animation]', 'walk')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('details', { hasText: 'Events' }).first()).toContainText('footstep')
  expect(errors).toEqual([])
})

test('tree search filters to matches and their ancestors', async ({ page }) => {
  await page.goto('/')
  await importFiles(page, [sb('spineboy-pro.json'), sb('spineboy.atlas'), sb('spineboy.png')])
  const search = page.getByLabel('Find in skeleton tree')
  await search.fill('Gun')
  await expect(page.locator('[id="bone:gun"]')).toBeVisible()
  await expect(page.locator('[id="bone:root"]')).toBeVisible() // ancestor kept
  await expect(page.locator('[id="bone:head"]')).toHaveCount(0)
  await expect(page.locator('.row mark').first()).toHaveText(/gun/i)
  await page.locator('[id="slot:gun"]').click()
  await expect(page.locator('.inspector h3').first()).toHaveText('Slot · gun')
  await search.fill('zzz')
  await expect(page.locator('.tree')).toContainText('No matches for “zzz”')
  await search.press('Escape')
  await expect(page.locator('[id="bone:head"]')).toBeVisible()
  await expect(page.locator('[id="slot:gun"]')).toHaveClass(/on/)
  await search.fill('gun')
  await page.screenshot({ path: 'test-results/search.png', clip: { x: 0, y: 0, width: 420, height: 400 } })
})
