"use client";

import { useState } from "react";
import { Badge, Button, Callout, Flex, Select, Switch, Text } from "@radix-ui/themes";
import { CheckCircle, Info, Languages, XCircle } from "lucide-react";
import Field from "@/app/components/account-settings/Field";
import PasswordField from "@/app/components/PasswordField";
import type { Account, DeeplConfig } from "@/lib/data";
import {
  DEEPL_TARGET_LANGUAGES,
  DEFAULT_DEEPL_TARGET_LANG
} from "@/lib/deeplLanguages";
import { buildAccountTranslationTestPath } from "@/lib/accountApiPaths";

type TestResult =
  | { ok: true; plan: string; characterCount: number; characterLimit: number }
  | { ok: false; message: string };

type Props = {
  editingAccount: Account;
  isExistingAccount: boolean;
  canSave: boolean;
  onUpdateAccount: (next: Account) => void;
  onClose: () => void;
  onSave: () => void;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export default function TranslationTabContent({
  editingAccount,
  isExistingAccount,
  canSave,
  onUpdateAccount,
  onClose,
  onSave,
  apiFetch
}: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const saveDisabled = !isExistingAccount || !canSave;

  const deepl = editingAccount.deepl;
  const enabled = deepl?.enabled ?? false;
  const targetLang = deepl?.targetLang ?? DEFAULT_DEEPL_TARGET_LANG;
  // A key is available if one was typed into the form, or one is already stored
  // server-side (the field is blank by design, but `hasApiKey` is surfaced).
  const keyAvailable = Boolean(deepl?.apiKey?.trim()) || Boolean(deepl?.hasApiKey);

  const updateDeepl = (patch: Partial<DeeplConfig>) => {
    const next: DeeplConfig = { ...(deepl ?? {}), ...patch };
    onUpdateAccount({ ...editingAccount, deepl: next });
  };

  const clearDeepl = () => {
    onUpdateAccount({ ...editingAccount, deepl: undefined });
    setTestResult(null);
  };

  const fetchFn = apiFetch ?? fetch;

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchFn(buildAccountTranslationTestPath(editingAccount.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: deepl?.apiKey ?? "" })
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Could not reach the server to test the key." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Flex align="center" gap="2">
          <Languages size={18} />
          <Text size="3" weight="medium">
            DeepL Translation
          </Text>
          <Badge size="1" color="gray" variant="soft">
            Optional
          </Badge>
        </Flex>

        <Field
          label="API key"
          hint="From your DeepL account. Free-tier keys end in “:fx”. Stored encrypted and never sent back to the browser."
        >
          <PasswordField
            value={deepl?.apiKey ?? ""}
            onChange={(e) => updateDeepl({ apiKey: e.target.value })}
            placeholder={
              deepl?.hasApiKey ? "A key is saved — leave blank to keep it" : "Paste your DeepL API key"
            }
            autoComplete="off"
            style={{ width: "100%" }}
          />
        </Field>

        <Field label="Enable translation" hint="Show a Translate action on messages in this account.">
          <Flex asChild align="center" gap="2">
            <label>
              <Switch
                size="1"
                checked={enabled}
                onCheckedChange={(checked) => updateDeepl({ enabled: checked })}
              />
              <Text size="2">Translate messages in this account</Text>
            </label>
          </Flex>
        </Field>

        <Field label="Default target language" hint="Messages are translated into this language unless you pick another in the reader.">
          <Select.Root value={targetLang} onValueChange={(v) => updateDeepl({ targetLang: v })}>
            <Select.Trigger style={{ width: "100%" }} />
            <Select.Content position="popper">
              {DEEPL_TARGET_LANGUAGES.map((language) => (
                <Select.Item key={language.code} value={language.code}>
                  {language.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field>

        <Flex gap="2" align="center" wrap="wrap">
          <Button
            size="2"
            variant="soft"
            onClick={handleTestKey}
            disabled={testing || !keyAvailable}
          >
            {testing ? "Testing…" : "Test key"}
          </Button>
          {deepl ? (
            <Button size="2" variant="soft" color="red" onClick={clearDeepl}>
              Remove DeepL
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
                ? `Key valid (${testResult.plan} plan). ${testResult.characterCount.toLocaleString()} / ${testResult.characterLimit.toLocaleString()} characters used this period.`
                : testResult.message}
            </Callout.Text>
          </Callout.Root>
        )}

        {enabled && !keyAvailable && (
          <Callout.Root color="amber" size="1" variant="soft">
            <Callout.Icon>
              <Info size={14} />
            </Callout.Icon>
            <Callout.Text>Add and save a DeepL API key to use translation.</Callout.Text>
          </Callout.Root>
        )}

        <Callout.Root color="gray" size="1" variant="soft">
          <Callout.Icon>
            <Info size={14} />
          </Callout.Icon>
          <Callout.Text>
            When enabled, message bodies can be translated on demand via DeepL. Translations are
            cached per message and language. Message content is sent to DeepL for translation.
          </Callout.Text>
        </Callout.Root>
      </Flex>

      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)" }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          {saveDisabled ? "Close" : "Cancel"}
        </Button>
        <Button size="2" onClick={onSave} disabled={saveDisabled}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
