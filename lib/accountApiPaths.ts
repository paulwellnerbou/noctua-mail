function appendQuery(path: string, query?: URLSearchParams | string | null) {
  if (!query) return path;
  const value = typeof query === "string" ? query : query.toString();
  return value ? `${path}?${value}` : path;
}

export function buildAccountApiPath(accountId: string, suffix: string) {
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/api/accounts/${encodeURIComponent(accountId)}${normalizedSuffix}`;
}

export function buildAccountMessagesPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/messages"), query);
}

export function buildAccountSearchPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/search"), query);
}

export function buildAccountTopicsPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/topics"), query);
}

export function buildAccountTopicPath(accountId: string, topicId: string) {
  return buildAccountApiPath(accountId, `/topics/${encodeURIComponent(topicId)}`);
}

export function buildAccountTopicSuggestionsPath(
  accountId: string,
  topicId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(
    buildAccountApiPath(accountId, `/topics/${encodeURIComponent(topicId)}/suggestions`),
    query
  );
}

export function buildAccountTopicStatsPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/topics/stats"), query);
}

export function buildAccountTopicTransferPath(accountId: string) {
  return buildAccountApiPath(accountId, "/topics/transfer");
}

export function buildAccountMessageTopicsPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/message-topics"), query);
}

export function buildAccountMessageTopicSuggestionsPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/message-topics/suggest"), query);
}

export function buildAccountMessageTopicSuggestionExplainPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/message-topics/explain"), query);
}

export function buildAccountCategoriesDebugPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/categories/debug"), query);
}

export function buildAccountCategoriesModelResetPath(accountId: string) {
  return buildAccountApiPath(accountId, "/categories/model/reset");
}

export function buildAccountCalendarEventsPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/calendar/events"), query);
}

export function buildAccountCalendarEventPath(
  accountId: string,
  eventId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(
    buildAccountApiPath(accountId, `/calendar/events/${encodeURIComponent(eventId)}`),
    query
  );
}

export function buildAccountCalendarEventRespondPath(accountId: string, eventId: string) {
  return buildAccountApiPath(
    accountId,
    `/calendar/events/${encodeURIComponent(eventId)}/respond`
  );
}

export function buildAccountCalendarParticipationPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/calendar/events/participation"), query);
}

export function buildAccountCalendarInvitesProcessPath(accountId: string) {
  return buildAccountApiPath(accountId, "/calendar/invites/process");
}

export function buildAccountCalendarRecomputeRelationsPath(accountId: string) {
  return buildAccountApiPath(accountId, "/calendar/recompute-relations");
}

export function buildAccountCalendarSyncPath(accountId: string) {
  return buildAccountApiPath(accountId, "/calendar/sync");
}

export function buildAccountRemindersPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/reminders"), query);
}

export function buildAccountRemindersAutoCreatePath(accountId: string) {
  return buildAccountApiPath(accountId, "/reminders/auto-create");
}

export function buildAccountDraftSavePath(accountId: string) {
  return buildAccountApiPath(accountId, "/drafts/save");
}

export function buildAccountDraftDiscardPath(accountId: string, draftId: string) {
  return buildAccountApiPath(accountId, `/drafts/${encodeURIComponent(draftId)}/discard`);
}

export function buildAccountSmtpSendPath(accountId: string) {
  return buildAccountApiPath(accountId, "/smtp/send");
}

export function buildAccountFoldersCreatePath(accountId: string) {
  return buildAccountApiPath(accountId, "/folders/create");
}

export function buildAccountFolderRenamePath(accountId: string, folderId: string) {
  return buildAccountApiPath(accountId, `/folders/${encodeURIComponent(folderId)}/rename`);
}

export function buildAccountFolderDeletePath(accountId: string, folderId: string) {
  return buildAccountApiPath(accountId, `/folders/${encodeURIComponent(folderId)}/delete`);
}

export function buildAccountFolderConsistencyPath(accountId: string, folderId: string) {
  return buildAccountApiPath(accountId, `/folders/${encodeURIComponent(folderId)}/consistency`);
}

export function buildAccountSyncNewCandidatesPath(accountId: string) {
  return buildAccountApiPath(accountId, "/sync/new-candidates");
}

export function buildAccountImapPollPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/imap/poll"), query);
}

export function buildAccountImapStreamPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/imap/stream"), query);
}

export function buildAccountThreadsPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/threads"), query);
}

export function buildAccountRelatedPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/related"), query);
}

export function buildAccountSenderIconPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/sender-icon"), query);
}

export function buildAccountComposeRecipientsPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/compose/recipients"), query);
}

export function buildAccountRecipientAliasesPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/recipient-aliases"), query);
}

export function buildAccountMcpTokensPath(
  accountId: string,
  query?: URLSearchParams | string | null
) {
  return appendQuery(buildAccountApiPath(accountId, "/mcp-tokens"), query);
}

export function buildAccountMcpTokenPath(accountId: string, tokenId: string) {
  return buildAccountApiPath(accountId, `/mcp-tokens/${encodeURIComponent(tokenId)}`);
}

export function buildAccountReloginPath(accountId: string) {
  return buildAccountApiPath(accountId, "/relogin");
}

export function buildAccountRecipientAliasTransferPath(accountId: string) {
  return buildAccountApiPath(accountId, "/recipient-aliases/transfer");
}

export function buildAccountRecipientAliasPath(accountId: string, aliasId: string) {
  return buildAccountApiPath(
    accountId,
    `/recipient-aliases/${encodeURIComponent(aliasId)}`
  );
}

export function buildAccountFoldersPath(accountId: string, query?: URLSearchParams | string | null) {
  return appendQuery(buildAccountApiPath(accountId, "/folders"), query);
}

export function buildAccountMessagePath(accountId: string, messageId: string) {
  return buildAccountApiPath(
    accountId,
    `/messages/${encodeURIComponent(messageId)}`
  );
}

function normalizeAccountActionSuffix(suffix: string) {
  return suffix.replace(/^\/+/, "");
}

export function buildAccountMessageActionPath(
  accountId: string,
  messageId: string,
  action: string
) {
  return buildAccountApiPath(
    accountId,
    `/messages/${encodeURIComponent(messageId)}/${normalizeAccountActionSuffix(action)}`
  );
}

export function buildAccountMessagesActionPath(accountId: string, action: string) {
  return buildAccountApiPath(accountId, `/messages/${normalizeAccountActionSuffix(action)}`);
}

export function buildAccountMessageSourcePath(accountId: string, messageId: string) {
  return buildAccountApiPath(
    accountId,
    `/messages/${encodeURIComponent(messageId)}/source`
  );
}

export function buildAccountMessageHtmlPath(accountId: string, messageId: string) {
  return buildAccountApiPath(
    accountId,
    `/messages/${encodeURIComponent(messageId)}/html`
  );
}

export function buildAccountAttachmentPath(
  accountId: string,
  messageId: string,
  attachmentId: string
) {
  return buildAccountApiPath(
    accountId,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
}
