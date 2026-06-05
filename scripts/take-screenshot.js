const { chromium } = require('playwright');

(async () => {
  // Check if dev server is running
  try {
    const res = await fetch('http://localhost:3000', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('Server not ready');
  } catch {
    console.error('❌ Development server is not running on http://localhost:3000');
    console.error('   Please run "npm run dev" in another terminal first.');
    process.exit(1);
  }

  // Launch Playwright's built-in Chromium (not Lightpanda — it has no graphics engine)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Set viewport to OBS widget size
  await page.setViewportSize({ width: 400, height: 600 });

  // Navigate to widget page
  await page.goto('http://localhost:3000/widget/test-channel?mode=short', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for the page to render (including WebSocket attempts)
  await page.waitForTimeout(3000);

  // Inject demo chat messages into the widget
  await page.evaluate(() => {
    const container = document.querySelector('.flex-col.justify-end');
    if (!container) return;

    // Clear connection status messages
    container.innerHTML = '';

    const messages = [
      {
        text: '안녕하세요! 반갑습니다',
        badge: '4B SS II',
        color: 'linear-gradient(135deg, #ff856f, #ff9a87)',
        theory: false,
        unlinked: false,
      },
      {
        text: '오늘도 방송 잘 보고 있어요',
        badge: '8B HC I',
        color: 'linear-gradient(135deg, #feff63, #feff85)',
        theory: false,
        unlinked: false,
      },
      {
        text: '이론치 달성 축하드려요!',
        badge: '6B LoD',
        color: 'linear-gradient(to right, #f2b2f7, #acebff)',
        theory: true,
        unlinked: false,
      },
      {
        text: '채팅 테스트 중입니다',
        badge: '5B BM I',
        color: 'linear-gradient(135deg, #ff7183, #ff8a9a)',
        theory: false,
        unlinked: false,
      },
      {
        text: '연동하면 뱃지가 보여요',
        badge: null,
        color: null,
        theory: false,
        unlinked: true,
      },
      {
        text: 'DJMAX RESPECT V 화이팅',
        badge: '4B PRO II',
        color: 'linear-gradient(135deg, #ffd352, #ffdd70)',
        theory: false,
        unlinked: false,
      },
      {
        text: '스코어 언제 갱신되나요?',
        badge: '5B TS III',
        color: 'linear-gradient(135deg, #ffaf51, #ffbf70)',
        theory: false,
        unlinked: false,
      },
    ];

    messages.forEach((msg, i) => {
      const div = document.createElement('div');
      div.className = `text-sm break-words ${msg.unlinked ? 'opacity-75' : 'opacity-100'}`;
      div.id = `msg-${i}`;

      let html = '';

      if (msg.badge) {
        html += `<span class="inline-block px-1 py-0.5 rounded text-xs font-bold mr-1 shadow-sm" style="background: ${msg.color}; color: #000; text-shadow: 0 0 1px rgba(255,255,255,0.5);">${msg.badge}</span>`;
      }

      if (msg.theory) {
        html += `<span class="inline-block px-1 py-0.5 rounded text-xs font-bold mr-1 shadow-sm theory-badge" style="background: linear-gradient(90deg, #ff0000, #ff6600, #ffcc00, #ff6600, #ff0000); background-size: 300% 300%; animation: glitter 2s ease infinite; color: #fff; text-shadow: 0 0 2px rgba(0,0,0,0.8);">이론치</span>`;
      }

      html += `<span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">${msg.text}</span>`;

      div.innerHTML = html;
      container.appendChild(div);
    });

    // Add the scroll anchor
    const anchor = document.createElement('div');
    container.appendChild(anchor);
  });

  // Wait for animations and styles to apply
  await page.waitForTimeout(1000);

  // Take screenshot
  await page.screenshot({
    path: 'docs/screenshot.png',
    fullPage: false,
  });

  console.log('✅ Screenshot saved to docs/screenshot.png');

  await browser.close();
})();
