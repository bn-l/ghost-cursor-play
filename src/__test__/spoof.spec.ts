import { test as baseTest, Page, Browser } from '@playwright/test'
import { createCursor, GhostCursor } from '../spoof'
import { join } from 'path'
import { promises as fs } from 'fs'
import installMouseHelper from '../mouse-helper'

let cursor: GhostCursor

// Extending the test fixture to include the browser object and renaming it to avoid conflict
const extendedTest = baseTest.extend<{ page: Page, browser: Browser }>({
    page: async ({ page }, use) => {
        // Install mouse helper before each test
        await installMouseHelper(page)
        await use(page)
    }
})

extendedTest.describe('Mouse movements', () => {
    extendedTest('Should click on the element without throwing an error (CSS selector)', async ({ page, browser }) => {
        const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')
        await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
            waitUntil: 'networkidle'
        })
        cursor = createCursor(browser, page) // Passing the browser object
        await cursor.click('#box')
    })

    extendedTest('Should click on the element without throwing an error (XPath selector)', async ({ page, browser }) => {
        const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')
        await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
            waitUntil: 'networkidle'
        })
        cursor = createCursor(browser, page) // Passing the browser object
        await cursor.click('//*[@id="box"]')
    })
})

extendedTest.setTimeout(15000)
