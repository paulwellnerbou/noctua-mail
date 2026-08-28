import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, PenLine, Search } from "lucide-react";
import { DropdownMenu } from "@radix-ui/themes";
import menuStyles from "./MessageMenu.module.css";
import styles from "./EmailAddressMenu.module.css";
import { formatAddress } from "../utils/parseAddressList";

export type EmailAddressMenuAction = "with" | "from" | "to";

type EmailAddressMenuProps = {
  displayName: string;
  email: string;
  onSearchByAddress: (action: EmailAddressMenuAction, email: string) => void;
  onComposeTo?: (email: string) => void;
};

export default function EmailAddressMenu({
  displayName,
  email,
  onSearchByAddress,
  onComposeTo
}: EmailAddressMenuProps) {
  const [copiedItem, setCopiedItem] = useState<"full" | "email" | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  const label = displayName || email;
  const tooltip = displayName ? `${displayName} <${email}>` : email;
  const fullAddress = formatAddress(displayName, email);

  const handleCopy = async (item: "full" | "email", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedItem(item);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        setCopiedItem(null);
        resetTimer.current = null;
      }, 1200);
    } catch {
      // ignore
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          type="button"
          className={styles.addressTrigger}
          title={tooltip}
          aria-label={`Address actions for ${tooltip}`}
        >
          <span className={styles.addressLabel}>{label}</span>
          {displayName && (
            <span className={styles.addressEmail}>{`<${email}>`}</span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" sideOffset={4} className={menuStyles.menuContent}>
        <DropdownMenu.Label>{email}</DropdownMenu.Label>
        <DropdownMenu.Item onSelect={() => onSearchByAddress("with", email)}>
          <span className={menuStyles.menuIcon}>
            <Search size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Find all messages with this address</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onSearchByAddress("from", email)}>
          <span className={menuStyles.menuIcon}>
            <ArrowLeft size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Messages from this address</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onSearchByAddress("to", email)}>
          <span className={menuStyles.menuIcon}>
            <ArrowRight size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Messages to this address</span>
        </DropdownMenu.Item>
        {onComposeTo && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => onComposeTo(fullAddress)}>
              <span className={menuStyles.menuIcon}>
                <PenLine size={14} />
              </span>
              <span className={menuStyles.menuLabel}>Compose message to</span>
            </DropdownMenu.Item>
          </>
        )}
        <DropdownMenu.Separator />
        {displayName && (
          <DropdownMenu.Item
            onSelect={(event) => {
              event.preventDefault();
              handleCopy("full", fullAddress);
            }}
          >
            <span className={menuStyles.menuIcon}>
              {copiedItem === "full" ? <Check size={14} /> : <Copy size={14} />}
            </span>
            <span className={menuStyles.menuLabel}>
              {copiedItem === "full" ? "Copied!" : "Copy name and email address"}
            </span>
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item
          onSelect={(event) => {
            event.preventDefault();
            handleCopy("email", email);
          }}
        >
          <span className={menuStyles.menuIcon}>
            {copiedItem === "email" ? <Check size={14} /> : <Copy size={14} />}
          </span>
          <span className={menuStyles.menuLabel}>
            {copiedItem === "email" ? "Copied!" : "Copy email address only"}
          </span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
