import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

test.use({ autoGoto: false });

/**
 * Read the directories the server is currently watching (relative to the server
 * root), via the E2E-only test endpoint registered in
 * `ui-tests/_live_content_test_ext.py`.
 */
function watchedDirs(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const el = document.getElementById('jupyter-config-data');
    const baseUrl =
      (el && el.textContent && JSON.parse(el.textContent).baseUrl) || '/';
    const res = await fetch(baseUrl + 'api/live-content/_test/watched');
    const body = await res.json();
    return (body.watched ?? []) as string[];
  });
}

/** Close the open document at `path` (fires client_closed to the server). */
function closeDocument(page: Page, path: string): Promise<void> {
  return page.evaluate((p: string) => {
    const app = (window as any).jupyterapp;
    for (const widget of app.shell.widgets('main')) {
      const context = (widget as any).context;
      if (context && context.path === p) {
        (widget as any).close();
        return;
      }
    }
  }, path);
}

test('the watch set follows the documents open in nested directories', async ({
  page,
  tmpPath
}) => {
  const l1 = `${tmpPath}/level1`;
  const l2 = `${l1}/level2`;
  const l3 = `${l2}/level3`;
  await page.contents.createDirectory(l1);
  await page.contents.createDirectory(l2);
  await page.contents.createDirectory(l3);

  const f1 = `${l1}/untitled.txt`;
  const f2 = `${l2}/untitled.txt`;
  const f3 = `${l3}/untitled.txt`;
  for (const f of [f1, f2, f3]) {
    await page.contents.uploadContent('content', 'text', f);
  }

  await page.goto();

  // Nothing open yet -> nothing watched.
  await expect.poll(() => watchedDirs(page)).toEqual([]);

  // Opening each nested document adds its directory to the watch set.
  await page.filebrowser.open(f1);
  await expect.poll(() => watchedDirs(page)).toEqual([l1]);

  await page.filebrowser.open(f2);
  await expect.poll(() => watchedDirs(page)).toEqual([l1, l2]);

  await page.filebrowser.open(f3);
  await expect.poll(() => watchedDirs(page)).toEqual([l1, l2, l3]);

  // Closing each document removes its directory again (deepest first).
  await closeDocument(page, f3);
  await expect.poll(() => watchedDirs(page)).toEqual([l1, l2]);

  await closeDocument(page, f2);
  await expect.poll(() => watchedDirs(page)).toEqual([l1]);

  await closeDocument(page, f1);
  await expect.poll(() => watchedDirs(page)).toEqual([]);
});
