// import { ElementHandle, Page, BoundingBox, CDPSession } from 'puppeteer'
import { ElementHandle, Page, Browser, Locator, CDPSession } from 'playwright'
import { rando } from '@nastyox/rando.js';
import fs from 'fs'

import debug from 'debug'
import {
    Vector,
    bezierCurve,
    direction,
    magnitude,
    origin,
    overshoot
} from './math'

interface Point {
    x: number
    y: number
}
interface BoundingBox extends Point {
    width: number
    height: number
}
export { default as installMouseHelper } from './mouse-helper'

const log = debug('ghost-cursor')

export interface BoxOptions {
    readonly paddingPercentage?: number
}

export interface MoveOptions extends BoxOptions {
    readonly waitForSelector?: number
    readonly moveDelay?: number
    readonly maxTries?: number
    readonly moveSpeed?: number
}

export interface ClickOptions extends MoveOptions {
    readonly waitForClick?: number
}

export interface PathOptions {
    readonly spreadOverride?: number
    readonly moveSpeed?: number
}

export interface GhostCursor {
    toggleRandomMove: (random: boolean) => void
    click: (
        selector?: string | Locator,
        options?: ClickOptions
    ) => Promise<void>
    move: (
        selector: string | Locator,
        options?: MoveOptions
    ) => Promise<void>
    moveTo: (destination: Vector) => Promise<void>
}

// Helper function to wait a specified number of milliseconds
const delay = async (ms: number): Promise<void> =>
    await new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Calculate the amount of time needed to move from (x1, y1) to (x2, y2)
 * given the width of the element being clicked on
 * https://en.wikipedia.org/wiki/Fitts%27s_law
 */
const fitts = (distance: number, width: number): number => {
    const a = 0
    const b = 2
    const id = Math.log2(distance / width + 1)
    return a + b * id
}

// Get a random point on a box
const getRandomBoxPoint = (
    { x, y, width, height }: BoundingBox,
    options?: BoxOptions
): Vector => {
    let paddingWidth = 0
    let paddingHeight = 0

    if (
        options?.paddingPercentage !== undefined &&
        options?.paddingPercentage > 0 &&
        options?.paddingPercentage < 100
    ) {
        paddingWidth = (width * options.paddingPercentage) / 100
        paddingHeight = (height * options.paddingPercentage) / 100
    }

    return {
        x: x + paddingWidth / 2 + rando() * (width - paddingWidth),
        y: y + paddingHeight / 2 + rando() * (height - paddingHeight)
    }
}

// The function signature to access the internal CDP client changed in puppeteer 14.4.1

export const getCDPClient = async (page: Page): Promise<CDPSession> => {
    return await page.context().newCDPSession(page);
}

// Get a random point on a browser window
export const getRandomPagePoint = async (page: Page): Promise<Vector> => {
    const viewportSize = page.viewportSize()
    const width = viewportSize?.width ?? 0
    const height = viewportSize?.height ?? 0
    return getRandomBoxPoint({
        x: origin.x,
        y: origin.y,
        width,
        height
    })
}

// Using this method to get correct position of Inline elements (elements like <a>)
const getElementBox = async (
    locator: Locator,
): Promise<BoundingBox | null> => {
    const box = await locator.boundingBox()
    return (box != null) ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}

export function path(point: Vector, target: Vector, optionsOrSpread?: number | PathOptions): Vector[]
export function path(point: Vector, target: BoundingBox, optionsOrSpread?: number | PathOptions): Vector[]
export function path(start: Vector, end: BoundingBox | Vector, optionsOrSpread?: number | PathOptions): Vector[] {
    const spreadOverride = typeof optionsOrSpread === 'number' ? optionsOrSpread : optionsOrSpread?.spreadOverride
    const moveSpeed = typeof optionsOrSpread === 'object' && optionsOrSpread.moveSpeed

    const defaultWidth = 100
    const minSteps = 25
    const width = 'width' in end && end.width !== 0 ? end.width : defaultWidth
    const curve = bezierCurve(start, end, spreadOverride)
    const length = curve.length() * 0.8

    const speed = typeof moveSpeed === 'number' ? (25 / moveSpeed) : rando()
    const baseTime = speed * minSteps
    const steps = Math.ceil((Math.log2(fitts(length, width) + 1) + baseTime) * 3)
    const re = curve.getLUT(steps)
    return clampPositive(re)
}

const clampPositive = (vectors: Vector[]): Vector[] => {
    const clamp0 = (elem: number): number => Math.max(0, elem)
    return vectors.map((vector) => {
        return {
            x: clamp0(vector.x),
            y: clamp0(vector.y)
        }
    })
}

const overshootThreshold = 500
const shouldOvershoot = (a: Vector, b: Vector): boolean =>
    magnitude(direction(a, b)) > overshootThreshold

const intersectsElement = (vec: Vector, box: BoundingBox): boolean => {
    return (
        vec.x > box.x &&
        vec.x <= box.x + box.width &&
        vec.y > box.y &&
        vec.y <= box.y + box.height
    )
}

const boundingBoxWithFallback = async (
    locator: Locator
): Promise<BoundingBox> => {
    let box = await getElementBox(locator)
    if (box == null) {
        const handle = await locator.elementHandle();
        box = await handle?.evaluate((el: Element) => {
            const rect = el.getBoundingClientRect()
            const box = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
            return box
        }, locator)!
        handle?.dispose()
    }
    return box
}


export const getObjectId = async (
    page: Page,
    locator: Locator,
    cdpClient: CDPSession
): Promise<string | undefined> => {
   
    const selector = locator['_selector'];

    let expression: string;

    if (selector.startsWith("//")) {
        expression = `document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
    } else {
        expression = `document.querySelector(${JSON.stringify(selector)})`;
    }
    // Get the objectid with the cdpClient
    const { result: remoteObject } = await cdpClient.send('Runtime.evaluate', {
        expression: expression,
        returnByValue: false
    });
    return remoteObject?.objectId;
}


export const createCursor = (
    browser: Browser,
    page: Page,
    start: Vector = origin,
    performRandomMoves: boolean = false
): GhostCursor => {
    // this is kind of arbitrary, not a big fan but it seems to work
    const overshootSpread = 10
    const overshootRadius = 120
    let previous: Vector = start

    // Initial state: mouse is not moving
    let moving: boolean = false

    // Move the mouse over a number of vectors
    const tracePath = async (
        vectors: Iterable<Vector>,
        abortOnMove: boolean = false
    ): Promise<void> => {
        for (const v of vectors) {
            try {
                // In case this is called from random mouse movements and the users wants to move the mouse, abort
                if (abortOnMove && moving) {
                    return
                }
                await page.mouse.move(v.x, v.y)
                previous = v
            } catch (error) {
                // Exit function if the browser is no longer connected
                if (!browser.isConnected()) return

                log('Warning: could not move mouse, error message:', error)
            }
        }
    }
    // Start random mouse movements. Function recursively calls itself
    const randomMove = async (options?: MoveOptions): Promise<void> => {
        try {
            if (!moving) {
                const rand = await getRandomPagePoint(page)
                await tracePath(path(previous, rand, {
                    moveSpeed: options?.moveSpeed
                }), true)
                previous = rand
            }
            if (options?.moveDelay !== undefined && options.moveDelay >= 0) {
                await delay(rando() * options.moveDelay)
            } else {
                await delay(rando() * 2000) // 2s by default
            }
            randomMove().then(
                (_) => { },
                (_) => { }
            ) // fire and forget, recursive function
        } catch (_) {
            log('Warning: stopping random mouse movements')
        }
    }

    const actions: GhostCursor = {
        toggleRandomMove(random: boolean): void {
            moving = !random
        },

        async click(
            selector?: string | Locator,
            options?: ClickOptions
        ): Promise<void> {
            actions.toggleRandomMove(false)

            if (selector !== undefined) {
                await actions.move(selector, options)
                actions.toggleRandomMove(false)
            }

            try {
                await page.mouse.down()
                if (options?.waitForClick !== undefined) {
                    await delay(options.waitForClick)
                }
                await page.mouse.up()
            } catch (error) {
                log('Warning: could not click mouse, error message:', error)
            }

            if (options?.moveDelay !== undefined && options.moveDelay >= 0) {
                await delay(rando() * options.moveDelay)
            } else {
                await delay(rando() * 2000) // 2s by default
            }

            actions.toggleRandomMove(true)
        },

        async move(
            selector: string | Locator,
            options?: MoveOptions
        ): Promise<void> {
            const go = async (iteration: number): Promise<void> => {
                if (iteration > (options?.maxTries ?? 10)) {
                    throw Error('Could not mouse-over element within enough tries')
                }
                actions.toggleRandomMove(false)

                let locator: Locator;
                if (typeof selector === 'string') {
                    if (options?.waitForSelector !== undefined) {
                        await page.waitForSelector(selector, {
                            timeout: options.waitForSelector
                        });
                    }
                    locator = page.locator(selector); 
                } else {
                    locator = (selector as Locator); 
                }

                const cdpClient = await getCDPClient(page);
                const objectId = await getObjectId(page, locator, cdpClient);

                if (objectId) {
                    try {
                        await cdpClient.send('DOM.scrollIntoViewIfNeeded', {
                            objectId
                        });
                    } catch (e) {
                        // use regular JS scroll method as a fallback
                        console.log('Falling back to JS scroll method', e);
                        await locator.evaluate((e: Element) => e.scrollIntoView({ block: 'center' }));
                        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait a bit until the scroll has finished
                    }
                }

                const box = await boundingBoxWithFallback(locator)
                const { height, width } = box
                const destination = getRandomBoxPoint(box, options)
                const dimensions = { height, width }
                const overshooting = shouldOvershoot(previous, destination)
                const to = overshooting
                    ? overshoot(destination, overshootRadius)
                    : destination

                await tracePath(path(previous, to, {
                    moveSpeed: options?.moveSpeed
                }))

                if (overshooting) {
                    const correction = path(to, { ...dimensions, ...destination }, {
                        spreadOverride: overshootSpread,
                        moveSpeed: options?.moveSpeed
                    })

                    await tracePath(correction)
                }

                previous = destination

                actions.toggleRandomMove(true)

                const newBoundingBox = await boundingBoxWithFallback(locator)

                // It's possible that the element that is being moved towards
                // has moved to a different location by the time
                // the the time the mouseover animation finishes
                if (!intersectsElement(to, newBoundingBox)) {
                    return await go(iteration + 1)
                }
            }
            return await go(0)
        },
        async moveTo(destination: Vector): Promise<void> {
            actions.toggleRandomMove(false)
            await tracePath(path(previous, destination))
            actions.toggleRandomMove(true)
        }
    }

    // Start random mouse movements. Do not await the promise but return immediately
    if (performRandomMoves) {
        randomMove().then(
            (_) => { },
            (_) => { }
        )
    }

    return actions
}
