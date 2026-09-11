import type { IconName } from "$lib/icons";

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptDialogOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  maxLength?: number;
  inputType?: string;
  selectOnOpen?: boolean;
}

export interface ChoiceDialogOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  intent?: "primary" | "neutral" | "danger";
}

export interface ChoiceDialogDetail {
  label: string;
  meta?: string;
  badge?: string;
  kind?: "file" | "directory";
}

export interface ChoiceDialogOptions<T extends string = string> {
  title?: string;
  message: string;
  choices: ChoiceDialogOption<T>[];
  details?: ChoiceDialogDetail[];
  detailLabel?: string;
  applyToAllLabel?: string;
  cancelLabel?: string;
}

export interface ChoiceDialogResult<T extends string = string> {
  value: T;
  applyToAll: boolean;
}

/** One way a conflicting local file can be handled. */
export interface ConflictStrategyOption<T extends string = string> {
  value: T;
  /** Per-file label, e.g. "Keep an old copy". */
  label: string;
  /** Bulk-button label, e.g. "Apply to all". */
  allLabel: string;
  icon?: IconName;
  intent?: "primary" | "neutral" | "danger";
}

/** A local file the run would replace. */
export interface ConflictDialogItem {
  /** Server document id — the key the answer is returned under. */
  id: string;
  /** Download-root-relative path, which is what the user recognises. */
  label: string;
  meta?: string;
}

export interface ConflictDialogOptions<T extends string = string> {
  title?: string;
  message: string;
  items: ConflictDialogItem[];
  strategies: ConflictStrategyOption<T>[];
  /** Pre-selected answer for every row. */
  defaultStrategy: T;
  /** Hint shown above the file list, e.g. "3 files". */
  listLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConflictDialogResult<T extends string = string> {
  /** One answer per item id. */
  strategies: Map<string, T>;
}

type DialogKind = "confirm" | "prompt" | "choice" | "conflicts";

export type DialogResolution =
  | boolean
  | string
  | ChoiceDialogResult
  | ConflictDialogResult
  | null;

export interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  multiline: boolean;
  maxLength?: number;
  inputType: string;
  selectOnOpen: boolean;
  choices: ChoiceDialogOption[];
  details: ChoiceDialogDetail[];
  detailLabel: string;
  applyToAllLabel: string;
  conflictItems: ConflictDialogItem[];
  conflictStrategies: ConflictStrategyOption[];
  conflictDefaultStrategy: string;
  conflictListLabel: string;
  resolve: (value: DialogResolution) => void;
}

class DialogStoreImpl {
  current = $state<DialogRequest | null>(null);
  private queue: DialogRequest[] = [];
  private nextId = 1;

  confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
    const normalized: ConfirmDialogOptions =
      typeof options === "string" ? { message: options } : options;

    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "confirm",
        title: normalized.title ?? "Confirm",
        message: normalized.message,
        defaultValue: "",
        placeholder: "",
        confirmLabel: normalized.confirmLabel ?? "OK",
        cancelLabel: normalized.cancelLabel ?? "Cancel",
        danger: normalized.danger ?? false,
        multiline: false,
        maxLength: undefined,
        inputType: "text",
        selectOnOpen: false,
        choices: [],
        details: [],
        detailLabel: "",
        applyToAllLabel: "",
        conflictItems: [],
        conflictStrategies: [],
        conflictDefaultStrategy: "",
        conflictListLabel: "",
        resolve: (value) => resolve(value === true),
      });
    });
  }

  prompt(options: PromptDialogOptions | string, defaultValue = ""): Promise<string | null> {
    const normalized: PromptDialogOptions =
      typeof options === "string" ? { message: options, defaultValue } : options;

    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "prompt",
        title: normalized.title ?? "Input",
        message: normalized.message,
        defaultValue: normalized.defaultValue ?? defaultValue,
        placeholder: normalized.placeholder ?? "",
        confirmLabel: normalized.confirmLabel ?? "OK",
        cancelLabel: normalized.cancelLabel ?? "Cancel",
        danger: false,
        multiline: normalized.multiline ?? false,
        maxLength: normalized.maxLength,
        inputType: normalized.inputType ?? "text",
        selectOnOpen: normalized.selectOnOpen ?? false,
        choices: [],
        details: [],
        detailLabel: "",
        applyToAllLabel: "",
        conflictItems: [],
        conflictStrategies: [],
        conflictDefaultStrategy: "",
        conflictListLabel: "",
        resolve: (value) => resolve(typeof value === "string" ? value : null),
      });
    });
  }

  /**
   * Ask how to handle each conflicting local file.
   *
   * Answers come back per document id, so the caller can apply a different
   * policy to each file; the bulk buttons in the dialog are only a shortcut for
   * filling every row at once.
   */
  resolveConflicts<T extends string = string>(
    options: ConflictDialogOptions<T>,
  ): Promise<Map<string, T> | null> {
    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "conflicts",
        title: options.title ?? "Resolve conflicts",
        message: options.message,
        defaultValue: "",
        placeholder: "",
        confirmLabel: options.confirmLabel ?? "OK",
        cancelLabel: options.cancelLabel ?? "Cancel",
        danger: false,
        multiline: false,
        maxLength: undefined,
        inputType: "text",
        selectOnOpen: false,
        choices: [],
        details: [],
        detailLabel: "",
        applyToAllLabel: "",
        conflictItems: options.items,
        conflictStrategies: options.strategies,
        conflictDefaultStrategy: options.defaultStrategy,
        conflictListLabel: options.listLabel ?? "",
        resolve: (value) => resolve(
          value && typeof value === "object" && "strategies" in value
            ? (value as ConflictDialogResult<T>).strategies
            : null,
        ),
      });
    });
  }

  choose<T extends string>(options: ChoiceDialogOptions<T>): Promise<ChoiceDialogResult<T> | null> {
    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "choice",
        title: options.title ?? "Choose an action",
        message: options.message,
        defaultValue: "",
        placeholder: "",
        confirmLabel: "",
        cancelLabel: options.cancelLabel ?? "Cancel",
        danger: false,
        multiline: false,
        maxLength: undefined,
        inputType: "text",
        selectOnOpen: false,
        choices: options.choices,
        details: options.details ?? [],
        detailLabel: options.detailLabel ?? "",
        applyToAllLabel: options.applyToAllLabel ?? "",
        conflictItems: [],
        conflictStrategies: [],
        conflictDefaultStrategy: "",
        conflictListLabel: "",
        resolve: (value) => resolve(
          value && typeof value === "object"
            ? value as ChoiceDialogResult<T>
            : null,
        ),
      });
    });
  }

  resolve(value: DialogResolution) {
    const request = this.current;
    if (!request) return;
    this.current = null;
    request.resolve(value);
    this.showNext();
  }

  private enqueue(request: DialogRequest) {
    this.queue.push(request);
    if (!this.current) this.showNext();
  }

  private showNext() {
    if (this.current || this.queue.length === 0) return;
    this.current = this.queue.shift() ?? null;
  }
}

export const dialogStore = new DialogStoreImpl();
