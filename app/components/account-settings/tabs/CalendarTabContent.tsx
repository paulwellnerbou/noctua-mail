"use client";

import { useState } from "react";
import { Badge, Button, Callout, Flex, Grid, Select, Text, TextField } from "@radix-ui/themes";
import { CheckCircle, Info, XCircle } from "lucide-react";
import Field from "@/app/components/account-settings/Field";
import PasswordField from "@/app/components/PasswordField";
import type { Account, CaldavConfig } from "@/lib/data";

type TestResult = { ok: true; calendars: { displayName?: string; url: string }[] } | { ok: false; message: string };

const SYNC_INTERVAL_OPTIONS = [
  { value: "60000", label: "1 minute" },
  { value: "300000", label: "5 minutes" },
  { value: "900000", label: "15 minutes" },
  { value: "1800000", label: "30 minutes" },
  { value: "3600000", label: "1 hour" }
];

type Props = {
  editingAccount: Account;
  isExistingAccount: boolean;
  canSave: boolean;
  onUpdateAccount: (next: Account) => void;
  onClose: () => void;
  onSave: () => void;
};

export default function CalendarTabContent({
  editingAccount,
  isExistingAccount,
  canSave,
  onUpdateAccount,
  onClose,
  onSave
}: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const caldav = editingAccount.caldav;

  const updateCaldav = (patch: Partial<CaldavConfig>) => {
    const next: CaldavConfig = {
      url: caldav?.url ?? "",
      user: caldav?.user ?? "",
      password: caldav?.password ?? "",
      ...caldav,
      ...patch
    };
    onUpdateAccount({ ...editingAccount, caldav: next });
  };

  const clearCaldav = () => {
    onUpdateAccount({ ...editingAccount, caldav: undefined });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/calendar/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: caldav?.url ?? "",
          user: caldav?.user ?? "",
          password: caldav?.password ?? ""
        })
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Connection failed. Check the URL and credentials." });
    } finally {
      setTesting(false);
    }
  };

  const canTest = Boolean(caldav?.url?.trim() && caldav?.user?.trim() && caldav?.password?.trim());

  const weekStartsOn = editingAccount.settings?.calendar?.weekStartsOn ?? "monday";

  const updateWeekStartsOn = (value: "monday" | "sunday") => {
    onUpdateAccount({
      ...editingAccount,
      settings: {
        ...editingAccount.settings,
        calendar: {
          ...editingAccount.settings?.calendar,
          weekStartsOn: value
        }
      }
    });
  };

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Flex direction="column" gap="3">
          <Text size="3" weight="medium">
            Appearance
          </Text>
          <Field label="Week starts on">
            <Select.Root value={weekStartsOn} onValueChange={(v) => updateWeekStartsOn(v as "monday" | "sunday")}>
              <Select.Trigger style={{ width: "100%" }} />
              <Select.Content position="popper">
                <Select.Item value="monday">Monday</Select.Item>
                <Select.Item value="sunday">Sunday</Select.Item>
              </Select.Content>
            </Select.Root>
          </Field>
        </Flex>

        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <Text size="3" weight="medium">
              CalDAV Server
            </Text>
            <Badge size="1" color="gray" variant="soft">
              Optional
            </Badge>
          </Flex>
          <Grid columns="2" gap="3">
            <Field label="Server URL" hint='e.g. "https://caldav.example.com/"'>
              <TextField.Root
                value={caldav?.url ?? ""}
                onChange={(e) => updateCaldav({ url: e.target.value })}
                placeholder="https://caldav.example.com/"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Username">
              <TextField.Root
                value={caldav?.user ?? ""}
                onChange={(e) => updateCaldav({ user: e.target.value })}
                placeholder="user@example.com"
                autoComplete="off"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Password">
              <PasswordField
                value={caldav?.password ?? ""}
                onChange={(e) => updateCaldav({ password: e.target.value })}
                placeholder="Password"
                autoComplete="new-password"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Calendar Path" hint="Leave blank to auto-discover">
              <TextField.Root
                value={caldav?.calendarPath ?? ""}
                onChange={(e) =>
                  updateCaldav({ calendarPath: e.target.value || undefined })
                }
                placeholder="/principals/user/calendar/"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Sync Interval">
              <Select.Root
                value={String(caldav?.syncIntervalMs ?? "300000")}
                onValueChange={(v) =>
                  updateCaldav({ syncIntervalMs: Number(v) })
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  {SYNC_INTERVAL_OPTIONS.map((opt) => (
                    <Select.Item key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field>
          </Grid>

          <Flex gap="2" align="center">
            <Button
              size="2"
              variant="soft"
              onClick={handleTestConnection}
              disabled={testing || !canTest}
            >
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            {caldav?.url ? (
              <Button size="2" variant="soft" color="red" onClick={clearCaldav}>
                Remove CalDAV
              </Button>
            ) : null}
          </Flex>

          {testResult !== null && (
            <Callout.Root color={testResult.ok ? "green" : "red"} size="1">
              <Callout.Icon>
                {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              </Callout.Icon>
              <Callout.Text>
                {testResult.ok
                  ? `Connected. Found ${testResult.calendars.length} calendar${testResult.calendars.length !== 1 ? "s" : ""}${testResult.calendars.length > 0 ? ": " + testResult.calendars.map((c) => c.displayName ?? c.url).join(", ") : ""}.`
                  : testResult.message}
              </Callout.Text>
            </Callout.Root>
          )}

          <Callout.Root color="gray" size="1" variant="soft">
            <Callout.Icon>
              <Info size={14} />
            </Callout.Icon>
            <Callout.Text>
              CalDAV is optional. Calendar events from email invites and manually created
              events are always stored locally.
            </Callout.Text>
          </Callout.Root>
        </Flex>
      </Flex>

      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)" }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          Cancel
        </Button>
        <Button size="2" onClick={onSave} disabled={!isExistingAccount || !canSave}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
