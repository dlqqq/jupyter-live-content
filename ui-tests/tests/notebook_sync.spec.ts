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

test('a normal save does not show an "applied changes" popup', async ({
  page,
  tmpPath
}) => {
  const nbPath = `${tmpPath}/${NB_NAME}`;

  await page.contents.uploadContent(notebook('x = 1'), 'text', nbPath);
  await page.goto();
  await page.notebook.openByPath(nbPath);

  const editor = page.locator('.jp-Notebook .cm-content');
  await expect(editor.nth(1)).toContainText('x = 1');

  // Edit a cell locally, then save through JupyterLab (a ContentsManager write).
  await page.notebook.setCell(1, 'code', 'x = 7');
  await page.notebook.save();

  // The server watcher sees this write and may echo an update back. Give it well
  // past the watch debounce, then assert no "applied changes" popup appeared:
  // a client's own save must not surface as an incoming update.
  await page.waitForTimeout(5000);
  await expect(page.getByText('Applied changes from disk')).toHaveCount(0);
});

test('out-of-band change updates a text (editor) view of the notebook', async ({
  page,
  tmpPath
}) => {
  const nbPath = `${tmpPath}/${NB_NAME}`;

  await page.contents.uploadContent(notebook('x = 1'), 'text', nbPath);
  await page.goto();

  // Open the notebook view, then the same file as a text editor split beside it.
  await page.notebook.openByPath(nbPath);
  await page.evaluate(async path => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path,
      factory: 'Editor',
      options: { mode: 'split-right' }
    });
  }, nbPath);

  // The raw JSON text view shows the current cell source.
  const textView = page.locator('.jp-FileEditor .cm-content');
  await expect(textView).toContainText('x = 1');

  // Out-of-band change on disk.
  await page.contents.uploadContent(notebook('x = 314159'), 'text', nbPath);

  // The text view must reflect the new content.
  await expect(textView).toContainText('x = 314159', { timeout: 15000 });
});

test('the revert button restores a notebook to its pre-change state', async ({
  page,
  tmpPath
}) => {
  const nbPath = `${tmpPath}/${NB_NAME}`;

  await page.contents.uploadContent(notebook('x = 1'), 'text', nbPath);
  await page.goto();
  await page.notebook.openByPath(nbPath);

  const editor = page.locator('.jp-Notebook .cm-content');
  await expect(editor.nth(1)).toContainText('x = 1');

  // Out-of-band change is applied in place and a "Revert" action is offered.
  await page.contents.uploadContent(notebook('x = 424242'), 'text', nbPath);
  await expect(editor.nth(1)).toContainText('x = 424242', { timeout: 15000 });

  await page.getByRole('button', { name: 'Revert' }).click();

  // The notebook returns to the state it had before the out-of-band change.
  await expect(editor.nth(1)).toContainText('x = 1', { timeout: 15000 });
  await expect(editor.nth(1)).not.toContainText('x = 424242');
});
