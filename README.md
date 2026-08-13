# jupyterlab_live_content

[![Github Actions Status](https://github.com/jupyter-ai-contrib/jupyterlab-live-content/workflows/Build/badge.svg)](https://github.com/jupyter-ai-contrib/jupyterlab-live-content/actions/workflows/build.yml)

A minimal JupyterLab extension that provides live content updates from the filesystem.

This extension is composed of a Python package named `jupyterlab_live_content`
for the server extension and a NPM package named `@jupyter-ai-contrib/live-content`
for the frontend extension.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab_live_content
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_live_content
```

## Troubleshoot

If you are seeing the frontend extension, but it is not working, check
that the server extension is enabled:

```bash
jupyter server extension list
```

If the server extension is installed and enabled, but you are not seeing
the frontend extension, check the frontend extension is installed:

```bash
jupyter labextension list
```

## Contributing

If you would like to contribute to this extension, please refer to the [Contributing Guide](CONTRIBUTING.md).
