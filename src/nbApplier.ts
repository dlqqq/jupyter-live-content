import { IDocumentWidget } from '@jupyterlab/docregistry';
import { Notification } from '@jupyterlab/apputils';
import type { ISharedCell, ISharedNotebook } from '@jupyter/ydoc';

import { planReconcile, IReconcileInput } from './reconcile';
import { ICellHashes } from './reconcile';
import { clientHasRevision } from './revision';
import { INbManifest, INbUpdate } from './tokens';

/**
 * Drives incremental sync for a single open notebook.
 *
 * It records the server's per-cell hashes as `base`, tracks which cells the user
 * has locally edited since the last sync (the dirty set), and on each server
 * `nb_update` decides via {@link planReconcile} whether the update is
 * reconcilable. If so it applies the cell operations to the shared `YNotebook`
 * inside one transaction, advances the context's recorded revision so the native
 * save-conflict dialog stays quiet, and offers a revert-to-checkpoint action. If
 * not, it leaves the document untouched for the native dialog to resolve.
 */
export class NotebookLiveSync {
  constructor(widget: IDocumentWidget) {
    this._widget = widget;
    this._model = (widget.context.model as any).sharedModel as ISharedNotebook;
    this._wireCellObservers();
    this._model.changed.connect(this._onModelChanged, this);
    // Clear the dirty set once the user saves (model becomes clean).
    widget.context.model.stateChanged.connect(this._onStateChanged, this);
  }

  dispose(): void {
    this._model.changed.disconnect(this._onModelChanged, this);
    this._widget.context.model.stateChanged.disconnect(
      this._onStateChanged,
      this
    );
  }

  /** Establish the baseline hashes from a full manifest. */
  onManifest(msg: INbManifest): void {
    this._base = {};
    for (const [id, info] of Object.entries(msg.cells_by_id)) {
      this._base[id] = {
        source_hash: info.source_hash,
        meta_hash: info.meta_hash
      };
    }
    this._nbMetaHash = msg.nb_meta_hash;
    this._dirty.clear();
  }

  /** Handle an incremental update from the server. */
  async onUpdate(msg: INbUpdate): Promise<void> {
    // A client's own save echoes back as a change event. If we already hold this
    // revision (matching hash), the update is a no-op: skip it entirely so no
    // reload happens and no "applied changes" notification appears.
    if (clientHasRevision(this._widget.context, msg)) {
      return;
    }

    const changed: Record<string, ICellHashes> = {};
    for (const [id, info] of Object.entries(msg.cells_by_id)) {
      changed[id] = {
        source_hash: info.source_hash,
        meta_hash: info.meta_hash
      };
    }

    const input: IReconcileInput = {
      currentIds: this._currentIds(),
      targetOrder: msg.cell_order,
      changed,
      base: this._base,
      nbMetaChanged: msg.nb_meta_hash !== this._nbMetaHash,
      nbMetaDirty: false, // TODO: track notebook-metadata dirtiness
      isDirty: id => this._dirty.has(id),
      isBusy: () => false // TODO: detect executing / awaiting-input cells
    };

    const plan = planReconcile(input);
    if (plan === null) {
      // Not reconcilable: leave the document alone; Cmd+S resolves it natively.
      return;
    }

    // Checkpoint first so the user can roll back to the pre-update state.
    try {
      await this._widget.context.createCheckpoint();
    } catch {
      /* read-only or unsupported: proceed without a rollback point */
    }

    this._applying = true;
    try {
      this._model.transact(() => {
        // 1. Deletions.
        for (const id of plan.deletes) {
          const idx = this._indexOfId(id);
          if (idx >= 0) {
            this._model.deleteCell(idx);
          }
        }
        // 2. Reorder + insert to match the target order exactly, recomputing the
        //    live index of each cell so shifting indices cannot corrupt it.
        plan.targetOrder.forEach((id, target) => {
          const curIdx = this._indexOfId(id);
          if (curIdx === -1) {
            this._model.insertCell(target, this._cellPayload(msg, id));
          } else if (curIdx !== target) {
            this._model.moveCell(curIdx, target);
          }
        });
        // 3. Content updates on surviving cells.
        for (const id of plan.sourceUpdates) {
          const cell = this._cellById(id);
          if (cell) {
            cell.setSource(msg.cells_by_id[id].source);
          }
        }
        for (const id of plan.metaUpdates) {
          const cell = this._cellById(id);
          if (cell) {
            cell.setMetadata(msg.cells_by_id[id].metadata as any);
          }
        }
        // 4. Notebook-level metadata.
        if (plan.applyNbMetadata) {
          this._model.setMetadata(msg.nb_metadata as any);
        }
      });
    } finally {
      this._applying = false;
    }

    // Fold the applied cells into the baseline.
    for (const [id, info] of Object.entries(msg.cells_by_id)) {
      this._base[id] = {
        source_hash: info.source_hash,
        meta_hash: info.meta_hash
      };
    }
    for (const id of plan.deletes) {
      delete this._base[id];
    }
    this._nbMetaHash = msg.nb_meta_hash;

    this._advanceRecordedRevision(msg);
    this._notifyApplied();
  }

  /**
   * Advance the context's recorded on-disk revision so `Context._maybeSave` does
   * not flag a spurious conflict on the user's next save.
   *
   * There is no public API for this yet, so we set the private `_contentsModel`.
   * The proper fix is a small upstream `Context.overrideFileModel(model)`.
   */
  private _advanceRecordedRevision(msg: INbUpdate): void {
    try {
      const cm = (this._widget.context as any)._contentsModel;
      if (cm) {
        if (msg.last_modified) {
          cm.last_modified = msg.last_modified;
        }
        if (msg.hash) {
          cm.hash = msg.hash;
          cm.hash_algorithm = msg.hash_algorithm;
        }
      }
    } catch {
      /* best-effort until the upstream API exists */
    }
  }

  private _notifyApplied(): void {
    Notification.info('Applied changes from disk', {
      autoClose: 4000,
      actions: [
        {
          label: 'Revert',
          callback: () => {
            void this._revertToCheckpoint();
          }
        }
      ]
    });
  }

  private async _revertToCheckpoint(): Promise<void> {
    const ctx = this._widget.context;
    const checkpoints = await ctx.listCheckpoints();
    if (checkpoints.length) {
      await ctx.restoreCheckpoint(checkpoints[checkpoints.length - 1].id);
      await ctx.revert();
    }
  }

  private _cellPayload(msg: INbUpdate, id: string): any {
    const info = msg.cells_by_id[id];
    return {
      id,
      cell_type: info.cell_type,
      source: info.source,
      metadata: info.metadata,
      attachments: info.attachments
    };
  }

  private _currentIds(): string[] {
    return this._model.cells.map(c => c.getId());
  }

  private _indexOfId(id: string): number {
    return this._model.cells.findIndex(c => c.getId() === id);
  }

  private _cellById(id: string): ISharedCell | undefined {
    return this._model.cells.find(c => c.getId() === id);
  }

  private _wireCellObservers(): void {
    for (const cell of this._model.cells) {
      if (this._wired.has(cell)) {
        continue;
      }
      this._wired.add(cell);
      cell.changed.connect(this._onCellChanged, this);
    }
  }

  private _onCellChanged(cell: ISharedCell): void {
    if (this._applying) {
      return;
    }
    this._dirty.add(cell.getId());
  }

  private _onModelChanged(): void {
    // Re-wire observers for any newly created cells.
    this._wireCellObservers();
  }

  private _onStateChanged(
    _: unknown,
    change: { name: string; newValue: any }
  ): void {
    if (change.name === 'dirty' && change.newValue === false) {
      // A save (or revert) reconciled us with disk; clear local dirtiness.
      this._dirty.clear();
    }
  }

  private _widget: IDocumentWidget;
  private _model: ISharedNotebook;
  private _base: Record<string, ICellHashes> = {};
  private _nbMetaHash: string | null = null;
  private _dirty = new Set<string>();
  private _wired = new WeakSet<ISharedCell>();
  private _applying = false;
}
