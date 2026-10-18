import { expect, test, type Page } from '@playwright/test'

const sb = (f: string) => `fixtures/spineboy-3.8/${f}`

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.setInputFiles('input[type=file]', [sb('spineboy-pro.json'), sb('spineboy.atlas'), sb('spineboy.png')])
  await expect(page.locator('header')).toContainText('Spine 3.8.55')
  return errors
}

const time = (page: Page) => page.locator('.time')

test('P2-01: overlays draw and turning them off restores the exact frame', async ({ page }) => {
  const errors = await open(page)
  // Reads the frame through Pixi's extract (skeleton + overlays only, no DOM).
  // Two animation frames first, so the ticker has redrawn overlays after a toggle.
  const shot = () => page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const vp = (window as any).vp
    return vp.app.renderer.extract.base64(vp.app.stage) as Promise<string>
  })
  const before = await shot()
  for (const name of ['Bones', 'Bone names', 'Hierarchy', 'Meshes', 'Bounding boxes', 'Regions'])
    await page.getByLabel(name, { exact: true }).check()
  await page.screenshot({ path: 'test-results/overlays.png' })
  expect(await shot()).not.toBe(before)
  for (const name of ['Bones', 'Bone names', 'Hierarchy', 'Meshes', 'Bounding boxes', 'Regions'])
    await page.getByLabel(name, { exact: true }).uncheck()
  expect(await shot()).toBe(before)
  expect(errors).toEqual([])
})

test('P2-04/05: stepping, event monitor, seek fires nothing', async ({ page }) => {
  const errors = await open(page)
  await page.selectOption('select[aria-label=Animation]', 'run')
  await expect(page.locator('.bar')).toContainText('30 fps (default)')
  // Starting run fires its time-0 footstep, like the runtime does.
  await expect(page.locator('details', { hasText: 'Events (1)' })).toContainText('key 0 s')

  await page.locator('input[aria-label="Animation time"]').fill('0.4')
  await page.getByLabel('Step forward one frame').click()
  await expect(time(page)).toContainText('0.433 /')
  await page.getByLabel('Step back one frame').click()
  await page.getByLabel('Step back one frame').click()
  await expect(time(page)).toContainText('0.367 /')
  await expect(page.locator('details', { hasText: 'Events (1)' })).toBeVisible() // steps crossed no keys

  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.locator('.inspector')).toContainText('footstep')
  await expect(page.locator('.inspector')).toContainText('key 0.367 s')

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.locator('.inspector')).toContainText('No events yet.')
  for (const t of ['0.1', '0.7', '0.2']) await page.locator('input[aria-label="Animation time"]').fill(t)
  await page.waitForTimeout(300)
  await expect(page.locator('.inspector')).toContainText('No events yet.')
  expect(errors).toEqual([])
})

test('P2-02/03: animation state with mixing, slot monitor', async ({ page }) => {
  const errors = await open(page)
  await page.selectOption('select[aria-label=Animation]', 'walk')
  await page.getByLabel('Mix').fill('0.2')
  await page.selectOption('select[aria-label=Animation]', 'run')
  const state = page.locator('details', { hasText: 'Animation state' })
  await expect(state).toContainText('mixing from')
  await expect(state.locator('tr', { hasText: 'mixing from' })).toContainText('walk')
  await expect(state.locator('tr', { hasText: 'mixDuration' })).toContainText('0.2 /')

  await page.locator('summary', { hasText: 'Slot monitor' }).click()
  const monitor = page.locator('details', { hasText: 'Slot monitor' })
  await expect(monitor.locator('tr', { hasText: 'crosshair' })).toContainText('(empty)')
  await monitor.locator('tr', { hasText: 'goggles' }).click()
  await expect(page.locator('.inspector h3').first()).toHaveText('Slot · goggles')
  expect(errors).toEqual([])
})

test('metrics panel shows skeleton, attachment, and animation cost', async ({ page }) => {
  const errors = await open(page)
  const m = page.locator('details', { has: page.locator('summary', { hasText: 'Metrics' }) })
  const row = (k: string) => m.locator('tr', { has: page.locator('td:first-child', { hasText: new RegExp(`^${k}$`) }) }).locator('td').nth(1)
  await expect(row('Bones')).toHaveText('64')
  await expect(row('Slots')).toHaveText('52')
  await expect(row('Constraints')).toHaveText('14')
  const first = await row('Timelines').innerText()
  await page.getByLabel('Animation', { exact: true }).selectOption('walk')
  await expect(m).toContainText('Animation · walk')
  await expect(row('Timelines')).not.toHaveText(first)
  expect(errors).toEqual([])
})

test('loop off holds the last frame; loop on wraps', async ({ page }) => {
  const errors = await open(page)
  const t = async () => +(await time(page).innerText()).split(' / ')[0]
  const d = async () => +(await time(page).innerText()).split(' / ')[1].split(' ')[0]
  await page.getByLabel('Animation', { exact: true }).selectOption('walk')
  await page.getByLabel('Loop').uncheck()
  await page.getByLabel('Playback speed').selectOption('4')
  await page.getByRole('button', { name: 'Restart' }).click()
  const dur = await d()
  await expect.poll(t).toBe(dur)
  await page.waitForTimeout(300)
  expect(await t()).toBe(dur)
  await page.getByLabel('Loop').check()
  await expect.poll(t).toBeLessThan(dur)
  expect(errors).toEqual([])
})

test('skin select, animation sequence, frame ruler, snapshot', async ({ page }) => {
  const errors = await open(page)
  await expect(page.getByLabel('Skin', { exact: true })).toHaveValue('default')

  for (const a of ['idle', 'jump', 'hoverboard']) await page.selectOption('select[aria-label="Add to sequence"]', a)
  await page.selectOption('select[aria-label="Playback speed"]', '4')
  await page.getByRole('button', { name: 'Run sequence' }).click()
  await expect(page.locator('.frameinfo')).toContainText('idle (1/3)')
  await expect(page.locator('.frameinfo')).toContainText('hoverboard (3/3)', { timeout: 5000 })
  // The last animation loops by default, so the sequence stays on it.
  await page.waitForTimeout(1000)
  await expect(page.locator('.frameinfo')).toContainText('hoverboard (3/3)')
  await page.getByRole('button', { name: 'Restart' }).click()
  await expect(page.locator('.frameinfo')).toContainText('(1/3)')

  await page.getByRole('button', { name: 'Pause' }).click()
  await page.locator('input[aria-label="Animation time"]').fill('0.4')
  await expect(page.locator('.frameinfo')).toContainText('frame 12 /')
  await expect(page.locator('.ruler .keymark').first()).toBeAttached()
  await page.screenshot({ path: 'test-results/timeline.png' })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Snapshot' }).click()
  expect((await download).suggestedFilename()).toBe('spineboy-pro_idle_f12.png')
  expect(errors).toEqual([])
})
