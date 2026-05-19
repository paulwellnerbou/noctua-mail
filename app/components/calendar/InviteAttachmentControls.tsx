"use client";

import { useMemo, useState } from "react";
import { Info, Search } from "lucide-react";
import { Badge, Button, Dialog, Flex } from "@radix-ui/themes";
import { extractCalendarIcsUid, normalizeCalendarIcsLineEndings } from "@/lib/calendarIcs";
import DialogTitleBar from "@/app/components/mailclient/message/DialogTitleBar";
import RawTextPanel from "@/app/components/mailclient/message/RawTextPanel";
import styles from "./InviteAttachmentControls.module.css";

type Props = {
  downloadLabel: string;
  downloadFilename?: string;
  downloadHref?: string;
  rawIcsSource?: string;
  relatedInviteUid?: string;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

export default function InviteAttachmentControls({
  downloadLabel,
  downloadFilename,
  downloadHref,
  rawIcsSource,
  relatedInviteUid,
  onFindRelatedByInviteUid
}: Props) {
  const [rawIcsOpen, setRawIcsOpen] = useState(false);
  const normalizedRawSource = useMemo(
    () => normalizeCalendarIcsLineEndings(rawIcsSource ?? ""),
    [rawIcsSource]
  );
  const canViewRawIcs = normalizedRawSource.trim().length > 0;
  const resolvedInviteUid = useMemo(
    () => relatedInviteUid?.trim() || extractCalendarIcsUid(normalizedRawSource),
    [normalizedRawSource, relatedInviteUid]
  );
  const generatedDownloadHref = useMemo(() => {
    if (!canViewRawIcs || downloadHref) return "";
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(normalizedRawSource)}`;
  }, [canViewRawIcs, downloadHref, normalizedRawSource]);
  const effectiveDownloadHref = downloadHref ?? generatedDownloadHref;
  if (!effectiveDownloadHref && !resolvedInviteUid && !canViewRawIcs) return null;

  return (
    <Flex align="center" gap="2" className={styles.controls}>
      {effectiveDownloadHref ? (
        <a
          className={styles.attachmentLink}
          href={effectiveDownloadHref}
          download={downloadFilename}
          title={downloadLabel}
        >
          <Badge size="1" variant="soft" color="indigo" className={styles.attachmentBadge}>
            <span className={styles.attachmentLabel}>{downloadLabel}</span>
          </Badge>
        </a>
      ) : null}
      <Dialog.Root open={rawIcsOpen} onOpenChange={setRawIcsOpen}>
        <Button
          size="1"
          variant="soft"
          color="gray"
          className={styles.iconButton}
          title="Find related"
          aria-label="Find related"
          disabled={!resolvedInviteUid || !onFindRelatedByInviteUid}
          onClick={() => {
            if (resolvedInviteUid) onFindRelatedByInviteUid?.(resolvedInviteUid);
          }}
        >
          <Search size={12} />
        </Button>
        <Button
          size="1"
          variant="soft"
          color="gray"
          className={styles.iconButton}
          title="Show raw ICS content"
          aria-label="Show raw ICS content"
          disabled={!canViewRawIcs}
          onClick={() => setRawIcsOpen(true)}
        >
          <Info size={12} />
        </Button>
        <Dialog.Content size="4" className={styles.rawIcsDialog}>
          <Flex direction="column" gap="3">
            <DialogTitleBar title="Raw ICS Content" onClose={() => setRawIcsOpen(false)} />
            <Dialog.Description size="2" color="gray">{downloadLabel}</Dialog.Description>
            {resolvedInviteUid ? (
              <div className={styles.uidRow}>
                <span className={styles.uidLabel}>UID</span>
                <span className={styles.uidValue}>{resolvedInviteUid}</span>
              </div>
            ) : null}
            <RawTextPanel
              text={canViewRawIcs ? normalizedRawSource : ""}
              copyText={canViewRawIcs ? normalizedRawSource : ""}
              copyLabel="Copy ICS"
              emptyText="Raw ICS content is unavailable."
              className={styles.rawIcsPanel}
            />
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
}
