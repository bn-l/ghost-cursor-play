import { test as baseTest, Page, Browser, expect } from '@playwright/test'
import { createCursor, GhostCursor, getRandomPagePoint, getObjectId, getCDPClient } from '../spoof'
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

extendedTest.describe('Basic functionality', () => {

    extendedTest('getRandomPagePoint should be random', async ({ page }) => {
        const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')
        await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
            waitUntil: 'networkidle'
        })

        const vec = await getRandomPagePoint(page);
        expect(vec.x).toBeGreaterThan(0);
        expect(vec.y).toBeGreaterThan(0);
    })

    extendedTest('CSS: getObjectId should return a valid object id and can scroll to node', async ({ page }) => {
        const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')
        await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
            waitUntil: 'networkidle'
        })

        const cdpClient = await getCDPClient(page);
        const locator = page.locator('#box');

        const objectId = await getObjectId(page, locator, cdpClient);

        expect(objectId).toBeDefined();


        const nodeInfo = await cdpClient.send('DOM.describeNode', { objectId });

        expect(nodeInfo).toBeDefined();
        expect(nodeInfo.node).toBeDefined();
        expect(nodeInfo.node.nodeType).toBe(1);

        await cdpClient.send('DOM.scrollIntoViewIfNeeded', {
            objectId
        })
    })

    extendedTest('XPATH: getObjectId should return a valid object id and can scroll to node', async ({ page }) => {
        const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')
        await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
            waitUntil: 'networkidle'
        })

        const cdpClient = await getCDPClient(page);
        const locator = page.locator("//*[@id='box']");

        const objectId = await getObjectId(page, locator, cdpClient);

        expect(objectId).toBeDefined();
        
        const nodeInfo = await cdpClient.send('DOM.describeNode', { objectId });

        expect(nodeInfo).toBeDefined();
        expect(nodeInfo.node).toBeDefined();
        expect(nodeInfo.node.nodeType).toBe(1);

        await cdpClient.send('DOM.scrollIntoViewIfNeeded', {
            objectId
        })
    })

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
        await cursor.click("//*[@id='box']")
    })
})

extendedTest.setTimeout(1500000)
