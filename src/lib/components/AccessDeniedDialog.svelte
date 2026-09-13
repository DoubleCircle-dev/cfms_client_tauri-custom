<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import AccessDeniedNotice from '$lib/components/AccessDeniedNotice.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import { formatLocalDateTimeWithUtcOffset } from '$lib/date-time';
  import { explainPermissionDenial, type Capability } from '$lib/permission-explainer';
  import { authStore } from '$lib/stores.svelte';

  let {
    documentName,
    documentId,
    accessedAt,
    capability = null,
    serverMessage = null,
    serverPayload = null,
    onClose,
  }: {
    documentName: string;
    documentId: string;
    accessedAt: number;
    /** The refused capability, when the caller knows which one it was. */
    capability?: Capability | null;
    /** The server's own wording for the refusal, when there was any. */
    serverMessage?: string | null;
    /** Structured data the server attached to the refusal, when there was any. */
    serverPayload?: Record<string, unknown> | null;
    onClose: () => void;
  } = $props();

  const accessDetails = $derived([
    { label: $t('files.documentId'), value: documentId },
    { label: $t('files.accessDeniedAt'), value: formatLocalDateTimeWithUtcOffset(accessedAt) },
  ]);

  // Only built when the caller could name the refused capability: without it
  // there is nothing specific to explain, and the plain notice says more.
  const explanation = $derived(
    capability
      ? explainPermissionDenial({
          capability,
          permissions: authStore.permissions,
          groups: authStore.groups,
          serverMessage,
          serverPayload,
        })
      : null,
  );

  const description = $derived(
    capability === 'download'
      ? $t('files.documentDownloadDeniedDescription')
      : capability === 'view'
        ? $t('files.documentViewDeniedDescription')
        : $t('files.documentAccessDeniedDescription'),
  );
</script>

<ModalFrame
  title={$t('files.documentAccessDeniedDialogTitle')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  {onClose}
>
  <AccessDeniedNotice
    presentation="dialog"
    title={$t('files.documentAccessDeniedTitle')}
    {description}
    subject={documentName}
    details={accessDetails}
    {explanation}
    actionLabel={$t('common.close')}
    onAction={onClose}
  />
</ModalFrame>
