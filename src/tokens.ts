import { IDocumentWidget } from '@jupyterlab/docregistry';
import { Token } from '@lumino/coreutils';
import { ISignal } from '@lumino/signaling';

/**
 * The WebSocket message protocol, mirrored from the Python dataclasses in
 * `jupyterlab_live_content/ws_schema.py`.
 *
 * client -> server: `client_opened`, `client_closed`, `get_manifest`, `fetch_cells`
 * server -> client: `server_update`, `nb_manifest`, `nb_update`
 */
export interface ICellInfo {
  id: string;
  cell_type: string;
  source_hash: string;
  meta_hash: string;
}

export interface ICellUpdateInfo extends ICellInfo {
  source: string;
  metadata: Record<string, any>;
  attachments: Record<string, any>;
}

export interface INbManifest {
  type: 'nb_manifest';
  path: string;
  cell_order: string[];
  cells_by_id: Record<string, ICellInfo>;
  nb_meta_hash: string;
  last_modified: string | null;
  hash: string | null;
  hash_algorithm: string | null;
}

export interface INbUpdate {
  type: 'nb_update';
  path: string;
  cell_order: string[];
  cells_by_id: Record<string, ICellUpdateInfo>;
  nb_meta_hash: string;
  nb_metadata: Record<string, any>;
  last_modified: string | null;
  hash: string | null;
  hash_algorithm: string | null;
}

export type LiveContentMessage =
  | { type: 'client_opened'; path: string }
  | { type: 'client_closed'; path: string }
  | { type: 'get_manifest'; path: string }
  | { type: 'fetch_cells'; path: string; ids: string[] }
  | { type: 'server_update'; path: string }
  | INbManifest
  | INbUpdate;

/**
 * The transport plugin. Owns the single WebSocket connection to the
 * `jupyterlab-live-content/ws` endpoint and exposes typed send/receive.
 */
export interface ILiveContentConnector {
  /** Emitted for every message received from the server. */
  readonly messageReceived: ISignal<ILiveContentConnector, LiveContentMessage>;

  /** Resolves once the WebSocket has opened for the first time. */
  readonly ready: Promise<void>;

  /** Send a message to the server (queued until the socket is open). */
  sendMessage(message: LiveContentMessage): void;
}

export const ILiveContentConnector = new Token<ILiveContentConnector>(
  '@jupyter-ai-contrib/live-content:ILiveContentConnector',
  'Provides the live-content WebSocket channel to the server.'
);

/**
 * A registry of the document widgets currently open in this client, indexed by
 * their (server-relative) path. Maintained by the tracker plugin.
 */
export interface ILiveDocumentRegistry {
  /** Look up the open document widget for a path, if any. */
  get(path: string): IDocumentWidget | undefined;

  /** All currently open document widgets, indexed by path. */
  readonly widgets: ReadonlyMap<string, IDocumentWidget>;

  /** Emitted with the path when a document is added to the registry. */
  readonly opened: ISignal<ILiveDocumentRegistry, string>;

  /** Emitted with the path when a document is removed from the registry. */
  readonly closed: ISignal<ILiveDocumentRegistry, string>;
}

export const ILiveDocumentRegistry = new Token<ILiveDocumentRegistry>(
  '@jupyter-ai-contrib/live-content:ILiveDocumentRegistry',
  'Tracks open document widgets indexed by path.'
);
