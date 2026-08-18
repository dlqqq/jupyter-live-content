import { expect, test } from '@jupyterlab/galata';

test.use({ autoGoto: false });

const NB_NAME = 'live-nb-e2e.ipynb';

function notebook(cell2Source: string): string {
  return JSON.stringify({
    cells: [
      {
        id: 'cell-one',
        cell_type: 'code',
        source: 'print("first cell")',
        metadata: {},
        outputs: [],
        execution_count: null
      },
      {
        id: 'cell-two',
        cell_type: 'code',
        source: cell2Source,
        metadata: {},
        outputs: [],
        execution_count: null
      }
    ],
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  });
}

test('a changed cell updates in place without touching other cells', async ({
  page,
  tmpPath
}) => {
  const nbPath = `${tmpPath}/${NB_NAME}`;

  // Seed the notebook on disk (through the contents API so the watcher fires).
  await page.contents.uploadContent(notebook('x = 1'), 'text', nbPath);

  await page.goto();
  await page.notebook.openByPath(nbPath);

  const editor = page.locator('.jp-Notebook .cm-content');
  await expect(editor.nth(1)).toContainText('x = 1');

  // Out-of-band change to only the second cell.
  await page.contents.uploadContent(notebook('x = 42'), 'text', nbPath);

  // The second cell updates in place; the first cell is untouched.
  await expect(editor.nth(1)).toContainText('x = 42', { timeout: 15000 });
  await expect(editor.nth(0)).toContainText('first cell');
  expect(await page.notebook.getCellCount()).toBe(2);
});
