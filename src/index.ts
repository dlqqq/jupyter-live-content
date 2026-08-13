import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { requestAPI } from './request';

/**
 * Initialization data for the @jupyter-ai-contrib/live-content extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyter-ai-contrib/live-content:plugin',
  description: 'A minimal JupyterLab extension that provides live content updates from the filesystem.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension @jupyter-ai-contrib/live-content is activated!');

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_live_content server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
