/**
 * Tab Pool Manager - Manages pre-warmed browser tabs for instant call bridging
 * 
 * Each tab is pre-loaded with index.html and has AudioContexts ready.
 * When a webhook arrives, we inject the call ID into an available tab.
 */

export class TabPoolManager {
  constructor(browser, poolSize = 20) {
    this.browser = browser;
    this.poolSize = poolSize;
    this.tabs = new Map(); // tabId -> { page, busy, callId }
    this.nextTabId = 0;
  }

  /**
   * Initialize the pool with pre-warmed tabs
   */
  async initialize() {
    console.log(`[TabPool] Initializing pool with ${this.poolSize} tabs...`);
    
    for (let i = 0; i < this.poolSize; i++) {
      await this.createTab();
    }
    
    console.log(`[TabPool] ✅ Pool ready with ${this.tabs.size} tabs`);
  }

  /**
   * Create a new tab and pre-warm it
   */
  async createTab() {
    const tabId = this.nextTabId++;
    const page = await this.browser.newPage();
    
    // Enable console logging from page
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[SUCCESS]') || text.includes('[ERROR]') || text.includes('User said:')) {
        console.log(`[Tab-${tabId}]`, text);
      }
    });
    
    // Detect when call ends
    page.on('framenavigated', async () => {
      const tab = this.tabs.get(tabId);
      if (tab && tab.busy) {
        console.log(`[TabPool] Tab ${tabId} navigated - call may have ended`);
      }
    });
    
    // Load the bridge page with auto-start flag
    await page.goto('http://localhost:3000/index.html?headless=true', {
      waitUntil: 'networkidle2',
      timeout: 10000
    });
    
    // Wait for page to be ready
    await page.waitForFunction(() => window.bridgeReady === true, { timeout: 5000 }).catch(() => {
      console.warn(`[TabPool] Tab ${tabId} may not be fully ready`);
    });
    
    this.tabs.set(tabId, {
      page,
      busy: false,
      callId: null,
      createdAt: Date.now()
    });
    
    console.log(`[TabPool] Tab ${tabId} created and warmed`);
    return tabId;
  }

  /**
   * Get an available tab from the pool
   */
  async getAvailableTab() {
    // Find first available tab
    for (const [tabId, tab] of this.tabs.entries()) {
      if (!tab.busy) {
        tab.busy = true;
        console.log(`[TabPool] Allocated tab ${tabId}`);
        return { tabId, page: tab.page };
      }
    }
    
    // No available tabs - create a new one (emergency scaling)
    console.warn(`[TabPool] Pool exhausted! Creating emergency tab...`);
    const tabId = await this.createTab();
    const tab = this.tabs.get(tabId);
    tab.busy = true;
    return { tabId, page: tab.page };
  }

  /**
   * Start a bridge session on a tab
   */
  async startBridge(tabId, callId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    
    tab.callId = callId;
    console.log(`[TabPool] Starting bridge on tab ${tabId} for call ${callId}`);
    
    try {
      // Inject call ID and start bridge
      await tab.page.evaluate((cId) => {
        window.startBridgeWithCallId(cId);
      }, callId);
      
      return true;
    } catch (error) {
      console.error(`[TabPool] Failed to start bridge on tab ${tabId}:`, error.message);
      this.releaseTab(tabId);
      return false;
    }
  }

  /**
   * Release a tab back to the pool
   */
  async releaseTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    console.log(`[TabPool] Releasing tab ${tabId}`);
    
    try {
      // Reload page to clean state
      await tab.page.reload({ waitUntil: 'networkidle2', timeout: 5000 });
      
      tab.busy = false;
      tab.callId = null;
      
      console.log(`[TabPool] Tab ${tabId} released and ready`);
    } catch (error) {
      console.error(`[TabPool] Failed to release tab ${tabId}, recreating...`);
      // Close broken tab and create new one
      await tab.page.close().catch(() => {});
      this.tabs.delete(tabId);
      await this.createTab();
    }
  }

  /**
   * Monitor and restart crashed tabs
   */
  startHealthMonitor() {
    setInterval(async () => {
      for (const [tabId, tab] of this.tabs.entries()) {
        try {
          // Check if page is still alive
          await tab.page.evaluate(() => true);
        } catch (error) {
          console.error(`[TabPool] Tab ${tabId} crashed! Recreating...`);
          this.tabs.delete(tabId);
          await this.createTab();
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const available = Array.from(this.tabs.values()).filter(t => !t.busy).length;
    const busy = this.tabs.size - available;
    
    return {
      total: this.tabs.size,
      available,
      busy,
      calls: Array.from(this.tabs.values())
        .filter(t => t.busy)
        .map(t => t.callId)
    };
  }

  /**
   * Cleanup - close all tabs
   */
  async cleanup() {
    console.log('[TabPool] Cleaning up all tabs...');
    for (const [tabId, tab] of this.tabs.entries()) {
      await tab.page.close().catch(() => {});
    }
    this.tabs.clear();
  }
}

